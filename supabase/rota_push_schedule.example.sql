-- Run only after replacing both placeholders. Keep this file as a template;
-- never commit your actual secret. pg_cron runs in UTC, so invoke hourly and
-- let the Edge Function check 09:00 Europe/London across DST changes.
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'rota_push_project_url');
select vault.create_secret('PASTE_A_LONG_RANDOM_CRON_SECRET', 'rota_push_cron_secret');

do $$
begin
  if exists (
    select 1 from vault.decrypted_secrets
    where name = 'rota_push_project_url' and decrypted_secret like '%YOUR_PROJECT_REF%'
       or name = 'rota_push_cron_secret' and decrypted_secret = 'PASTE_A_LONG_RANDOM_CRON_SECRET'
  ) then raise exception 'Replace the project URL and cron secret placeholders before scheduling'; end if;
end;
$$;

select cron.schedule(
  'send-rota-reminders-hourly',
  '0 * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'rota_push_project_url') || '/functions/v1/send-rota-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'rota_push_cron_secret')
      ),
      body := '{}'::jsonb
    );
  $$
);
