# Housemate

A small single-household app for chore rotas and shared spending. The UI works out of the box with demo data: open `index.html` in a browser, or serve the folder with any static web server.

## Included

- Supabase-backed weekly rota with completion states and task creation
- Supabase-backed expense entry, equal split selection, and live balances
- Household members and an admin-only, live approval queue
- Responsive desktop and mobile layout
- A Supabase schema with pending-by-default email accounts and Row Level Security

## Connect Supabase

1. Create a Supabase project and enable Email auth.
2. Run [`supabase/schema.sql`](./supabase/schema.sql) in the SQL editor.
3. Add your project URL and anon key to [`config.js`](./config.js). The anon key is intended for browser use; access is enforced by the included RLS policies.
4. Open [`auth.html`](./auth.html), create your first account, then promote it once in SQL using the command in the schema comment. Every later sign-up is created as `pending` and cannot access the dashboard until an admin approves it.

### Add recurring rotas

To enable rotating jobs such as bins every two days, also run [`supabase/migrations/001_recurring_rotas.sql`](./supabase/migrations/001_recurring_rotas.sql) once in the Supabase SQL Editor. The app then uses a safe database function to mark a recurring job complete and create the next person’s turn.

Then run [`supabase/migrations/002_calendar_and_rota_horizon.sql`](./supabase/migrations/002_calendar_and_rota_horizon.sql). It upgrades each recurring rota to show ten upcoming turns and adds the shared house calendar.

The supplied frontend is intentionally in demo mode until those config values are added. Once configured, people, chores, expenses, splits, balances, and approval requests are all read from and written to your Supabase project.

## Everyday use

- **Expenses:** choose the people sharing an expense; each selected member gets an equal share and every balance recalculates.
- **Rotas:** add a task, assign it to a housemate, then tap it to mark it complete. Tasks remain saved after refresh.
- **Approval:** an admin can approve or reject pending sign-ups from the People page.
- **Recurring rota:** choose **Create recurring rota**, set its interval, select the starting person and participating housemates. Completing it assigns the next turn automatically.
- **Calendar:** use the Calendar tab to add multi-day trips, visitors, deadlines, or any other shared plan. Every approved housemate sees the same calendar.
