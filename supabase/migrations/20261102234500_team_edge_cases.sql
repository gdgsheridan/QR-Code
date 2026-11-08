-- v0.11.47 (owner's request: "fix all"): edge cases two reviews of the hacker Team section found (SPEC F14 step 3,
-- F15 steps 5 and 8, F16 step 4, §15). New triggers, and four functions replaced as noted; no table changes.

-- A member who leaves a team, however they leave it (Leave, Remove, an organizer's remove or move, a withdrawal,
-- the tombstone), takes the invites they sent for it with them: "B invited you to join T" no longer holds. No column
-- list: a withdrawal clears team_id from another trigger, which an UPDATE OF team_id trigger would not see.
create function public._participant_left_team_invites() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  delete from team_invites where team_id = old.team_id and invited_by = new.id;
  return null;
end $$;
revoke all on function public._participant_left_team_invites() from public, anon, authenticated;
grant execute on function public._participant_left_team_invites() to service_role;
create trigger participants_left_team_invites after update on participants
  for each row when (old.team_id is not null and old.team_id is distinct from new.team_id)
  execute function public._participant_left_team_invites();

-- As in 20261031180000, and "I have a team" no longer holds once they're out of it: the answer becomes solo, which
-- keeps their profile finished and lists them nowhere (choosing looking on the Team page or profile does that).
create or replace function public._participant_left_team() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.team_id is null and new.status = 'accepted' and new.deleted_at is null and new.team_status = 'looking' then
    new.looking_for_team := true;
  end if;
  if new.team_status = 'team' then new.team_status := 'solo'; end if;
  return new;
end $$;

-- A tombstone that takes a team's last member deletes the team, like any last member leaving: the empty team kept
-- a working join code, so anyone holding it could take it over. Same function and lock order as a withdrawal.
create trigger participants_tombstone_team_cleanup after update of deleted_at on participants
  for each row when (old.deleted_at is null and new.deleted_at is not null and old.team_id is not null)
  execute function public._participant_left_team_cleanup();

