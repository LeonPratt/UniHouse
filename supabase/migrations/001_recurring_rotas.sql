-- Run this once in Supabase SQL Editor after supabase/schema.sql.
-- Stores a recurring schedule separately from the individual chore occurrences.
create table if not exists public.recurring_rotas (
  id uuid primary key default uuid_generate_v4(),
  title text not null check (char_length(title) between 2 and 120),
  interval_days integer not null check (interval_days between 1 and 365),
  member_order uuid[] not null check (cardinality(member_order) > 0),
  current_member_index integer not null default 0,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.chores add column if not exists recurring_rota_id uuid references public.recurring_rotas(id) on delete cascade;
alter table public.recurring_rotas enable row level security;

create policy "approved members manage recurring rotas"
on public.recurring_rotas for all
using (public.is_approved()) with check (public.is_approved());

-- Completes the current occurrence and queues exactly one next occurrence.
-- Row locks make double-clicks or two housemates completing it at once safe.
create or replace function public.complete_recurring_chore(p_chore_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  current_chore public.chores%rowtype;
  rota public.recurring_rotas%rowtype;
  following_index integer;
begin
  if not public.is_approved() then raise exception 'Only approved members can complete chores'; end if;

  select * into current_chore from public.chores where id = p_chore_id for update;
  if not found then raise exception 'Chore not found'; end if;
  if current_chore.completed_at is not null then return; end if;

  update public.chores set completed_at = now() where id = p_chore_id;
  if current_chore.recurring_rota_id is null then return; end if;

  select * into rota from public.recurring_rotas where id = current_chore.recurring_rota_id for update;
  if not found or not rota.active then return; end if;

  following_index := (rota.current_member_index + 1) % cardinality(rota.member_order);
  insert into public.chores (title, assigned_to, due_date, recurring_rota_id)
  values (rota.title, rota.member_order[following_index + 1], current_chore.due_date + rota.interval_days, rota.id);
  update public.recurring_rotas set current_member_index = following_index where id = rota.id;
end;
$$;

grant execute on function public.complete_recurring_chore(uuid) to authenticated;
