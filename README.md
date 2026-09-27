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

### Upgrade an existing database

If the app reports that `chores.created_by` does not exist, the database is missing migration 003. In the Supabase Dashboard, open **SQL Editor**, paste the complete contents of [`supabase/migrations/003_security_hardening.sql`](./supabase/migrations/003_security_hardening.sql), and select **Run**. Then refresh the app and sign in again. The migration adds and backfills `created_by` without deleting chores.

If Supabase still reports that the column is missing after the migration succeeds, run this once in the SQL Editor to refresh its Data API schema cache:

```sql
NOTIFY pgrst, 'reload schema';
```

You can run [`supabase/tests/security_contract.sql`](./supabase/tests/security_contract.sql) in the SQL Editor afterwards to check that the public and authenticated database roles have the intended privileges. The check does not change data.

Approved members can read and add shared content. A creator or admin can edit or delete a standalone chore or calendar event; the rota creator or admin can remove a recurring rota. Only the assigned person or an admin can complete a chore. Expense shares are computed by the database in a single transaction. Admins can approve or reject pending accounts. Existing standalone chores are assigned to their current assignee as creator during the migration.

The app loads the pinned Supabase browser module from `esm.sh` and Google Fonts. Its Content Security Policy permits those origins and your Supabase project for network calls. If you use a different module host or self-host dependencies, update the CSP in both HTML pages.

The supplied frontend stays empty until those config values are added. Once configured, people, chores, expenses, splits, balances, and approval requests are all read from and written to your Supabase project.

## Everyday use

- **Expenses:** choose the people sharing an expense; each selected member gets an equal share and every balance recalculates.
- **Rotas:** add a task, assign it to a housemate, then tap it to mark it complete. Tasks remain saved after refresh.
- **Approval:** an admin can approve or reject pending sign-ups from the People page.
- **Recurring rota:** choose **Create recurring rota**, set its interval, select the starting person and participating housemates. Completing it assigns the next turn automatically.
- **Calendar:** use the Calendar tab to add multi-day trips, visitors, deadlines, or any other shared plan. Every approved housemate sees the same calendar.
