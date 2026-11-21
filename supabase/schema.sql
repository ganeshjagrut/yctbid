-- =====================================================================
-- YCT Cricket Auction — database schema
-- Run this whole file once in Supabase: Dashboard → SQL Editor → New query → Run
-- Then change the admin PIN at the bottom of this file (or run the UPDATE there).
-- =====================================================================

-- ---------- Tables ----------------------------------------------------

create table if not exists settings (
  id                 int primary key default 1 check (id = 1),
  tournament_name    text not null default 'YCT Season 2',
  upcoming_text      text default 'Auction goes live on Tuesday',
  logo_url           text,
  budget             int  not null default 1000,
  squad_size         int  not null default 7,   -- players each captain buys (captain not counted)
  reserve_price      int  not null default 70,  -- points kept back for every empty squad slot
  default_base_price int  not null default 70,
  first_bid_seconds  int  not null default 45,  -- timer when a player comes up (30–60)
  bid_seconds        int  not null default 30,  -- timer reset after every bid
  increments         int[] not null default '{5,10,20,40}'
);

create table if not exists teams (
  id           serial primary key,
  name         text not null,
  captain_name text,
  color        text not null default '#f59e0b',
  points_left  int  not null default 1000,
  sort_order   int  not null default 0
);

create table if not exists team_secrets (
  team_id int primary key references teams(id) on delete cascade,
  pin     text not null
);

create table if not exists admin_secret (
  id  int primary key default 1 check (id = 1),
  pin text not null
);

