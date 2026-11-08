-- SPEC F15 step 6 (v0.11.50, owner's request): a team picks any number of tracks ("Interested tracks"), ticked like
-- the tracks a hacker wants to do, instead of one. Every team keeps the track it already picked: the new list starts
-- from teams.track_id, which stays (no longer read; nothing writes it after this but the old app code below).
create table team_tracks (
  team_id    uuid not null,
  track_id   uuid not null,
  event_id   uuid not null,
  created_at timestamptz not null default now(),
  primary key (team_id, track_id),
  foreign key (team_id, event_id) references teams (id, event_id) on delete cascade,
  foreign key (track_id, event_id) references tracks (id, event_id) on delete cascade
);
create index team_tracks_track on team_tracks (track_id);
alter table team_tracks enable row level security;

insert into team_tracks (team_id, track_id, event_id)
select id, track_id, event_id from teams where track_id is not null;

-- Replaces a team's tracks with p_track_ids (any number; none clears them): BAD_TRACK unless every one is this
-- event's, NOT_FOUND for a team outside the event. The chosen tracks are locked first (key share, id order, like
-- set_track_interests()) so a track deleted meanwhile waits or answers BAD_TRACK, then the team row, so two saves
-- for one team land one after the other instead of mixing. Organizers call it directly (§11); hackers through
-- team_set_tracks(), which locks their own row first, like every team_* function.
create function public.set_team_tracks(p_event_id uuid, p_team_id uuid, p_track_ids uuid[])
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare ids uuid[] := array(select distinct x from unnest(coalesce(p_track_ids, '{}')) x where x is not null);
begin
  perform 1 from tracks where id = any(ids) and event_id = p_event_id order by id for key share;
  if (select count(*) from tracks where id = any(ids) and event_id = p_event_id) <> cardinality(ids) then
    return 'BAD_TRACK';
  end if;
  perform 1 from teams where id = p_team_id and event_id = p_event_id for update;
  if not found then return 'NOT_FOUND'; end if;
  delete from team_tracks where team_id = p_team_id and track_id <> all(ids);
  insert into team_tracks (team_id, track_id, event_id)
  select p_team_id, x, p_event_id from unnest(ids) x on conflict do nothing;
  return 'SAVED';
end $$;
revoke all on function public.set_team_tracks(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.set_team_tracks(uuid, uuid, uuid[]) to service_role;

-- Any member, once tracks are released, until the event ends (even after forming closes), like team_set_track().
create function public.team_set_tracks(p_participant_id uuid, p_email text, p_user_id uuid, p_track_ids uuid[])
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare pa participants%rowtype; result text;
begin
  select pa2.* into pa from participants pa2 join events e on e.id = pa2.event_id
   where pa2.id = p_participant_id and pa2.email = lower(btrim(p_email)) and pa2.status = 'accepted'
     and pa2.deleted_at is null and e.ends_at > now()
   for update of pa2;
  if not found or pa.team_id is null then return 'NOT_FOUND'; end if;
  if not (select tracks_released from events where id = pa.event_id) then return 'NOT_RELEASED'; end if;
  result := set_team_tracks(pa.event_id, pa.team_id, p_track_ids);
  if result <> 'SAVED' then return result; end if;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (pa.event_id, p_user_id, 'participant', 'team.track', pa.team_id);
  return 'SAVED';
end $$;
revoke all on function public.team_set_tracks(uuid, text, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.team_set_tracks(uuid, text, uuid, uuid[]) to service_role;

-- The app before v0.11.50 still calls team_set_track() until it is redeployed: its one track becomes the list.
create or replace function public.team_set_track(p_participant_id uuid, p_email text, p_user_id uuid, p_track_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare result text := team_set_tracks(p_participant_id, p_email, p_user_id, array[p_track_id]);
begin
  return case when result = 'BAD_TRACK' then 'NOT_FOUND' else result end;  -- its old answer for another event's track
end $$;
