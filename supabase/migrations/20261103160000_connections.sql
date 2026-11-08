-- SPEC F17 (proposed; F16 on fix/profile-setup): the connection game. A tap is "I pressed Connect on your
-- badge"; a connection counts once both directions exist (mutual). Only accepted, undeleted, checked-in
-- attendees of the badge's event can tap, until the event ends. Who met whom is visible only to the two people
-- (my_connections); points are derived, never stored. Deleted by the tombstone (trigger) and 30 days after the event.

create table connection_taps (
  event_id            uuid not null references events on delete cascade,
  from_participant_id uuid not null,
  to_participant_id   uuid not null,
  created_at          timestamptz not null default clock_timestamp(),
  primary key (from_participant_id, to_participant_id),
  check (from_participant_id <> to_participant_id),
  -- Both people are in the tap's event (composite FKs, like scans).
  foreign key (from_participant_id, event_id) references participants (id, event_id) on delete cascade,
  foreign key (to_participant_id, event_id) references participants (id, event_id) on delete cascade
);
create index connection_taps_to on connection_taps (to_participant_id);
create index connection_taps_event on connection_taps (event_id);
alter table connection_taps enable row level security; -- deny-all: no policies (I-6)

-- Who is tapping whom. The badge resolves like badge_profile() (newest link of an accepted, undeleted holder in an
-- event that ended at most 30 days ago); the tapper is the signed-in account's own accepted row in that event.
create function public._connection_parties(p_email text, p_uid text,
  out code text, out event_id uuid, out me uuid, out them uuid, out them_first_name text)
language plpgsql stable set search_path = public, pg_temp as $$
declare ends timestamptz;
begin
  select b.event_id, pa.id, pa.first_name, e.ends_at into event_id, them, them_first_name, ends
    from badges b
    join participants pa on pa.id = b.participant_id
    join events e on e.id = b.event_id
   where b.uid = p_uid and pa.deleted_at is null and pa.status = 'accepted' and e.ends_at > now() - interval '30 days'
   order by b.linked_at desc
   limit 1;
  if not found then code := 'NOT_FOUND'; return; end if;
  select pa.id into me from participants pa
   where pa.event_id = _connection_parties.event_id and pa.email = lower(btrim(p_email))
     and pa.status = 'accepted' and pa.deleted_at is null;
  if not found then code := 'NOT_ATTENDEE'; return; end if;
  if me = them then code := 'SELF'; return; end if;
  if ends <= now() then code := 'CLOSED'; return; end if;
  if not exists (select 1 from scans s join checkpoints c on c.id = s.checkpoint_id
                  where s.participant_id = me and c.kind = 'door' and s.voided_at is null) then
    code := 'NOT_CHECKED_IN'; return;
  end if;
  code := 'OK';
end $$;
revoke all on function public._connection_parties(text, text) from public, anon, authenticated;

