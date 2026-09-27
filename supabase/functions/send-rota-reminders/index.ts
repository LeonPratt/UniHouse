import { createClient } from "@supabase/supabase-js";
// @ts-types="npm:@types/web-push@3.6.4"
import webPush from "web-push";

const londonClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", year: "numeric", month: "2-digit",
  day: "2-digit", hour: "2-digit", hourCycle: "h23",
});

function londonDateAndHour(now: Date) {
  const parts = Object.fromEntries(londonClock.formatToParts(now).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function allRows<T>(queryForPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await queryForPage(from, from + 499);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < 500) return rows;
  }
}

type Chore = { id: string; title: string; assigned_to: string };
type Subscription = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };

Deno.serve(async request => {
  // This function has verify_jwt=false so pg_net can invoke it. The secret is
  // only stored in Supabase Vault and Edge Function secrets.
  const cronSecret = Deno.env.get("ROTA_REMINDER_SECRET");
  if (request.method !== "POST" || !cronSecret || request.headers.get("x-cron-secret") !== cronSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { date, hour } = londonDateAndHour(new Date());
  if (hour !== 9) return Response.json({ date, skipped: "Outside 09:00 Europe/London" });

  try {
    const supabase = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    webPush.setVapidDetails(required("VAPID_SUBJECT"), required("VAPID_PUBLIC_KEY"), required("VAPID_PRIVATE_KEY"));

    const chores = await allRows<Chore>((from, to) => supabase.from("chores")
      .select("id,title,assigned_to").eq("due_date", date).is("completed_at", null)
      .order("id").range(from, to));
    if (!chores.length) return Response.json({ date, attempted: 0 });

    const assignees = [...new Set(chores.map(chore => chore.assigned_to))];
    const approved = new Set<string>();
    for (let i = 0; i < assignees.length; i += 100) {
      const { data, error } = await supabase.from("profiles").select("id")
        .in("id", assignees.slice(i, i + 100)).eq("status", "approved");
      if (error) throw error;
      for (const profile of data || []) approved.add(profile.id);
    }
    const subscriptions: Subscription[] = [];
    for (let i = 0; i < assignees.length; i += 100) {
      const userIds = assignees.slice(i, i + 100).filter(id => approved.has(id));
      if (!userIds.length) continue;
      subscriptions.push(...await allRows<Subscription>((from, to) => supabase.from("push_subscriptions")
        .select("id,user_id,endpoint,p256dh,auth").in("user_id", userIds)
        .order("id").range(from, to)));
    }
    const byUser = new Map<string, Subscription[]>();
    for (const subscription of subscriptions) {
      byUser.set(subscription.user_id, [...(byUser.get(subscription.user_id) || []), subscription]);
    }

    let attempted = 0;
    let failed = 0;
    for (const chore of chores) {
      if (!approved.has(chore.assigned_to)) continue;
      for (const subscription of byUser.get(chore.assigned_to) || []) {
        const { data: claimed, error } = await supabase.rpc("claim_rota_push_delivery", {
          p_chore_id: chore.id, p_subscription_id: subscription.id, p_reminder_date: date,
        });
        if (error) throw error;
        if (!claimed) continue;
        attempted += 1;
        try {
          await webPush.sendNotification(
            { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
            JSON.stringify({ choreId: chore.id, body: `${chore.title} is due today.` }),
          );
        } catch (sendError) {
          const status = (sendError as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await supabase.from("push_subscriptions").delete().eq("id", subscription.id);
          } else {
            failed += 1;
            console.error("Push delivery failed", { choreId: chore.id, subscriptionId: subscription.id, status });
          }
        }
      }
    }
    return Response.json({ date, attempted, failed });
  } catch (error) {
    console.error("Rota reminder run failed", error);
    return Response.json({ error: "Reminder run failed" }, { status: 500 });
  }
});
