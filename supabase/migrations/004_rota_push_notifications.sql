-- Safe to re-run after 003. Browser subscriptions are private to their owner.
create table if not exists public.push_subscriptions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 20 and 2048 and endpoint ~ '^https://'),
  p256dh text not null check (char_length(p256dh) between 20 and 512),
  auth text not null check (char_length(auth) between 8 and 512),
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists "owners read push subscriptions" on public.push_subscriptions;
drop policy if exists "owners add push subscriptions" on public.push_subscriptions;
drop policy if exists "owners remove push subscriptions" on public.push_subscriptions;
create policy "owners read push subscriptions" on public.push_subscriptions for select
  using (public.is_approved() and user_id = auth.uid());
create policy "owners add push subscriptions" on public.push_subscriptions for insert
  with check (public.is_approved() and user_id = auth.uid());
create policy "owners remove push subscriptions" on public.push_subscriptions for delete
  using (user_id = auth.uid());
revoke all on public.push_subscriptions from public, anon, authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;
grant select, delete on public.push_subscriptions to service_role;

-- The browser cannot read or write delivery claims. Claim before sending so
-- parallel invocations and retries never attempt the same delivery twice.
create schema if not exists private;
create table if not exists private.rota_push_deliveries (
  chore_id uuid not null references public.chores(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  reminder_date date not null,
  claimed_at timestamptz not null default now(),
  primary key (chore_id, subscription_id, reminder_date)
);
alter table private.rota_push_deliveries enable row level security;
revoke all on schema private from public, anon, authenticated;
revoke all on private.rota_push_deliveries from public, anon, authenticated;

create or replace function public.claim_rota_push_delivery(
  p_chore_id uuid, p_subscription_id uuid, p_reminder_date date
) returns boolean language plpgsql security definer set search_path = '' as $$
declare claimed_count integer;
begin
  -- The service role is the only caller. Recheck current eligibility at claim
  -- time so a completed, deleted, or reassigned task cannot be queued.
  if not exists (
    select 1 from public.chores c
    join public.push_subscriptions s on s.user_id = c.assigned_to
    join public.profiles p on p.id = s.user_id
    where c.id = p_chore_id and s.id = p_subscription_id
      and c.due_date = p_reminder_date and c.completed_at is null
      and p.status = 'approved'
  ) then return false; end if;
  insert into private.rota_push_deliveries (chore_id, subscription_id, reminder_date)
  values (p_chore_id, p_subscription_id, p_reminder_date)
  on conflict do nothing;
  get diagnostics claimed_count = row_count;
  return claimed_count = 1;
end;
$$;
revoke all on function public.claim_rota_push_delivery(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.claim_rota_push_delivery(uuid, uuid, date) to service_role;
notify pgrst, 'reload schema';
