-- A10 (2026-11-01): rate_limit_hits counts consecutive 429s, not lifetime 429s.
-- finish_outbox used to only ever increment rate_limit_hits, so a row that recovered (a send, or a
-- real non-429 failure) kept its old 429s: 20 lifetime 429s ended in 'failed' instead of 20 in a row.
-- SPEC F4 counts consecutive rate-limited tries. The rule, documented here and in lib/domain/outbox.ts:
-- a 429 (p_rate_limited) extends the streak; a refunded handoff (p_refund, no outcome for this row)
-- preserves it; any other finish records a real non-429 outcome and resets it to 0.
-- Same signature as 20261101090300; only the rate_limit_hits line changes.
create or replace function public.finish_outbox(
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
         rate_limit_hits     = case when p_rate_limited then rate_limit_hits + 1
                                    when p_refund then rate_limit_hits
                                    else 0 end,
         claim_token         = gen_random_uuid()
   where id = p_id and status = 'sending' and claim_token = p_claim_token;
  return found;
end $$;
revoke all on function public.finish_outbox(uuid, outbox_status, timestamptz, text, text, boolean, boolean, uuid) from public, anon, authenticated;
grant execute on function public.finish_outbox(uuid, outbox_status, timestamptz, text, text, boolean, boolean, uuid) to service_role;
