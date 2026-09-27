-- Run after 002_calendar_and_rota_horizon.sql. Safe to run again.
-- This migration narrows table privileges and moves multi-row writes into transactions.

alter table public.chores add column if not exists created_by uuid references public.profiles(id);
update public.chores c set created_by = r.created_by
from public.recurring_rotas r where c.recurring_rota_id = r.id and c.created_by is null;
update public.chores set created_by = assigned_to where created_by is null;
alter table public.chores alter column created_by set not null;

alter table public.chores drop constraint if exists chores_title_length;
alter table public.chores add constraint chores_title_length check (char_length(title) between 2 and 120) not valid;
alter table public.expenses drop constraint if exists expenses_title_length;
alter table public.expenses add constraint expenses_title_length check (char_length(title) between 2 and 160) not valid;
alter table public.house_events drop constraint if exists house_events_location_length;
alter table public.house_events add constraint house_events_location_length check (location is null or char_length(location) <= 160) not valid;
alter table public.house_events drop constraint if exists house_events_notes_length;
alter table public.house_events add constraint house_events_notes_length check (notes is null or char_length(notes) <= 1000) not valid;

drop policy if exists "members can see profiles" on public.profiles;
create policy "members can see profiles" on public.profiles for select
using ((status = 'approved' and public.is_approved()) or id = auth.uid() or public.is_admin());
drop policy if exists "admins approve members" on public.profiles;
drop policy if exists "admins approve pending members" on public.profiles;
create policy "admins approve pending members" on public.profiles for update
using (public.is_admin() and status = 'pending')
with check (public.is_admin() and status in ('approved', 'rejected'));

drop policy if exists "approved members manage chores" on public.chores;
drop policy if exists "approved members see chores" on public.chores;
drop policy if exists "approved members create standalone chores" on public.chores;
drop policy if exists "creators and admins edit standalone chores" on public.chores;
drop policy if exists "creators and admins delete standalone chores" on public.chores;
create policy "approved members see chores" on public.chores for select using (public.is_approved());
create policy "approved members create standalone chores" on public.chores for insert
with check (public.is_approved() and created_by = auth.uid() and recurring_rota_id is null
  and exists (select 1 from public.profiles p where p.id = assigned_to and p.status = 'approved'));
create policy "creators and admins edit standalone chores" on public.chores for update
using (public.is_approved() and recurring_rota_id is null and (created_by = auth.uid() or public.is_admin()))
with check (public.is_approved() and recurring_rota_id is null and (created_by = auth.uid() or public.is_admin())
  and exists (select 1 from public.profiles p where p.id = assigned_to and p.status = 'approved'));
create policy "creators and admins delete standalone chores" on public.chores for delete
using (public.is_approved() and recurring_rota_id is null and (created_by = auth.uid() or public.is_admin()));

drop policy if exists "approved members manage recurring rotas" on public.recurring_rotas;
drop policy if exists "approved members see recurring rotas" on public.recurring_rotas;
drop policy if exists "creators and admins delete recurring rotas" on public.recurring_rotas;
create policy "approved members see recurring rotas" on public.recurring_rotas for select using (public.is_approved());
create policy "creators and admins delete recurring rotas" on public.recurring_rotas for delete
using (public.is_approved() and (created_by = auth.uid() or public.is_admin()));

drop policy if exists "approved members manage house events" on public.house_events;
drop policy if exists "approved members see events" on public.house_events;
drop policy if exists "approved members create events" on public.house_events;
drop policy if exists "creators and admins edit events" on public.house_events;
drop policy if exists "creators and admins delete events" on public.house_events;
create policy "approved members see events" on public.house_events for select using (public.is_approved());
create policy "approved members create events" on public.house_events for insert
with check (public.is_approved() and created_by = auth.uid());
create policy "creators and admins edit events" on public.house_events for update
using (public.is_approved() and (created_by = auth.uid() or public.is_admin()))
with check (public.is_approved() and (created_by = auth.uid() or public.is_admin()));
create policy "creators and admins delete events" on public.house_events for delete
using (public.is_approved() and (created_by = auth.uid() or public.is_admin()));

