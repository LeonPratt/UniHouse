-- Housemate: single shared household schema
-- Run this in Supabase SQL editor after enabling Email auth.
create extension if not exists "uuid-ossp";

create type public.member_status as enum ('pending', 'approved', 'rejected');
create type public.member_role as enum ('admin', 'member');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 60),
  status public.member_status not null default 'pending',
  role public.member_role not null default 'member',
  created_at timestamptz not null default now()
);

create table public.chores (
  id uuid primary key default uuid_generate_v4(),
  title text not null check (char_length(title) between 2 and 120),
  assigned_to uuid not null references public.profiles(id),
  created_by uuid references public.profiles(id),
  due_date date not null,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.expenses (
  id uuid primary key default uuid_generate_v4(),
  title text not null check (char_length(title) between 2 and 160),
  amount numeric(10,2) not null check (amount > 0),
  paid_by uuid not null references public.profiles(id),
  spent_on date not null default current_date,
  created_at timestamptz not null default now()
);

create table public.expense_shares (
  expense_id uuid not null references public.expenses(id) on delete cascade,
  member_id uuid not null references public.profiles(id),
  amount numeric(10,2) not null check (amount >= 0),
  settled_at timestamptz,
  primary key (expense_id, member_id)
);

-- New email sign-ups become pending automatically. Promote the first owner manually:
-- update public.profiles set status='approved', role='admin' where id='<your-user-id>';
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.chores enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_shares enable row level security;

create or replace function public.is_approved()
returns boolean language sql stable security definer set search_path = '' as $$
 select exists (select 1 from public.profiles where id = auth.uid() and status = 'approved');
$$;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
 select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and status = 'approved');
$$;

create policy "members can see profiles" on public.profiles for select using (public.is_approved() or id = auth.uid());
create policy "admins approve members" on public.profiles for update using (public.is_admin()) with check (public.is_admin());
create policy "approved members see chores" on public.chores for select using (public.is_approved());
create policy "approved members manage chores" on public.chores for all using (public.is_approved()) with check (public.is_approved());
create policy "approved members see expenses" on public.expenses for select using (public.is_approved());
create policy "approved members add expenses" on public.expenses for insert with check (public.is_approved() and paid_by = auth.uid());
create policy "approved members manage expenses" on public.expenses for update using (paid_by = auth.uid()) with check (paid_by = auth.uid());
create policy "approved members see shares" on public.expense_shares for select using (public.is_approved());
create policy "approved members add shares" on public.expense_shares for insert with check (public.is_approved());