-- team_invite as in 20261101090500, plus a per-team hourly limit and a scheduling fix (see the comments).
create or replace function public.team_invite(p_participant_id uuid, p_email text, p_user_id uuid, p_invitee_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare pa participants%rowtype; ev events%rowtype;
begin
  -- v0.11.25: lock the inviter and the invitee, in id order, before any check. The invitee's "no team and
  -- looking" was read unlocked, so a join committing meanwhile left a stray invite (and its email) behind.
  -- A join locks its own row before the team, and this locks both rows before the team: no lock cycle.
  perform 1 from participants where id in (p_participant_id, p_invitee_id) order by id for update;
  select pa2.* into pa from participants pa2 join events e on e.id = pa2.event_id
   where pa2.id = p_participant_id and pa2.email = lower(btrim(p_email)) and pa2.status = 'accepted'
     and pa2.deleted_at is null and e.ends_at > now()
   for update of pa2;
  if not found then return 'NOT_FOUND'; end if;
  if p_invitee_id = pa.id then return 'SELF'; end if;
  select * into ev from events where id = pa.event_id;
  if not ev.teams_open then return 'CLOSED'; end if;
  if pa.team_id is null then return 'NOT_FOUND'; end if;
  perform 1 from teams where id = pa.team_id for update;
  if (select count(*) from participants where team_id = pa.team_id) >= 4 then return 'TEAM_FULL'; end if;
  if not exists (select 1 from participants where id = p_invitee_id and event_id = pa.event_id
                   and status = 'accepted' and deleted_at is null and team_id is null and looking_for_team) then
    return 'NOT_LOOKING';
  end if;
  -- v0.11.47: at most 20 invites an hour per team, so one member can't email every Looking hacker at once.
  if not rate_limit_hit('team_invite:' || pa.team_id, 3600, 20) then return 'RATE_LIMITED'; end if;
  insert into team_invites (team_id, participant_id, event_id, invited_by)
  values (pa.team_id, p_invitee_id, pa.event_id, pa.id) on conflict do nothing;
  if not found then return 'ALREADY_INVITED'; end if;
  -- A02: per-kind dedupe. At most one invite email an hour per person (v0.11.25): a new one waits
  -- until an hour after the last sent; invites arriving meanwhile ride along (the drainer counts every
  -- pending invite when it sends).
  insert into email_outbox (participant_id, kind, next_attempt_at)
  values (p_invitee_id, 'team_invite', greatest(now(), coalesce((
    -- v0.11.47: an email still being sent counts as sent now, so this one can't follow it seconds later.
    select max(case when o.status = 'sending' then now() else o.sent_at end) + interval '1 hour' from email_outbox o
     where o.participant_id = p_invitee_id and o.kind = 'team_invite' and o.status in ('sent', 'sending')), now())))
  on conflict (participant_id, kind) where status in ('pending','sending') do nothing;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (pa.event_id, p_user_id, 'participant', 'team.invite', pa.team_id);
  return 'INVITED';
end $$;

-- set_track_interests as in 20261031190000, but the chosen tracks are locked (key share, id order) before they are
-- checked and the set is replaced: an organizer deleting one at the same moment either finishes first (BAD_TRACK)
-- or waits for this save, instead of the two deadlocking (the delete's cascade and this insert's foreign key check).
create or replace function public.set_track_interests(p_participant_id uuid, p_email text, p_user_id uuid, p_track_ids uuid[])
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare pa participants%rowtype; ids uuid[] := array(select distinct x from unnest(coalesce(p_track_ids, '{}')) x);
begin
  select pa2.* into pa from participants pa2 join events e on e.id = pa2.event_id
   where pa2.id = p_participant_id and pa2.email = lower(btrim(p_email)) and pa2.status = 'accepted'
     and pa2.deleted_at is null and e.ends_at > now()
   for update of pa2;
  if not found then return 'NOT_FOUND'; end if;
  perform 1 from tracks where id = any(ids) and event_id = pa.event_id order by id for key share;
  if (select count(*) from tracks where id = any(ids) and event_id = pa.event_id) <> cardinality(ids) then
    return 'BAD_TRACK';
  end if;
  delete from participant_tracks where participant_id = pa.id;
  insert into participant_tracks (participant_id, track_id, event_id)
  select pa.id, x, pa.event_id from unnest(ids) x;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (pa.event_id, p_user_id, 'participant', 'profile.tracks', pa.id);
  return 'SAVED';
end $$;

-- hacker_directory as in 20261031190000; the Track filter only matches hackers without a team (see the comment).
create or replace function public.hacker_directory(p_event_id uuid, p_email text, p_looking boolean default false,
  p_query text default '', p_pace text default null, p_limit int default 50, p_track uuid default null)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(entry order by name, id), '[]'::jsonb) from (
    select pa.id, concat_ws(' ', pa.first_name, nullif(pa.last_name, '')) as name,
      jsonb_build_object('id', pa.id, 'name', concat_ws(' ', pa.first_name, nullif(pa.last_name, '')))
      || case when pa.directory_opt_in then jsonb_build_object(
        'bio', pa.bio, 'pace', pa.pace, 'teamName', t.name,
        'looking', pa.looking_for_team and pa.team_id is null,
        'linkedinUrl', pa.linkedin_url, 'discord', pa.discord_username, 'websiteUrl', pa.website_url,
        'tracks', (select coalesce(jsonb_agg(tr.name order by tr.name), '[]'::jsonb)
                     from participant_tracks pt join tracks tr on tr.id = pt.track_id where pt.participant_id = pa.id)
      ) else '{}'::jsonb end as entry
    from participants pa
    left join teams t on t.id = pa.team_id and t.event_id = pa.event_id
    where pa.event_id = p_event_id and pa.status = 'accepted' and pa.deleted_at is null
      and (pa.directory_opt_in or (p_looking and pa.looking_for_team and pa.team_id is null))
      and (not p_looking or (pa.looking_for_team and pa.team_id is null))
      -- The viewer's own full card shows, marked (you); their own names-only Looking row doesn't (F15 step 7).
      and (pa.directory_opt_in or pa.email <> lower(btrim(p_email)))
      -- p_query is already toSearchText()-normalized by the app (I-12), like search_text.
      and (coalesce(p_query, '') = '' or pa.search_text like '%' || p_query || '%')
      and (p_pace is null or (pa.directory_opt_in and pa.pace = p_pace))
      -- v0.11.47: only hackers without a team, whose cards show Wants to do (F16 step 4).
      and (p_track is null or (pa.directory_opt_in and pa.team_id is null and exists (
        select 1 from participant_tracks pt where pt.participant_id = pa.id and pt.track_id = p_track)))
      and exists (
        select 1 from participants viewer join events e on e.id = viewer.event_id
        where viewer.event_id = p_event_id and viewer.email = lower(btrim(p_email))
          and viewer.status = 'accepted' and viewer.deleted_at is null
          and e.ends_at > now() - interval '30 days'
      )
    order by name, pa.id
    limit least(greatest(coalesce(p_limit, 50), 1), 1001)
  ) people
$$;
revoke all on function public.hacker_directory(uuid, text, boolean, text, text, int, uuid) from public, anon, authenticated;
grant execute on function public.hacker_directory(uuid, text, boolean, text, text, int, uuid) to service_role;
