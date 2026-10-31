-- SPEC F15/F16 (v0.11.25, owner's request): each hacker says which tracks they want to do, as part of finding a
-- team: any number, any time (before tracks are released too). A team still picks its own one track (F15 step 6).
create table participant_tracks (
  participant_id uuid not null,
  track_id       uuid not null,
  event_id       uuid not null,
  created_at     timestamptz not null default now(),
  primary key (participant_id, track_id),
  foreign key (participant_id, event_id) references participants (id, event_id) on delete cascade,
  foreign key (track_id, event_id) references tracks (id, event_id) on delete cascade
);
create index participant_tracks_track on participant_tracks (track_id);
alter table participant_tracks enable row level security;

-- Own accepted, undeleted row only (matched by verified email), event not ended. Replaces the whole set.
create function public.set_track_interests(p_participant_id uuid, p_email text, p_user_id uuid, p_track_ids uuid[])
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare pa participants%rowtype;
begin
  select pa2.* into pa from participants pa2 join events e on e.id = pa2.event_id
   where pa2.id = p_participant_id and pa2.email = lower(btrim(p_email)) and pa2.status = 'accepted'
     and pa2.deleted_at is null and e.ends_at > now()
   for update of pa2;
  if not found then return 'NOT_FOUND'; end if;
  if exists (select 1 from unnest(coalesce(p_track_ids, '{}')) x(tid)
              where not exists (select 1 from tracks t where t.id = x.tid and t.event_id = pa.event_id)) then
    return 'BAD_TRACK';
  end if;
  delete from participant_tracks where participant_id = pa.id;
  insert into participant_tracks (participant_id, track_id, event_id)
  select pa.id, x.tid, pa.event_id from unnest(coalesce(p_track_ids, '{}')) x(tid) on conflict do nothing;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (pa.event_id, p_user_id, 'participant', 'profile.tracks', pa.id);
  return 'SAVED';
end $$;
revoke all on function public.set_track_interests(uuid, text, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.set_track_interests(uuid, text, uuid, uuid[]) to service_role;

-- The tombstone (§5.1) clears them, like the rest of the directory profile.
create function public._participant_tombstone_tracks() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  delete from participant_tracks where participant_id = new.id;
  return null;
end $$;
revoke all on function public._participant_tombstone_tracks() from public, anon, authenticated;
grant execute on function public._participant_tombstone_tracks() to service_role;
create trigger participants_tombstone_tracks after update of deleted_at on participants
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function public._participant_tombstone_tracks();

-- F16: cards carry the tracks a hacker wants, and the directory filters by one (full cards only, like pace).
drop function public.hacker_directory(uuid, text, boolean, text, text, int);
create function public.hacker_directory(p_event_id uuid, p_email text, p_looking boolean default false,
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
      and (p_track is null or (pa.directory_opt_in and exists (
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
