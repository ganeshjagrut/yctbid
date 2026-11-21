-- Migration 002:
--  * teams that were out (or withdrew) can bid again on the same player
--  * 'upcoming' message on the public screen before the auction starts
--  * tournament name YCT Season 2
-- Run once in Supabase SQL Editor.

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

revoke execute on function _place_bid(int, int, boolean) from public, anon, authenticated;

-- Pre-auction message
alter table settings add column if not exists upcoming_text text default 'Auction goes live on Tuesday';
update settings set upcoming_text = coalesce(upcoming_text, 'Auction goes live on Tuesday'),
  tournament_name = case when tournament_name = 'YCT Cricket Auction' then 'YCT Season 2' else tournament_name end
where id = 1;

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
