-- SPEC F10 (v0.11.26, owner's request): Import CSV records what the Sheet decided (Status Yes/Accepted →
-- accepted, Waitlist/Waitlisted → waitlisted), so organizers can see and filter it on the Participants page.
-- It is the Sheet's decision only: it never changes participants.status, which an RSVP still decides (F3, F13).
alter table participants add column sheet_status text check (sheet_status in ('accepted', 'waitlisted'));

-- ingest_sheet_row gains p_sheet_status. Null leaves it alone (the Apps Script path sends none); a value is stored
-- and, like the other Sheet fields, a change makes the row UPDATED.
drop function public.ingest_sheet_row(uuid, text, text, text, text, text, text, text, boolean);
create function public.ingest_sheet_row(
  p_event_id      uuid,
  p_external_id   text,
  p_email         text,
  p_first_name    text,
  p_last_name     text,
  p_search_text   text,
  p_dietary_notes text    default null,
  p_linkedin_url  text    default null,
  p_dry_run       boolean default false,
  p_sheet_status  text    default null
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pa participants%rowtype;
  email_changed boolean;
begin
  select * into pa from participants where event_id = p_event_id and external_id = p_external_id for update;

  if not found then
    if exists (select 1 from participants where event_id = p_event_id and email = p_email) then
      return 'CONFLICT_DUPLICATE_EMAIL';
    end if;
    if p_dry_run then return 'CREATED'; end if;
    begin
      insert into participants (event_id, external_id, email, first_name, last_name, search_text,
                                dietary_notes, linkedin_url, status, source, sheet_status)
      values (p_event_id, p_external_id, p_email, p_first_name, p_last_name, p_search_text,
              p_dietary_notes, p_linkedin_url, 'pending', 'sheet', p_sheet_status)
      on conflict (event_id, external_id) do nothing
      returning * into pa;
    exception when unique_violation then
      -- (event_id, email) taken by a concurrent insert under another external_id.
      return 'CONFLICT_DUPLICATE_EMAIL';
    end;
    if found then return 'CREATED'; end if;
    -- A concurrent request inserted this external_id first: continue as an existing row.
    select * into pa from participants where event_id = p_event_id and external_id = p_external_id for update;
  end if;

  if pa.deleted_at is not null then
    return 'UNCHANGED';
  end if;

  email_changed := pa.email <> p_email;
  if not email_changed
     and pa.first_name    is not distinct from p_first_name
     and pa.last_name     is not distinct from p_last_name
     and (pa.dietary_set_at is not null or pa.dietary_notes is not distinct from p_dietary_notes)
     and (pa.linkedin_set_at is not null or pa.linkedin_url is not distinct from p_linkedin_url)
     and (p_sheet_status is null or pa.sheet_status is not distinct from p_sheet_status) then
    return 'UNCHANGED';
  end if;
  if email_changed and exists (select 1 from participants where event_id = p_event_id and email = p_email and id <> pa.id) then
    return 'CONFLICT_DUPLICATE_EMAIL';
  end if;
  if not p_dry_run then
    update participants
       set email = p_email, first_name = p_first_name, last_name = p_last_name, search_text = p_search_text,
           updated_at = now(),
           dietary_notes = case when pa.dietary_set_at is null then p_dietary_notes else pa.dietary_notes end,
           linkedin_url = case when pa.linkedin_set_at is null then p_linkedin_url else pa.linkedin_url end,
           sheet_status = coalesce(p_sheet_status, sheet_status),
           -- The RSVP link went to the old address: it must not answer (or make an account) for the new one.
           rsvp_token_hash = case when email_changed then null else rsvp_token_hash end
     where id = pa.id;
    if email_changed and pa.status = 'accepted' then
      -- Rotation on send revokes the old pass. A pending row already queued will go to the new address.
      insert into email_outbox (participant_id, kind) values (pa.id, 'pass_reissued')
      on conflict (participant_id) where status in ('pending','sending') do nothing;
      insert into audit_log (event_id, actor_kind, action, subject_id)
      values (p_event_id, 'sheet_sync', 'participant.email_change', pa.id);
    end if;
  end if;
  return case when email_changed and pa.status = 'accepted' then 'PASS_QUEUED' else 'UPDATED' end;
end $$;
revoke all on function public.ingest_sheet_row(uuid, text, text, text, text, text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.ingest_sheet_row(uuid, text, text, text, text, text, text, text, boolean, text) to service_role;

-- §11 participants table: as in 20261027180645, plus the Sheet's decision and a filter on it.
drop function public.admin_participants(uuid, participant_status, text, boolean);
create function public.admin_participants(
  p_event_id uuid, p_status participant_status default null, p_query text default null, p_no_show boolean default false,
  p_sheet_status text default null
) returns table (
  id uuid, first_name text, last_name text, email text, status participant_status, source text, is_test boolean,
  external_id text, dietary_notes text, photo_path text, photo_updated_at timestamptz, pass_state text,
  live_scans int, checked_in boolean, created_at timestamptz, rsvp_sent_at timestamptz,
  overnight text, team_status text, allergies text, allergy_severity text, has_badge boolean, sheet_status text
) language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.first_name, p.last_name, p.email, p.status, p.source, p.is_test, p.external_id, p.dietary_notes,
         p.photo_path, p.photo_updated_at,
         case when exists (select 1 from passes ps where ps.participant_id = p.id and ps.revoked_at is null) then 'active'
              when exists (select 1 from passes ps where ps.participant_id = p.id) then 'revoked'
              else 'none' end as pass_state,
         (select count(*)::int from scans s where s.participant_id = p.id and s.voided_at is null) as live_scans,
         exists (select 1 from scans s join checkpoints c on c.id = s.checkpoint_id
                  where s.participant_id = p.id and c.kind = 'door' and s.voided_at is null) as checked_in,
         p.created_at,
         p.rsvp_sent_at,
         p.overnight, p.team_status, p.allergies, p.allergy_severity,
         exists (select 1 from badges b where b.participant_id = p.id) as has_badge,
         p.sheet_status
    from participants p
   where p.event_id = p_event_id
     and p.deleted_at is null
     and (p_status is null or p.status = p_status)
     and (p_sheet_status is null or p.sheet_status = p_sheet_status)
     and (p_query is null or p.search_text like '%' || p_query || '%' or p.email like '%' || p_query || '%')
     and (not p_no_show or (p.status = 'accepted' and not p.is_test and not exists (
            select 1 from scans s join checkpoints c on c.id = s.checkpoint_id
             where s.participant_id = p.id and c.kind = 'door' and s.voided_at is null)))
   order by p.last_name, p.first_name, p.id
   limit 1000
$$;
revoke all on function public.admin_participants(uuid, participant_status, text, boolean, text) from public, anon, authenticated;
grant execute on function public.admin_participants(uuid, participant_status, text, boolean, text) to service_role;
