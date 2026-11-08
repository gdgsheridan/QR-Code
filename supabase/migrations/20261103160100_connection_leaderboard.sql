-- SPEC F17 step 6 (proposed): the connection leaderboard. Points are derived from connection_taps as of a time,
-- never stored (I-22): 1 per mutual connection with another eligible attendee (accepted, undeleted, not a test
-- row) of the same event. The board reads as of now, or as of the freeze time once an organizer freezes it.

alter table events add column leaderboard_frozen_at timestamptz;

-- Every eligible attendee with at least one point: points, when they reached that score (their latest
-- connection that counted) and their rank (ties share it).
create function public._connection_scores(p_event_id uuid, p_as_of timestamptz)
returns table (participant_id uuid, first_name text, last_name text, points int, reached_at timestamptz, rank bigint)
language sql stable set search_path = public, pg_temp as $$
  with eligible as (
    select id, first_name, last_name from participants
     where event_id = p_event_id and status = 'accepted' and deleted_at is null and not is_test
  ), pairs as (
    select mine.from_participant_id as me, greatest(mine.created_at, theirs.created_at) as at
      from connection_taps mine
      join connection_taps theirs on theirs.from_participant_id = mine.to_participant_id and theirs.to_participant_id = mine.from_participant_id
      join eligible a on a.id = mine.from_participant_id
      join eligible b on b.id = mine.to_participant_id
     where mine.event_id = p_event_id
  ), scored as (
    select me, count(*)::int as points, max(at) as reached_at from pairs where at <= p_as_of group by me
  )
  select s.me, e.first_name, e.last_name, s.points, s.reached_at, rank() over (order by s.points desc)
    from scored s join eligible e on e.id = s.me
$$;
revoke all on function public._connection_scores(uuid, timestamptz) from public, anon, authenticated;

-- The board as the projector shows it: rank, "First L." and points only (no ids, no emails), top p_limit,
-- ties in the order their score was reached, then by name. 'infinity' when live: the database clock decides
-- what is committed (I-7).
create function public.connection_leaderboard(p_event_id uuid, p_limit int)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with ev as (select leaderboard_frozen_at as frozen from events where id = p_event_id)
  select jsonb_build_object(
    'frozenAt', (select frozen from ev),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('rank', s.rank, 'name', btrim(s.first_name || ' ' || coalesce(nullif(left(s.last_name, 1), '') || '.', ''))
                                          , 'points', s.points) order by s.rank, s.reached_at, s.first_name, s.last_name)
        from (select * from _connection_scores(p_event_id, coalesce((select frozen from ev), 'infinity'))
               order by rank, reached_at, first_name, last_name limit p_limit) s), '[]'::jsonb))
$$;
revoke all on function public.connection_leaderboard(uuid, int) from public, anon, authenticated;
grant execute on function public.connection_leaderboard(uuid, int) to service_role;

-- A hacker's own points and rank on the same board (rank null with no points). Called only with the participant
-- the server resolved from the session (myEvent()).
create function public.connection_rank(p_participant_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select jsonb_build_object('points', s.points, 'rank', s.rank)
       from participants pa join events e on e.id = pa.event_id,
            lateral _connection_scores(pa.event_id, coalesce(e.leaderboard_frozen_at, 'infinity')) s
      where pa.id = p_participant_id and s.participant_id = pa.id),
    jsonb_build_object('points', 0, 'rank', null))
$$;
revoke all on function public.connection_rank(uuid) from public, anon, authenticated;
grant execute on function public.connection_rank(uuid) to service_role;
