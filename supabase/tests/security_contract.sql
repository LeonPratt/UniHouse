-- Read-only privilege checks. Run in the SQL Editor after migrations 004 and 005.
do $$
begin
  if has_function_privilege('anon', 'public.seed_recurring_rota(uuid,integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.seed_recurring_rota(uuid,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.complete_recurring_chore(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.complete_recurring_chore(uuid)', 'EXECUTE')
  then raise exception 'Legacy privileged rota functions remain exposed'; end if;

  if not has_function_privilege('authenticated', 'public.create_expense(text,numeric,date,uuid[])', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.create_recurring_rota(text,integer,uuid[],date)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.set_chore_completion(uuid,boolean)', 'EXECUTE')
  then raise exception 'Required transactional functions are unavailable'; end if;

  if has_function_privilege('anon', 'public.create_expense(text,numeric,date,uuid[])', 'EXECUTE')
     or has_function_privilege('anon', 'public.create_recurring_rota(text,integer,uuid[],date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_chore_completion(uuid,boolean)', 'EXECUTE')
  then raise exception 'Anonymous callers can execute privileged functions'; end if;

  if has_table_privilege('anon', 'public.profiles', 'INSERT')
     or has_table_privilege('anon', 'public.profiles', 'UPDATE')
     or has_table_privilege('anon', 'public.chores', 'INSERT')
     or has_table_privilege('anon', 'public.chores', 'UPDATE')
     or has_table_privilege('anon', 'public.chores', 'DELETE')
     or has_table_privilege('anon', 'public.recurring_rotas', 'INSERT')
     or has_table_privilege('anon', 'public.recurring_rotas', 'UPDATE')
     or has_table_privilege('anon', 'public.recurring_rotas', 'DELETE')
     or has_table_privilege('anon', 'public.house_events', 'INSERT')
     or has_table_privilege('anon', 'public.house_events', 'UPDATE')
     or has_table_privilege('anon', 'public.house_events', 'DELETE')
     or has_table_privilege('anon', 'public.expenses', 'INSERT')
     or has_table_privilege('anon', 'public.expenses', 'UPDATE')
     or has_table_privilege('anon', 'public.expenses', 'DELETE')
     or has_table_privilege('anon', 'public.expense_shares', 'INSERT')
     or has_table_privilege('anon', 'public.expense_shares', 'UPDATE')
     or has_table_privilege('anon', 'public.expense_shares', 'DELETE')
  then raise exception 'Anonymous callers retain direct table writes'; end if;

  if has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.profiles', 'status', 'UPDATE')
     or has_column_privilege('authenticated', 'public.chores', 'completed_at', 'UPDATE')
     or has_column_privilege('authenticated', 'public.chores', 'created_by', 'UPDATE')
     or has_table_privilege('authenticated', 'public.expense_shares', 'INSERT')
     or has_table_privilege('authenticated', 'public.expenses', 'INSERT')
     or has_table_privilege('authenticated', 'public.recurring_rotas', 'INSERT')
  then raise exception 'Direct table writes are broader than intended'; end if;

  if has_table_privilege('anon', 'public.push_subscriptions', 'SELECT')
     or has_table_privilege('anon', 'public.push_subscriptions', 'INSERT')
     or has_table_privilege('anon', 'public.push_subscriptions', 'DELETE')
     or has_table_privilege('authenticated', 'public.push_subscriptions', 'UPDATE')
     or has_table_privilege('authenticated', 'private.rota_push_deliveries', 'SELECT')
     or has_table_privilege('authenticated', 'private.rota_push_deliveries', 'INSERT')
     or has_schema_privilege('authenticated', 'private', 'USAGE')
     or has_function_privilege('authenticated', 'public.claim_rota_push_delivery(uuid,uuid,date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.claim_rota_push_delivery(uuid,uuid,date)', 'EXECUTE')
  then raise exception 'Push subscription or delivery privileges are too broad'; end if;

  if not has_table_privilege('authenticated', 'public.push_subscriptions', 'INSERT')
     or not has_table_privilege('authenticated', 'public.push_subscriptions', 'DELETE')
     or not has_function_privilege('service_role', 'public.claim_rota_push_delivery(uuid,uuid,date)', 'EXECUTE')
  then raise exception 'Push notification privileges are missing'; end if;

  if not (select relrowsecurity from pg_class where oid = 'public.push_subscriptions'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'private.rota_push_deliveries'::regclass)
  then raise exception 'Push notification RLS is disabled'; end if;

  if not has_function_privilege('authenticated', 'public.create_pub_golf_game(text,integer,text[])', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.set_pub_golf_score(uuid,uuid,integer,integer,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.create_pub_golf_game(text,integer,text[])', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_pub_golf_score(uuid,uuid,integer,integer,integer)', 'EXECUTE')
  then raise exception 'Pub Golf RPC privileges are incorrect'; end if;

  if has_table_privilege('anon', 'public.pub_golf_games', 'SELECT')
     or has_table_privilege('anon', 'public.pub_golf_teams', 'SELECT')
     or has_table_privilege('anon', 'public.pub_golf_scores', 'SELECT')
     or has_table_privilege('authenticated', 'public.pub_golf_games', 'INSERT')
     or has_table_privilege('authenticated', 'public.pub_golf_games', 'UPDATE')
     or has_table_privilege('authenticated', 'public.pub_golf_teams', 'INSERT')
     or has_table_privilege('authenticated', 'public.pub_golf_teams', 'UPDATE')
     or has_table_privilege('authenticated', 'public.pub_golf_teams', 'DELETE')
     or has_table_privilege('authenticated', 'public.pub_golf_scores', 'INSERT')
     or has_table_privilege('authenticated', 'public.pub_golf_scores', 'UPDATE')
     or has_table_privilege('authenticated', 'public.pub_golf_scores', 'DELETE')
     or not has_table_privilege('authenticated', 'public.pub_golf_games', 'DELETE')
  then raise exception 'Pub Golf table privileges are incorrect'; end if;

  if not (select relrowsecurity from pg_class where oid = 'public.pub_golf_games'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.pub_golf_teams'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.pub_golf_scores'::regclass)
  then raise exception 'Pub Golf RLS is disabled'; end if;
end;
$$;
