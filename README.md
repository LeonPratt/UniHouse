# Housemate

A small single-household app for chore rotas and shared spending. Before Supabase is configured, the app opens with empty states; serve the folder with any static web server.

## Included

- Supabase-backed weekly rota with completion states and task creation
- Supabase-backed expense entry, equal split selection, and live balances
- Household members and an admin-only, live approval queue
- Responsive desktop and mobile layout
- A Supabase schema with pending-by-default email accounts and Row Level Security

## Connect Supabase

1. Create a Supabase project and enable Email auth.
2. Run [`supabase/schema.sql`](./supabase/schema.sql) in the SQL editor.
3. Copy [`config.example.js`](./config.example.js) to `config.js`. Set `houseName` to the name you want shown in the app, then add your project URL and publishable key. `config.js` is ignored by Git to keep private house names out of future normal commits. The publishable key is intended for browser use; access is enforced by the included RLS policies. For a deployed site, supply `config.js` through the hosting setup; GitHub Pages will not receive this ignored file from the repository. Visitors can read any browser-served config, so use a house label you are comfortable showing them.
4. Open [`auth.html`](./auth.html), create your first account, then promote it once in SQL using the command in the schema comment. Every later sign-up is created as `pending` and cannot access the dashboard until an admin approves it.

### Add recurring rotas

To enable rotating jobs such as bins every two days, also run [`supabase/migrations/001_recurring_rotas.sql`](./supabase/migrations/001_recurring_rotas.sql) once in the Supabase SQL Editor. The app then uses a safe database function to mark a recurring job complete and create the next person’s turn.

Then run [`supabase/migrations/002_calendar_and_rota_horizon.sql`](./supabase/migrations/002_calendar_and_rota_horizon.sql). It upgrades each recurring rota to show ten upcoming turns and adds the shared house calendar.

Finally, run [`supabase/migrations/003_security_hardening.sql`](./supabase/migrations/003_security_hardening.sql). This secures database functions, narrows who can edit shared records, and makes expense and rota creation atomic. Run it on existing installations too; it backfills ownership of older chores. It is safe to run again.

For rota push reminders, run [`supabase/migrations/004_rota_push_notifications.sql`](./supabase/migrations/004_rota_push_notifications.sql) after migration 003. It can be run again safely. Push requires the further setup below.

### Upgrade an existing database

If the app reports that `chores.created_by` does not exist, the database is missing migration 003. In the Supabase Dashboard, open **SQL Editor**, paste the complete contents of [`supabase/migrations/003_security_hardening.sql`](./supabase/migrations/003_security_hardening.sql), and select **Run**. Then refresh the app and sign in again. The migration adds and backfills `created_by` without deleting chores.

If Supabase still reports that the column is missing after the migration succeeds, run this once in the SQL Editor to refresh its Data API schema cache:

```sql
NOTIFY pgrst, 'reload schema';
```

You can run [`supabase/tests/security_contract.sql`](./supabase/tests/security_contract.sql) in the SQL Editor afterwards to check that the public and authenticated database roles have the intended privileges. The check does not change data. Run migration 004 first.

Approved members can read and add shared content. A creator or admin can edit or delete a standalone chore or calendar event; the rota creator or admin can remove a recurring rota. Only the assigned person or an admin can complete a chore. Expense shares are computed by the database in a single transaction. Admins can approve or reject pending accounts. Existing standalone chores are assigned to their current assignee as creator during the migration.

The app loads the pinned Supabase browser module from `esm.sh` and Google Fonts. Its Content Security Policy permits those origins and your Supabase project for network calls. If you use a different module host or self-host dependencies, update the CSP in both HTML pages.

The supplied frontend stays empty until those config values are added. Once configured, people, chores, expenses, splits, balances, and approval requests are all read from and written to your Supabase project.

## Set up rota push reminders (house admin)

Reminders are optional and per device. At 09:00 **Europe/London** on a chore's due date, the scheduled function finds incomplete chores and sends each approved assignee a push reminder on every device where they opted in. It records a claim before each send, so a retry or concurrent run will not send the same chore to the same subscription again that day. Push delivery itself is best effort: devices may be offline, browsers may suppress notifications, and failed attempts are not retried. Completed chores and unapproved accounts are excluded. The function sends only a fixed rota message and clicking it opens the Rotas page.

