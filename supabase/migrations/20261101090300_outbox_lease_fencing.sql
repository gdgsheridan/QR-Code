-- A09 (2026-11-01): fence finish_outbox with a per-claim token.
-- claim_outbox sets locked_until = now() + interval '2 minutes', but one batch holds up to 20 rows
-- and a hung provider request gives up only after 10 s (resend timeoutMs), so a slow batch can run
-- ~20 x 10 s = 200 s: past the 2-minute lease. The row is then reclaimed (status flips to 'sending'
-- again under a new owner) while the stale drainer is still working it, and finish_outbox only checked
-- status = 'sending', so the stale drainer could still overwrite the new owner's result.
-- Two changes (SPEC F4: claim/finish contract):
--   * the lease grows to 10 minutes, covering a worst-case full batch with margin, and
--   * every claim mints a fencing token (claim_token, rotated on each claim including reclaims);
--     finish_outbox must present the token it was claimed with (p_claim_token) or it returns false
--     and changes nothing. finish_outbox also rotates the token, so a token can never match twice.
alter table email_outbox add column claim_token uuid not null default gen_random_uuid();

-- Same signature: the longer lease and the rotated token are the only changes.
create or replace function public.claim_outbox(p_limit int default 20)
returns setof email_outbox language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  update email_outbox o
     set status = 'sending', locked_until = now() + interval '10 minutes', attempts = attempts + 1,
         claim_token = gen_random_uuid()
   where o.id in (
     select id from email_outbox
      where (status = 'pending' and next_attempt_at <= now())
         or (status = 'sending' and locked_until < now())
      order by next_attempt_at
      limit p_limit
      for update skip locked)
  returning o.*;
end $$;
revoke all on function public.claim_outbox(int) from public, anon, authenticated;
grant execute on function public.claim_outbox(int) to service_role;

-- Records the outcome of one claimed row. Only the row still held under this claim's token is
-- updated, so a drainer whose lease expired (and whose row was reclaimed) cannot overwrite the
-- new owner's result: a stale finish returns false. p_claim_token is required by callers; it defaults to
-- null only because Postgres needs defaults after the earlier defaulted args, and a null token matches no
-- row, so an omitted token fails closed.
drop function public.finish_outbox(uuid, outbox_status, timestamptz, text, text, boolean, boolean);
create function public.finish_outbox(
  p_id                  uuid,
  p_status              outbox_status,
  p_next_attempt_at     timestamptz default null,
  p_last_error          text        default null,
  p_provider_message_id text        default null,
  p_refund              boolean     default false,
  p_rate_limited        boolean     default false,
  p_claim_token         uuid        default null
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_status = 'sending' then
    raise exception 'finish_outbox: status must be terminal or pending';
  end if;
  update email_outbox
     set status              = p_status,
         locked_until        = null,
         next_attempt_at     = coalesce(p_next_attempt_at, next_attempt_at),
         last_error          = coalesce(p_last_error, last_error),
         provider_message_id = coalesce(p_provider_message_id, provider_message_id),
         sent_at             = case when p_status = 'sent' then now() else sent_at end,
         attempts            = case when p_refund then greatest(attempts - 1, 0) else attempts end,
         rate_limit_hits     = case when p_rate_limited then rate_limit_hits + 1 else rate_limit_hits end,
         claim_token         = gen_random_uuid()
   where id = p_id and status = 'sending' and claim_token = p_claim_token;
  return found;
end $$;
revoke all on function public.finish_outbox(uuid, outbox_status, timestamptz, text, text, boolean, boolean, uuid) from public, anon, authenticated;
grant execute on function public.finish_outbox(uuid, outbox_status, timestamptz, text, text, boolean, boolean, uuid) to service_role;