drop policy if exists "approved members add expenses" on public.expenses;
drop policy if exists "approved members manage expenses" on public.expenses;
drop policy if exists "payers and admins delete expenses" on public.expenses;
create policy "payers and admins delete expenses" on public.expenses for delete
using (public.is_approved() and (paid_by = auth.uid() or public.is_admin()));
drop policy if exists "approved members add shares" on public.expense_shares;

-- Supabase may have installed broad table grants. RLS alone is insufficient for
-- column-specific rules such as preventing direct completion and role changes.
revoke all on public.profiles, public.chores, public.recurring_rotas,
  public.expenses, public.expense_shares, public.house_events from public, anon, authenticated;
grant select on public.profiles, public.chores, public.recurring_rotas,
  public.expenses, public.expense_shares, public.house_events to authenticated;
grant update (status) on public.profiles to authenticated;
grant insert (title, assigned_to, due_date, created_by) on public.chores to authenticated;
grant update (title, assigned_to, due_date) on public.chores to authenticated;
grant delete on public.chores to authenticated;
grant delete on public.recurring_rotas to authenticated;
grant insert (title, starts_on, ends_on, location, notes, created_by) on public.house_events to authenticated;
grant update (title, starts_on, ends_on, location, notes) on public.house_events to authenticated;
grant delete on public.house_events to authenticated;
grant delete on public.expenses to authenticated;

create or replace function public.seed_recurring_rota(p_rota_id uuid, p_target integer default 10)
returns void language plpgsql security definer set search_path = '' as $$
declare
  rota public.recurring_rotas%rowtype;
  last_chore public.chores%rowtype;
  upcoming_count integer;
  following_index integer;
begin
  if not public.is_approved() then raise exception 'Only approved members can schedule chores'; end if;
  if p_target < 1 or p_target > 100 then raise exception 'Target must be between 1 and 100'; end if;
  select * into rota from public.recurring_rotas where id = p_rota_id and active for update;
  if not found then return; end if;
  loop
    select count(*) into upcoming_count from public.chores where recurring_rota_id = rota.id and completed_at is null;
    exit when upcoming_count >= p_target;
    select * into last_chore from public.chores where recurring_rota_id = rota.id order by due_date desc, created_at desc limit 1;
    if not found then raise exception 'A recurring rota needs an initial chore'; end if;
    following_index := coalesce(array_position(rota.member_order, last_chore.assigned_to), 1) % cardinality(rota.member_order);
    insert into public.chores (title, assigned_to, created_by, due_date, recurring_rota_id)
    values (rota.title, rota.member_order[following_index + 1], rota.created_by, last_chore.due_date + rota.interval_days, rota.id);
    update public.recurring_rotas set current_member_index = following_index where id = rota.id;
  end loop;
end;
$$;

