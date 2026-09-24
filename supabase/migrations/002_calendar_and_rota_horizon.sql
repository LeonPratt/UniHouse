-- Run this after 001_recurring_rotas.sql.
-- It keeps ten unfinished turns scheduled for each recurring rota and adds a shared house calendar.
create table if not exists public.house_events (
  id uuid primary key default uuid_generate_v4(),
  title text not null check (char_length(title) between 2 and 160),
  starts_on date not null,
  ends_on date not null,
  location text,
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

alter table public.house_events enable row level security;
create policy "approved members manage house events"
on public.house_events for all
using (public.is_approved()) with check (public.is_approved());

-- Adds future turns until a rotation has the requested number of unfinished chores.
create or replace function public.seed_recurring_rota(p_rota_id uuid, p_target integer default 10)
returns void language plpgsql security definer set search_path = public as $$
declare
  rota public.recurring_rotas%rowtype;
  last_chore public.chores%rowtype;
  upcoming_count integer;
  following_index integer;
begin
  if auth.uid() is not null and not public.is_approved() then raise exception 'Only approved members can schedule chores'; end if;
  if p_target < 1 or p_target > 100 then raise exception 'Target must be between 1 and 100'; end if;
  select * into rota from public.recurring_rotas where id = p_rota_id and active for update;
  if not found then return; end if;
  loop
    select count(*) into upcoming_count from public.chores where recurring_rota_id = rota.id and completed_at is null;
    exit when upcoming_count >= p_target;
    select * into last_chore from public.chores where recurring_rota_id = rota.id order by due_date desc, created_at desc limit 1;
    if not found then raise exception 'A recurring rota needs an initial chore'; end if;
    following_index := coalesce(array_position(rota.member_order, last_chore.assigned_to), 1) % cardinality(rota.member_order);
    insert into public.chores (title, assigned_to, due_date, recurring_rota_id)
    values (rota.title, rota.member_order[following_index + 1], last_chore.due_date + rota.interval_days, rota.id);
    update public.recurring_rotas set current_member_index = following_index where id = rota.id;
  end loop;
end;
$$;

-- Completing a repeating chore maintains the ten-turn queue rather than waiting for a person to create it.
create or replace function public.complete_recurring_chore(p_chore_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare current_chore public.chores%rowtype;
begin
  if not public.is_approved() then raise exception 'Only approved members can complete chores'; end if;
  select * into current_chore from public.chores where id = p_chore_id for update;
  if not found then raise exception 'Chore not found'; end if;
  if current_chore.completed_at is not null then return; end if;
  update public.chores set completed_at = now() where id = p_chore_id;
  if current_chore.recurring_rota_id is not null then perform public.seed_recurring_rota(current_chore.recurring_rota_id, 10); end if;
end;
$$;

grant execute on function public.seed_recurring_rota(uuid, integer) to authenticated;
grant execute on function public.complete_recurring_chore(uuid) to authenticated;

-- Upgrade existing recurring rotas to ten visible upcoming turns.
do $$ declare item record; begin
  for item in select id from public.recurring_rotas where active loop
    perform public.seed_recurring_rota(item.id, 10);
  end loop;
end $$;