-- The one decision path for a tap (I-20): PENDING | MUTUAL | ALREADY_PENDING | ALREADY_MUTUAL | SELF | NOT_FOUND
-- | NOT_ATTENDEE | NOT_CHECKED_IN | CLOSED, with the other person's first name once the badge resolves.
-- A transaction-scoped advisory lock on the pair serializes two people tapping each other at the same moment,
-- so exactly one of them sees MUTUAL (T-CONN-02). It locks no checkpoint, participant or tag row (I-21).
create function public.record_connection(p_email text, p_uid text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p record; inserted boolean; back boolean;
begin
  select * into p from _connection_parties(p_email, p_uid);
  if p.code <> 'OK' then
    return jsonb_strip_nulls(jsonb_build_object('code', p.code, 'firstName', case when p.code <> 'NOT_FOUND' then p.them_first_name end));
  end if;
  perform pg_advisory_xact_lock(hashtextextended(least(p.me, p.them)::text || greatest(p.me, p.them)::text, 0));
  insert into connection_taps (event_id, from_participant_id, to_participant_id) values (p.event_id, p.me, p.them)
  on conflict (from_participant_id, to_participant_id) do nothing;
  inserted := found;
  back := exists (select 1 from connection_taps where from_participant_id = p.them and to_participant_id = p.me);
  return jsonb_build_object(
    'code', case when inserted and back then 'MUTUAL' when inserted then 'PENDING' when back then 'ALREADY_MUTUAL' else 'ALREADY_PENDING' end,
    'firstName', p.them_first_name);
end $$;
revoke all on function public.record_connection(text, text) from public, anon, authenticated;
grant execute on function public.record_connection(text, text) to service_role;

-- What the badge page offers the signed-in viewer (read-only, I-17): NONE | SENT | RECEIVED | MUTUAL, or the
-- reason they can't connect (SELF, NOT_FOUND, NOT_ATTENDEE, NOT_CHECKED_IN, CLOSED).
create function public.connection_state(p_email text, p_uid text)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare p record; sent boolean; got boolean;
begin
  select * into p from _connection_parties(p_email, p_uid);
  if p.code <> 'OK' then return p.code; end if;
  sent := exists (select 1 from connection_taps where from_participant_id = p.me and to_participant_id = p.them);
  got := exists (select 1 from connection_taps where from_participant_id = p.them and to_participant_id = p.me);
  return case when sent and got then 'MUTUAL' when sent then 'SENT' when got then 'RECEIVED' else 'NONE' end;
end $$;
revoke all on function public.connection_state(text, text) from public, anon, authenticated;
grant execute on function public.connection_state(text, text) to service_role;

-- A hacker's own mutual connections, newest first (connected = the later of the two taps), with the other
-- person's LinkedIn only while they share it; plus how many people they tapped who haven't tapped back.
-- Called only with the participant id the server resolved from the session (myEvent()).
create function public.my_connections(p_participant_id uuid, p_limit int)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with mutual as (
    select o.first_name, o.last_name, case when o.profile_public then o.linkedin_url end as linkedin_url,
           (select b.uid from badges b where b.participant_id = o.id order by b.linked_at desc limit 1) as badge_uid,
           greatest(mine.created_at, theirs.created_at) as connected_at
      from connection_taps mine
      join connection_taps theirs on theirs.from_participant_id = mine.to_participant_id and theirs.to_participant_id = mine.from_participant_id
      join participants o on o.id = mine.to_participant_id
     where mine.from_participant_id = p_participant_id and o.deleted_at is null and o.status = 'accepted'
  )
  select jsonb_build_object(
    'total', (select count(*) from mutual),
    'waitingOn', (select count(*) from connection_taps mine join participants o on o.id = mine.to_participant_id
                   where mine.from_participant_id = p_participant_id and o.deleted_at is null and o.status = 'accepted'
                     and not exists (select 1 from connection_taps t where t.from_participant_id = mine.to_participant_id
                                                                         and t.to_participant_id = p_participant_id)),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('firstName', m.first_name, 'lastName', m.last_name,
                                                            'linkedinUrl', m.linkedin_url, 'badgeUid', m.badge_uid,
                                                            'connectedAt', m.connected_at) order by m.connected_at desc)
                          from (select * from mutual order by connected_at desc limit p_limit) m), '[]'::jsonb))
$$;
revoke all on function public.my_connections(uuid, int) from public, anon, authenticated;
grant execute on function public.my_connections(uuid, int) to service_role;

-- The tombstone (§5.1) sets deleted_at; whatever path does it, the person's taps go with it.
create function public._participant_tombstone_connections()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from connection_taps where from_participant_id = new.id or to_participant_id = new.id;
  return new;
end $$;
revoke all on function public._participant_tombstone_connections() from public, anon, authenticated;
create trigger participants_tombstone_connections
  after update of deleted_at on participants
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function public._participant_tombstone_connections();

-- Retention (§15, user decision 2026-10-29): an event's connections are deleted 30 days after it ends.
create function public.retain_connections()
returns int language sql security definer set search_path = public, pg_temp as $$
  with gone as (
    delete from connection_taps t using events e
     where e.id = t.event_id and e.ends_at <= now() - interval '30 days'
    returning 1)
  select count(*)::int from gone
$$;
revoke all on function public.retain_connections() from public, anon, authenticated;
grant execute on function public.retain_connections() to service_role;
