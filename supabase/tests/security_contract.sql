-- Read-only privilege checks. Run in the SQL Editor after migration 003.
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
end;
$$;
