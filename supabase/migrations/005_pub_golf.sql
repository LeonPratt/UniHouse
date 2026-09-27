-- Pub Golf games and scorecards. Run after migration 003 (and 004 if used).
create table if not exists public.pub_golf_games (
  id uuid primary key default uuid_generate_v4(),
  title text not null check (char_length(btrim(title)) between 2 and 100),
  hole_count integer not null check (hole_count between 1 and 36),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.pub_golf_teams (
  id uuid primary key default uuid_generate_v4(),
  game_id uuid not null references public.pub_golf_games(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  position integer not null check (position between 1 and 20),
  unique (game_id, position)
);
create unique index if not exists pub_golf_teams_unique_name
  on public.pub_golf_teams (game_id, lower(btrim(name)));

create table if not exists public.pub_golf_scores (
  team_id uuid not null references public.pub_golf_teams(id) on delete cascade,
  hole_number integer not null check (hole_number between 1 and 36),
  strokes integer check (strokes between 1 and 1000),
  penalties integer not null default 0 check (penalties between 0 and 1000),
  primary key (team_id, hole_number)
);

alter table public.pub_golf_games enable row level security;
alter table public.pub_golf_teams enable row level security;
alter table public.pub_golf_scores enable row level security;

drop policy if exists "approved members see pub golf games" on public.pub_golf_games;
create policy "approved members see pub golf games" on public.pub_golf_games
  for select using (public.is_approved());
drop policy if exists "creators and admins delete pub golf games" on public.pub_golf_games;
create policy "creators and admins delete pub golf games" on public.pub_golf_games
  for delete using (public.is_approved() and (created_by = auth.uid() or public.is_admin()));
drop policy if exists "approved members see pub golf teams" on public.pub_golf_teams;
create policy "approved members see pub golf teams" on public.pub_golf_teams
  for select using (public.is_approved());
drop policy if exists "approved members see pub golf scores" on public.pub_golf_scores;
create policy "approved members see pub golf scores" on public.pub_golf_scores
  for select using (public.is_approved());

revoke all on public.pub_golf_games, public.pub_golf_teams, public.pub_golf_scores
  from public, anon, authenticated;
grant select on public.pub_golf_games, public.pub_golf_teams, public.pub_golf_scores to authenticated;
grant delete on public.pub_golf_games to authenticated;

create or replace function public.create_pub_golf_game(p_title text, p_hole_count integer, p_team_names text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_game_id uuid; team_count integer;
begin
  if not public.is_approved() then raise exception 'Only approved members can create games'; end if;
  if p_title is null or char_length(btrim(p_title)) not between 2 and 100
     or p_hole_count is null or p_hole_count not between 1 and 36
  then raise exception 'Enter a game name and 1 to 36 holes'; end if;
  team_count := cardinality(p_team_names);
  if team_count is null or team_count not between 2 and 20
     or exists (select 1 from unnest(p_team_names) as names(name)
                where name is null or char_length(btrim(name)) not between 1 and 60)
     or (select count(distinct lower(btrim(name))) from unnest(p_team_names) as names(name)) <> team_count
  then raise exception 'Enter 2 to 20 distinct team names'; end if;
  insert into public.pub_golf_games (title, hole_count, created_by)
  values (btrim(p_title), p_hole_count, auth.uid()) returning id into new_game_id;
  insert into public.pub_golf_teams (game_id, name, position)
  select new_game_id, btrim(name), ordinal::integer
  from unnest(p_team_names) with ordinality as names(name, ordinal);
  return new_game_id;
end;
$$;

create or replace function public.set_pub_golf_score(
  p_game_id uuid, p_team_id uuid, p_hole_number integer, p_strokes integer, p_penalties integer
)
returns void language plpgsql security definer set search_path = '' as $$
declare game_holes integer;
begin
  if not public.is_approved() then raise exception 'Only approved members can score games'; end if;
  select g.hole_count into game_holes from public.pub_golf_games g
    join public.pub_golf_teams t on t.game_id = g.id
    where g.id = p_game_id and t.id = p_team_id;
  if game_holes is null then raise exception 'Team does not belong to this game'; end if;
  if p_hole_number is null or p_hole_number not between 1 and game_holes
     or (p_strokes is not null and p_strokes not between 1 and 1000)
     or p_penalties is null or p_penalties not between 0 and 1000
     or (p_strokes is null and p_penalties <> 0)
  then raise exception 'Invalid hole, strokes, or penalties'; end if;
  if p_strokes is null and p_penalties = 0 then
    delete from public.pub_golf_scores where team_id = p_team_id and hole_number = p_hole_number;
  else
    insert into public.pub_golf_scores (team_id, hole_number, strokes, penalties)
    values (p_team_id, p_hole_number, p_strokes, p_penalties)
    on conflict (team_id, hole_number) do update
      set strokes = excluded.strokes, penalties = excluded.penalties;
  end if;
end;
$$;

revoke all on function public.create_pub_golf_game(text, integer, text[]) from public, anon, authenticated;
revoke all on function public.set_pub_golf_score(uuid, uuid, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.create_pub_golf_game(text, integer, text[]) to authenticated;
grant execute on function public.set_pub_golf_score(uuid, uuid, integer, integer, integer) to authenticated;

notify pgrst, 'reload schema';