create or replace function public.create_recurring_rota(p_title text, p_interval_days integer, p_member_order uuid[], p_start_date date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid; member_count integer;
begin
  if not public.is_approved() then raise exception 'Only approved members can create rotas'; end if;
  if p_title is null or char_length(p_title) not between 2 and 120 then raise exception 'Invalid rota title'; end if;
  if p_interval_days is null or p_interval_days not between 1 and 365 or p_start_date is null then raise exception 'Invalid schedule'; end if;
  member_count := cardinality(p_member_order);
  if member_count is null or member_count < 1 or member_count > 100
     or (select count(distinct member_id) from unnest(p_member_order) as members(member_id)) <> member_count
     or (select count(*) from public.profiles where id = any(p_member_order) and status = 'approved') <> member_count
  then raise exception 'Choose distinct approved members'; end if;
  insert into public.recurring_rotas (title, interval_days, member_order, created_by)
  values (p_title, p_interval_days, p_member_order, auth.uid()) returning id into new_id;
  insert into public.chores (title, assigned_to, created_by, due_date, recurring_rota_id)
  values (p_title, p_member_order[1], auth.uid(), p_start_date, new_id);
  perform public.seed_recurring_rota(new_id, 10);
  return new_id;
end;
$$;

create or replace function public.set_chore_completion(p_chore_id uuid, p_complete boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare current_chore public.chores%rowtype;
begin
  if not public.is_approved() then raise exception 'Only approved members can complete chores'; end if;
  if p_complete is null then raise exception 'Completion state is required'; end if;
  select * into current_chore from public.chores where id = p_chore_id for update;
  if not found then raise exception 'Chore not found'; end if;
  if current_chore.assigned_to <> auth.uid() and not public.is_admin() then
    raise exception 'Only the assignee or an admin can complete this chore';
  end if;
  if current_chore.recurring_rota_id is not null and not p_complete then
    raise exception 'A recurring turn cannot be reopened';
  end if;
  if (current_chore.completed_at is not null) = p_complete then return; end if;
  update public.chores set completed_at = case when p_complete then now() else null end where id = p_chore_id;
  if current_chore.recurring_rota_id is not null then
    perform public.seed_recurring_rota(current_chore.recurring_rota_id, 10);
  end if;
end;
$$;

create or replace function public.create_expense(p_title text, p_amount numeric, p_spent_on date, p_member_ids uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid; member_count integer; pennies bigint; base_pennies bigint; remainder bigint;
begin
  if not public.is_approved() then raise exception 'Only approved members can add expenses'; end if;
  if p_title is null or char_length(p_title) not between 2 and 160 then raise exception 'Invalid expense title'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 99999999.99 or p_amount <> round(p_amount, 2) or p_spent_on is null
  then raise exception 'Invalid expense amount or date'; end if;
  member_count := cardinality(p_member_ids);
  if member_count is null or member_count < 1 or member_count > 100
     or (select count(distinct member_id) from unnest(p_member_ids) as members(member_id)) <> member_count
     or (select count(*) from public.profiles where id = any(p_member_ids) and status = 'approved') <> member_count
  then raise exception 'Choose distinct approved members'; end if;
  pennies := (p_amount * 100)::bigint;
  base_pennies := pennies / member_count;
  remainder := pennies % member_count;
  insert into public.expenses (title, amount, paid_by, spent_on)
  values (p_title, p_amount, auth.uid(), p_spent_on) returning id into new_id;
  insert into public.expense_shares (expense_id, member_id, amount)
  select new_id, member_id, (base_pennies + case when ordinal <= remainder then 1 else 0 end) / 100.0
  from unnest(p_member_ids) with ordinality as members(member_id, ordinal);
  return new_id;
end;
$$;

-- Retire the older callable completion function. Its replacement checks the assignee.
revoke all on function public.complete_recurring_chore(uuid) from public, anon, authenticated;
revoke all on function public.seed_recurring_rota(uuid, integer) from public, anon, authenticated;
revoke all on function public.create_recurring_rota(text, integer, uuid[], date) from public, anon, authenticated;
revoke all on function public.set_chore_completion(uuid, boolean) from public, anon, authenticated;
revoke all on function public.create_expense(text, numeric, date, uuid[]) from public, anon, authenticated;
grant execute on function public.create_recurring_rota(text, integer, uuid[], date) to authenticated;
grant execute on function public.set_chore_completion(uuid, boolean) to authenticated;
grant execute on function public.create_expense(text, numeric, date, uuid[]) to authenticated;

-- These helper functions need no public API access. Policies/functions call them as owner.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;
create or replace function public.is_approved()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'approved');
$$;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and status = 'approved');
$$;
revoke all on function public.is_approved() from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- Ensure the Data API sees the new column and RPCs immediately.
notify pgrst, 'reload schema';
grant execute on function public.is_approved() to authenticated;
grant execute on function public.is_admin() to authenticated;