1. Run [migration 004](./supabase/migrations/004_rota_push_notifications.sql) in **Supabase Dashboard → SQL Editor**. Then run the [security contract](./supabase/tests/security_contract.sql) there. The migration stores each browser's push subscription under its approved account; delivery claims are in a private database schema.
2. Generate a VAPID key pair on your own machine with `npx --yes web-push@3.6.7 generate-vapid-keys`. Keep the private key out of Git. Copy **only the public key** to `vapidPublicKey` in the deployed `config.js` (see [config.example.js](./config.example.js)). The public key is safe to serve to browsers.
3. Create a long random cron secret, for example with PowerShell: `[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))`. Keep it out of Git. In Supabase **Edge Functions → Secrets**, set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a contact such as `mailto:you@example.com`), and `ROTA_REMINDER_SECRET`. The project-provided `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` must also be available to the function. The service role key and private VAPID key belong only in function secrets, never in browser config.
4. Link the Supabase CLI to your project (`supabase login`, then `supabase link --project-ref YOUR_PROJECT_REF`) and run `supabase functions deploy send-rota-reminders` from the repository root. [`supabase/config.toml`](./supabase/config.toml) disables gateway JWT verification for this function because Cron authenticates with the separate `x-cron-secret` header. The function rejects calls without that secret.
5. In Supabase **SQL Editor**, copy [the scheduler template](./supabase/rota_push_schedule.example.sql), replace its two placeholders with your project URL and the **same** cron secret, then run it once. It enables Cron and `pg_net`, stores those values in Vault, and schedules an hourly HTTP call. The function itself sends only in the 09:00 Europe/London hour, so UK daylight saving changes do not require changing Cron. Do not commit your filled-in SQL. If you already created this job, remove it first with `select cron.unschedule('send-rota-reminders-hourly');` before scheduling it again.
6. Serve the app over HTTPS, or use `http://localhost` for local testing. Browser push and service workers require a secure context. Sign in as an approved user and enable reminders in **Your account**. For a smoke test, create an incomplete chore assigned to that user and due today, then invoke the deployed function during the 09:00 UK hour. Check **Edge Functions → Logs** and the `cron.job_run_details` table if delivery does not occur. Claims prevent a second attempt for that chore and device on the same date.

For a simple check without waiting for 09:00, call the function outside that hour with the cron secret and expect a JSON response saying it skipped the run. Keep the secret out of terminal history where practical. [Supabase's scheduling guide](https://supabase.com/docs/guides/functions/schedule-functions) explains Cron, `pg_net`, and Vault.

### Enable reminders on a device (housemate)

1. Open the deployed Housemate site over HTTPS, sign in, and wait for your house admin to approve your account. On iPhone or iPad, open it in Safari, choose **Share → Add to Home Screen**, and launch the installed app from the Home Screen.
2. Open **Your account** from the sidebar or the notification icon. Choose **Enable reminders on this device** and allow notifications when the browser asks. The account panel should then say reminders are on. Repeat on every phone or computer where you want alerts.
3. Leave browser or app notifications enabled in your device settings. You can close the page; a due, incomplete rota task assigned to you should arrive at 9am UK time. Click it to open Rotas.
4. Choose **Disable reminders on this device** in Your account to stop them here. Signing out also removes that device's subscription; if removal fails, Housemate keeps you signed in and shows an error so you can retry. If you previously blocked notification permission, allow it for the site in your browser settings and reopen Housemate before enabling it.

## Everyday use

- **Expenses:** choose the people sharing an expense; each selected member gets an equal share and every balance recalculates.
- **Rotas:** add a task, assign it to a housemate, then tap it to mark it complete. Tasks remain saved after refresh.
- **Approval:** an admin can approve or reject pending sign-ups from the People page.
- **Recurring rota:** choose **Create recurring rota**, set its interval, select the starting person and participating housemates. Completing it assigns the next turn automatically.
- **Calendar:** use the Calendar tab to add multi-day trips, visitors, deadlines, or any other shared plan. Every approved housemate sees the same calendar.
