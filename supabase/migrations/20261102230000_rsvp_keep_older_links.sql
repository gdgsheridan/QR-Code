-- v0.11.42 (owner's request, reverses F13's "only the newest link works"): every RSVP link sent to a person keeps
-- working, so an invitation still opens after its reminder. Each key's sha256 is kept (I-3); an older one is
-- translated to the person's current key, so deadlines, the 48 h close and Yes/No behave exactly as before.
-- Clearing the current key (Revoke RSVP, an email change in the Sheet, retention) forgets them all, so a link sent
-- to an old address never comes back.
create table public.rsvp_tokens (
  token_hash     text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  participant_id uuid not null references public.participants on delete cascade,
  created_at     timestamptz not null default now()
);
create index rsvp_tokens_participant on public.rsvp_tokens (participant_id);
alter table public.rsvp_tokens enable row level security;  -- deny-all (I-6)
revoke all on public.rsvp_tokens from anon, authenticated;

insert into public.rsvp_tokens (token_hash, participant_id)
select rsvp_token_hash, id from public.participants where rsvp_token_hash is not null
on conflict do nothing;

create or replace function public._participant_rsvp_tokens() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and old.rsvp_token_hash is not distinct from new.rsvp_token_hash then return null; end if;
  if new.rsvp_token_hash is null then
    delete from rsvp_tokens where participant_id = new.id;
  else
    insert into rsvp_tokens (token_hash, participant_id) values (new.rsvp_token_hash, new.id) on conflict do nothing;
  end if;
  return null;
end $$;
revoke all on function public._participant_rsvp_tokens() from public, anon, authenticated;
grant execute on function public._participant_rsvp_tokens() to service_role;

create trigger participants_rsvp_tokens
  after insert or update of rsvp_token_hash on public.participants
  for each row execute function public._participant_rsvp_tokens();

-- Any key ever sent to someone → their current key (unchanged when unknown, or when they have none).
create or replace function public._rsvp_current_hash(p_token_hash text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select pa.rsvp_token_hash from rsvp_tokens t join participants pa on pa.id = t.participant_id
                    where t.token_hash = p_token_hash and pa.rsvp_token_hash is not null), p_token_hash)
$$;
revoke all on function public._rsvp_current_hash(text) from public, anon, authenticated;
grant execute on function public._rsvp_current_hash(text) to service_role;

CREATE OR REPLACE FUNCTION public.rsvp_lookup(p_token_hash text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select jsonb_build_object(
    'participantId', pa.id,
    'email', pa.email,
    'firstName', pa.first_name,
    'status', pa.status,
    'hasAccount', exists (select 1 from auth.users u where lower(u.email) = pa.email),
    'profile', jsonb_build_object('dietaryNotes', pa.dietary_notes, 'linkedinUrl', pa.linkedin_url, 'profilePublic', pa.profile_public),
    'event', jsonb_build_object('name', e.name, 'venue', e.venue, 'startsAt', e.starts_at, 'timezone', e.timezone),
    'closesAt', _rsvp_closes(e.rsvp_deadline, pa.rsvp_sent_at),
    -- v0.11.27: the date they're asked to reply by, when it's earlier than the real close (null: none).
    'replyBy', e.rsvp_reply_by,
    -- The accepted can still say No (give their spot away) until the event ends.
    'closed', pa.status <> 'accepted' and coalesce(_rsvp_closes(e.rsvp_deadline, pa.rsvp_sent_at) < now(), false))
    from participants pa join events e on e.id = pa.event_id
   where pa.rsvp_token_hash = _rsvp_current_hash(p_token_hash) and pa.deleted_at is null and e.ends_at > now()
$function$;

CREATE OR REPLACE FUNCTION public.rsvp_respond(p_token_hash text, p_going boolean, p_linkedin_url text DEFAULT NULL::text, p_public boolean DEFAULT NULL::boolean, p_dietary_notes text DEFAULT NULL::text, p_emergency_name text DEFAULT NULL::text, p_emergency_phone text DEFAULT NULL::text, p_emergency_relation text DEFAULT NULL::text, p_looking_for_team boolean DEFAULT NULL::boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare pa participants%rowtype; closes timestamptz;
begin
  select pa2.* into pa from participants pa2 join events e on e.id = pa2.event_id
   where pa2.rsvp_token_hash = _rsvp_current_hash(p_token_hash) and pa2.deleted_at is null and e.ends_at > now()
   for update of pa2;
  if not found then return 'NOT_FOUND'; end if;
  select _rsvp_closes(rsvp_deadline, pa.rsvp_sent_at) into closes from events where id = pa.event_id;

  if p_going then
    if pa.status <> 'accepted' and closes < now() then return 'CLOSED'; end if;
    update participants set looking_for_team = p_looking_for_team where id = pa.id and p_looking_for_team is not null;
    perform _set_hacker_profile(pa.id, p_linkedin_url, p_public, p_dietary_notes,
                                p_emergency_name, p_emergency_phone, p_emergency_relation);
    if pa.status <> 'accepted' then
      update participants set status = 'accepted', updated_at = now() where id = pa.id;
      insert into audit_log (event_id, actor_kind, action, subject_id) values (pa.event_id, 'participant', 'rsvp.yes', pa.id);
      if not exists (select 1 from passes where participant_id = pa.id and revoked_at is null)
         and coalesce((select revoke_reason from passes where participant_id = pa.id order by issued_at desc limit 1), '') <> 'manual' then
        -- A re-sent RSVP or a reminder still waiting in the outbox would otherwise block the pass email.
        update email_outbox set status = 'cancelled', locked_until = null
         where participant_id = pa.id and kind in ('rsvp', 'rsvp_reminder', 'profile_reminder') and status in ('pending','sending');
        insert into email_outbox (participant_id, kind) values (pa.id, 'pass_issued')
        on conflict (participant_id, kind) where status in ('pending','sending') do nothing;
      end if;
    end if;
    return 'GOING';
  end if;

  if pa.status <> 'withdrawn' then
    update participants set status = 'withdrawn', updated_at = now() where id = pa.id;
    update passes set revoked_at = now(), revoke_reason = 'status_change'
     where participant_id = pa.id and revoked_at is null;
    update email_outbox set status = 'cancelled', locked_until = null
     where participant_id = pa.id and status in ('pending','sending');
    delete from badges where participant_id = pa.id;  -- §6.5: revoking a pass removes the badge link
    insert into audit_log (event_id, actor_kind, action, subject_id) values (pa.event_id, 'participant', 'rsvp.no', pa.id);
  end if;
  return 'NOT_GOING';
end $function$;