create table if not exists players (
  id         serial primary key,
  name       text not null,
  category   text,
  base_price int  not null default 70,
  photo_url  text,
  status     text not null default 'available'
             check (status in ('available','live','sold','unsold')),
  team_id    int references teams(id),
  sold_price int,
  attempts   int not null default 0,      -- last round in which the player went unsold
  closed_at  timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists bids (
  id         bigserial primary key,
  player_id  int not null references players(id) on delete cascade,
  team_id    int not null references teams(id) on delete cascade,
  amount     int not null,
  round      int not null default 1,
  by_admin   boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists bids_player_idx on bids(player_id);

create table if not exists auction_state (
  id                int primary key default 1 check (id = 1),
  status            text not null default 'idle' check (status in ('idle','live','closed')),
  round             int  not null default 1,
  current_player_id int references players(id) on delete set null,
  current_bid       int,
  leading_team_id   int references teams(id) on delete set null,
  active_bidders    int[] not null default '{}',   -- at most 2 captains bidding at a time
  withdrawn         int[] not null default '{}',   -- captains who withdrew from this player
  timer_ends_at     timestamptz,
  last_result       jsonb,
  updated_at        timestamptz not null default now()
);

alter table settings add column if not exists upcoming_text text default 'Auction goes live on Tuesday';
insert into settings (id) values (1) on conflict do nothing;
insert into auction_state (id) values (1) on conflict do nothing;
insert into admin_secret (id, pin) values (1, 'CHANGE-ME') on conflict do nothing;

-- ---------- Security: everyone can read, nobody can write directly ----

alter table settings      enable row level security;
alter table teams         enable row level security;
alter table team_secrets  enable row level security;
alter table admin_secret  enable row level security;
alter table players       enable row level security;
alter table bids          enable row level security;
alter table auction_state enable row level security;

drop policy if exists "public read" on settings;
drop policy if exists "public read" on teams;
drop policy if exists "public read" on players;
drop policy if exists "public read" on bids;
drop policy if exists "public read" on auction_state;
create policy "public read" on settings      for select using (true);
create policy "public read" on teams         for select using (true);
create policy "public read" on players       for select using (true);
create policy "public read" on bids          for select using (true);
create policy "public read" on auction_state for select using (true);

revoke all on team_secrets, admin_secret from anon, authenticated;
revoke insert, update, delete on settings, teams, players, bids, auction_state from anon, authenticated;

-- Live updates
do $$
begin
  begin alter publication supabase_realtime add table settings;      exception when others then null; end;
  begin alter publication supabase_realtime add table teams;         exception when others then null; end;
  begin alter publication supabase_realtime add table players;       exception when others then null; end;
  begin alter publication supabase_realtime add table bids;          exception when others then null; end;
  begin alter publication supabase_realtime add table auction_state; exception when others then null; end;
end $$;

-- ---------- Internal helpers (not callable from the app) --------------

create or replace function _check_admin(p_pin text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from admin_secret where id = 1 and pin = p_pin) then
    raise exception 'Wrong admin PIN';
  end if;
end $$;

create or replace function _check_team(p_team_id int, p_pin text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from team_secrets where team_id = p_team_id and pin = p_pin) then
    raise exception 'Wrong team or PIN';
  end if;
end $$;

create or replace function team_max_bid(p_team_id int) returns int
language plpgsql stable security definer set search_path = public as $$
declare st settings; t teams; n int;
begin
  select * into st from settings where id = 1;
  select * into t from teams where id = p_team_id;
  if not found then return -1; end if;
  select count(*) into n from players where team_id = p_team_id and status = 'sold';
  if n >= st.squad_size then return -1; end if;
  return t.points_left - st.reserve_price * (st.squad_size - n - 1);
end $$;

create or replace function _place_bid(p_team_id int, p_amount int, p_by_admin boolean) returns void
language plpgsql security definer set search_path = public as $$
declare s auction_state; st settings; p players; mx int; tname text;
begin
  select * into s from auction_state where id = 1 for update;
  select * into st from settings where id = 1;

  if s.status <> 'live' or s.current_player_id is null then
    raise exception 'No player is up for bidding right now';
  end if;
  if now() > s.timer_ends_at then
    raise exception 'Time is up for this player';
  end if;
  if p_team_id = s.leading_team_id then
    raise exception 'You already have the highest bid';
  end if;
  -- A team that was knocked out or withdrew may come back in when a spot is free.
  if not (p_team_id = any(s.active_bidders)) and coalesce(array_length(s.active_bidders, 1), 0) >= 2 then
    raise exception 'Two captains are already bidding. Wait for one of them to withdraw.';
  end if;

  select * into p from players where id = s.current_player_id;

  if s.current_bid is null then
    if p_amount < p.base_price then
      raise exception 'Minimum bid is %', p.base_price;
    end if;
    if not p_by_admin and p_amount <> p.base_price then
      raise exception 'First bid must be the base price (%)', p.base_price;
    end if;
  else
    if p_amount <= s.current_bid then
      raise exception 'Bid must be higher than %', s.current_bid;
    end if;
    if not p_by_admin and not ((p_amount - s.current_bid) = any(st.increments)) then
      raise exception 'Invalid bid increment';
    end if;
  end if;

  mx := team_max_bid(p_team_id);
  if mx < 0 then
    raise exception 'Squad is already complete';
  end if;
  if p_amount > mx then
    select name into tname from teams where id = p_team_id;
    raise exception '% can bid at most % (points must be kept for remaining players)', tname, mx;
  end if;

  insert into bids (player_id, team_id, amount, round, by_admin)
  values (s.current_player_id, p_team_id, p_amount, s.round, p_by_admin);

  update auction_state set
    current_bid     = p_amount,
    leading_team_id = p_team_id,
    active_bidders  = case when p_team_id = any(active_bidders) then active_bidders
                           else array_append(active_bidders, p_team_id) end,
    timer_ends_at   = now() + make_interval(secs => st.bid_seconds),
    updated_at      = now()
  where id = 1;
end $$;

create or replace function _close_current() returns void
language plpgsql security definer set search_path = public as $$
declare s auction_state; p players; res jsonb;
begin
  select * into s from auction_state where id = 1 for update;
  if s.status <> 'live' or s.current_player_id is null then
    raise exception 'No player is live';
  end if;
  select * into p from players where id = s.current_player_id;

  if s.leading_team_id is null then
    update players set status = 'unsold', attempts = s.round, closed_at = now() where id = p.id;
    res := jsonb_build_object('result', 'unsold', 'player_id', p.id, 'player', p.name);
  else
    update players set status = 'sold', team_id = s.leading_team_id, sold_price = s.current_bid,
                       closed_at = now()
    where id = p.id;
    update teams set points_left = points_left - s.current_bid where id = s.leading_team_id;
    res := jsonb_build_object('result', 'sold', 'player_id', p.id, 'player', p.name,
                              'team_id', s.leading_team_id, 'amount', s.current_bid);
  end if;

  update auction_state set status = 'closed', timer_ends_at = null, last_result = res,
                           active_bidders = '{}', withdrawn = '{}', updated_at = now()
  where id = 1;
end $$;

revoke execute on function _check_admin(text)            from public, anon, authenticated;
revoke execute on function _check_team(int, text)         from public, anon, authenticated;
revoke execute on function _place_bid(int, int, boolean)  from public, anon, authenticated;
revoke execute on function _close_current()               from public, anon, authenticated;

-- ---------- Public functions ------------------------------------------

create or replace function server_now() returns timestamptz
language sql stable as $$ select now() $$;

-- Called by every open screen when the timer hits zero. It only acts when the timer
-- has really run out on the server, and then:
--   no bid yet                 → player UNSOLD
--   two captains in a duel     → the one not leading is OUT; everyone else gets bid_seconds to enter
--   only the leader remains    → player SOLD to the leader
create or replace function expire_check() returns void
language plpgsql security definer set search_path = public as $$
declare s auction_state; st settings; challenger int;
begin
  select * into s from auction_state where id = 1 for update;
  if s.status <> 'live' or s.timer_ends_at is null or now() <= s.timer_ends_at then
    return;
  end if;
  if s.leading_team_id is null then
    perform _close_current();
  elsif coalesce(array_length(array_remove(s.active_bidders, s.leading_team_id), 1), 0) > 0 then
    select * into st from settings where id = 1;
    challenger := (array_remove(s.active_bidders, s.leading_team_id))[1];
    update auction_state set
      active_bidders = array[s.leading_team_id],
      withdrawn      = array_append(withdrawn, challenger),
      timer_ends_at  = now() + make_interval(secs => st.bid_seconds),
      updated_at     = now()
    where id = 1;
  else
    perform _close_current();
  end if;
end $$;

-- ---------- Captain functions -----------------------------------------

create or replace function captain_login(p_team_id int, p_pin text) returns text
language plpgsql security definer set search_path = public as $$
declare n text;
begin
  perform _check_team(p_team_id, p_pin);
  select name into n from teams where id = p_team_id;
  return n;
end $$;

create or replace function captain_bid(p_team_id int, p_pin text, p_amount int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _check_team(p_team_id, p_pin);
  perform _place_bid(p_team_id, p_amount, false);
end $$;

create or replace function captain_withdraw(p_team_id int, p_pin text) returns void
language plpgsql security definer set search_path = public as $$
declare s auction_state;
begin
  perform _check_team(p_team_id, p_pin);
  select * into s from auction_state where id = 1 for update;
  if s.status <> 'live' then raise exception 'No player is up for bidding'; end if;
  if not (p_team_id = any(s.active_bidders)) then raise exception 'You are not bidding on this player'; end if;
  if p_team_id = s.leading_team_id then raise exception 'You have the highest bid and cannot withdraw'; end if;
  update auction_state set
    active_bidders = array_remove(active_bidders, p_team_id),
    withdrawn      = array_append(withdrawn, p_team_id),
    timer_ends_at  = now() + make_interval(secs => (select bid_seconds from settings where id = 1)),
    updated_at     = now()
  where id = 1;
end $$;

-- ---------- Admin functions -------------------------------------------

create or replace function admin_login(p_pin text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform _check_admin(p_pin);
  return true;
end $$;

create or replace function admin_bid(p_pin text, p_team_id int, p_amount int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _check_admin(p_pin);
  perform _place_bid(p_team_id, p_amount, true);
end $$;

create or replace function admin_next_player(p_pin text, p_seconds int) returns int
language plpgsql security definer set search_path = public as $$
declare s auction_state; st settings; p players; secs int;
begin
  perform _check_admin(p_pin);
  select * into s from auction_state where id = 1 for update;
  if s.status = 'live' then raise exception 'Close the current player first'; end if;
  select * into st from settings where id = 1;

  if s.round = 1 then
    select * into p from players where status = 'available' order by random() limit 1;
  else
    select * into p from players where status = 'unsold' and attempts < s.round order by random() limit 1;
  end if;
  if not found then
    raise exception 'No players left in round %', s.round;
  end if;

  secs := greatest(30, least(60, coalesce(p_seconds, st.first_bid_seconds)));
  update players set status = 'live' where id = p.id;
  update auction_state set
    status = 'live', current_player_id = p.id, current_bid = null, leading_team_id = null,
    active_bidders = '{}', withdrawn = '{}', last_result = null,
    timer_ends_at = now() + make_interval(secs => secs), updated_at = now()
  where id = 1;
  return p.id;
end $$;

create or replace function admin_close_player(p_pin text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _check_admin(p_pin);
  perform _close_current();
end $$;

create or replace function admin_set_timer(p_pin text, p_seconds int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _check_admin(p_pin);
  if p_seconds < 5 or p_seconds > 600 then raise exception 'Timer must be 5–600 seconds'; end if;
  update auction_state set timer_ends_at = now() + make_interval(secs => p_seconds), updated_at = now()
  where id = 1 and status = 'live';
  if not found then raise exception 'No player is live'; end if;
end $$;

-- Re-open the player that was just closed (fixes a wrong Sold/Unsold click).
create or replace function admin_reopen(p_pin text) returns void
language plpgsql security definer set search_path = public as $$
declare s auction_state; st settings; p players; b bids;
begin
  perform _check_admin(p_pin);
  select * into s from auction_state where id = 1 for update;
  select * into st from settings where id = 1;
  if s.status <> 'closed' or s.current_player_id is null then
    raise exception 'Nothing to re-open';
  end if;
  select * into p from players where id = s.current_player_id;
  if p.status = 'sold' then
    update teams set points_left = points_left + p.sold_price where id = p.team_id;
  end if;
  update players set status = 'live', team_id = null, sold_price = null, closed_at = null,
                     attempts = greatest(0, s.round - 1)
  where id = p.id;

  select * into b from bids where player_id = p.id and round = s.round order by amount desc, id desc limit 1;
  update auction_state set
    status = 'live',
    current_bid = b.amount,
    leading_team_id = b.team_id,
    active_bidders = case when b.team_id is null then '{}'::int[] else array[b.team_id] end,
    withdrawn = '{}',
    last_result = null,
    timer_ends_at = now() + make_interval(secs => case when b.id is null then st.first_bid_seconds else st.bid_seconds end),
    updated_at = now()
  where id = 1;
end $$;

create or replace function admin_start_round(p_pin text, p_round int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _check_admin(p_pin);
  if p_round < 1 then raise exception 'Invalid round'; end if;
  update auction_state set round = p_round, status = 'idle', current_player_id = null,
         current_bid = null, leading_team_id = null, active_bidders = '{}', withdrawn = '{}',
         timer_ends_at = null, last_result = null, updated_at = now()
  where id = 1 and status <> 'live';
  if not found then raise exception 'Close the current player first'; end if;
end $$;

create or replace function admin_save_settings(p_pin text, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare inc int[]; x int;
begin
  perform _check_admin(p_pin);
  if p ? 'increments' then
    select array_agg(v::int order by v::int) into inc from jsonb_array_elements_text(p->'increments') v;
    if inc is null or array_length(inc, 1) < 1 or array_length(inc, 1) > 4 then
      raise exception 'Set 1 to 4 bid buttons';
    end if;
    foreach x in array inc loop
      if x < 1 or x > 40 then raise exception 'Each bid button must be between 1 and 40'; end if;
    end loop;
  end if;
  if p ? 'first_bid_seconds' and ((p->>'first_bid_seconds')::int < 30 or (p->>'first_bid_seconds')::int > 60) then
    raise exception 'First-bid timer must be 30–60 seconds';
  end if;
  update settings set
    tournament_name    = coalesce(p->>'tournament_name', tournament_name),
    logo_url           = case when p ? 'logo_url' then nullif(p->>'logo_url', '') else logo_url end,
    upcoming_text      = case when p ? 'upcoming_text' then nullif(p->>'upcoming_text', '') else upcoming_text end,
    budget             = coalesce((p->>'budget')::int, budget),
    squad_size         = coalesce((p->>'squad_size')::int, squad_size),
    reserve_price      = coalesce((p->>'reserve_price')::int, reserve_price),
    default_base_price = coalesce((p->>'default_base_price')::int, default_base_price),
    first_bid_seconds  = coalesce((p->>'first_bid_seconds')::int, first_bid_seconds),
    bid_seconds        = coalesce((p->>'bid_seconds')::int, bid_seconds),
    increments         = coalesce(inc, increments)
  where id = 1;
end $$;

create or replace function admin_save_team(p_pin text, p_id int, p_name text, p_captain text,
                                           p_color text, p_team_pin text) returns int
language plpgsql security definer set search_path = public as $$
declare tid int;
begin
  perform _check_admin(p_pin);
  if coalesce(trim(p_name), '') = '' then raise exception 'Team name is required'; end if;
  if p_id is null then
    if coalesce(trim(p_team_pin), '') = '' then raise exception 'Captain PIN is required'; end if;
    insert into teams (name, captain_name, color, points_left, sort_order)
    values (trim(p_name), p_captain, coalesce(nullif(p_color, ''), '#f59e0b'),
            (select budget from settings where id = 1),
            coalesce((select max(sort_order) + 1 from teams), 1))
    returning id into tid;
    insert into team_secrets (team_id, pin) values (tid, trim(p_team_pin));
  else
    update teams set name = trim(p_name), captain_name = p_captain,
                     color = coalesce(nullif(p_color, ''), color)
    where id = p_id returning id into tid;
    if tid is null then raise exception 'Team not found'; end if;
    if coalesce(trim(p_team_pin), '') <> '' then
      insert into team_secrets (team_id, pin) values (tid, trim(p_team_pin))
      on conflict (team_id) do update set pin = excluded.pin;
    end if;
  end if;
  return tid;
end $$;

create or replace function admin_delete_team(p_pin text, p_id int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _check_admin(p_pin);
  if exists (select 1 from players where team_id = p_id) then
    raise exception 'This team already has players. Reset the auction first.';
  end if;
  if exists (select 1 from bids where team_id = p_id) then
    raise exception 'This team has bids. Reset the auction first.';
  end if;
  delete from teams where id = p_id;
end $$;

create or replace function admin_team_pins(p_pin text) returns table(team_id int, pin text)
language plpgsql security definer set search_path = public as $$
begin
  perform _check_admin(p_pin);
  return query select ts.team_id, ts.pin from team_secrets ts;
end $$;

create or replace function admin_save_player(p_pin text, p_id int, p_name text, p_category text,
                                             p_base_price int, p_photo_url text) returns int
language plpgsql security definer set search_path = public as $$
declare pid int;
begin
  perform _check_admin(p_pin);
  if coalesce(trim(p_name), '') = '' then raise exception 'Player name is required'; end if;
  if p_id is null then
    insert into players (name, category, base_price, photo_url)
    values (trim(p_name), nullif(trim(p_category), ''),
            coalesce(p_base_price, (select default_base_price from settings where id = 1)),
            nullif(trim(p_photo_url), ''))
    returning id into pid;
  else
    update players set name = trim(p_name), category = nullif(trim(p_category), ''),
                       base_price = coalesce(p_base_price, base_price),
                       photo_url = nullif(trim(p_photo_url), '')
    where id = p_id returning id into pid;
    if pid is null then raise exception 'Player not found'; end if;
  end if;
  return pid;
end $$;

create or replace function admin_delete_player(p_pin text, p_id int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _check_admin(p_pin);
  if exists (select 1 from players where id = p_id and status in ('live', 'sold')) then
    raise exception 'Cannot delete a player who is live or sold';
  end if;
  if exists (select 1 from auction_state where current_player_id = p_id) then
    update auction_state set current_player_id = null, status = 'idle', last_result = null where id = 1;
  end if;
  delete from players where id = p_id;
end $$;

-- p_rows: [{"name": "...", "category": "...", "base_price": 70}, ...]
create or replace function admin_import_players(p_pin text, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform _check_admin(p_pin);
  insert into players (name, category, base_price, photo_url)
  select trim(r->>'name'),
         nullif(trim(r->>'category'), ''),
         coalesce((r->>'base_price')::int, (select default_base_price from settings where id = 1)),
         nullif(trim(r->>'photo_url'), '')
  from jsonb_array_elements(p_rows) r
  where coalesce(trim(r->>'name'), '') <> '';
  get diagnostics n = row_count;
  return n;
end $$;

-- Clears every bid and sale (use after the test run). Players and teams are kept.
create or replace function admin_reset(p_pin text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _check_admin(p_pin);
  update auction_state set status = 'idle', round = 1, current_player_id = null, current_bid = null,
         leading_team_id = null, active_bidders = '{}', withdrawn = '{}', timer_ends_at = null,
         last_result = null, updated_at = now()
  where id = 1;
  delete from bids where true;
  update players set status = 'available', team_id = null, sold_price = null, attempts = 0,
                     closed_at = null
  where true;
  update teams set points_left = (select budget from settings where id = 1) where true;
end $$;

create or replace function admin_change_pin(p_pin text, p_new_pin text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _check_admin(p_pin);
  if length(coalesce(trim(p_new_pin), '')) < 4 then raise exception 'PIN must be at least 4 characters'; end if;
  update admin_secret set pin = trim(p_new_pin) where id = 1;
end $$;

-- ---------- Set your admin PIN ------------------------------------------
-- Change 'CHANGE-ME' below to your own PIN and run this line:
-- update admin_secret set pin = 'your-secret-pin' where id = 1;

-- ---------- Grants (explicit, in case the project doesn't auto-expose new tables) ----
grant usage on schema public to anon, authenticated;
grant select on settings, teams, players, bids, auction_state to anon, authenticated;
grant execute on function
  server_now(), expire_check(), team_max_bid(int),
  captain_login(int, text), captain_bid(int, text, int), captain_withdraw(int, text),
  admin_login(text), admin_bid(text, int, int), admin_next_player(text, int), admin_close_player(text),
  admin_set_timer(text, int), admin_reopen(text), admin_start_round(text, int), admin_save_settings(text, jsonb),
  admin_save_team(text, int, text, text, text, text), admin_delete_team(text, int), admin_team_pins(text),
  admin_save_player(text, int, text, text, int, text), admin_delete_player(text, int),
  admin_import_players(text, jsonb), admin_reset(text), admin_change_pin(text, text)
to anon, authenticated;
