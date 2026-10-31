-- L2 (2026-11-01): the ingest HMAC accepted any captured request for 300 s (no nonce). Seen request
-- keys are now recorded in Postgres (serverless has no shared memory): record_ingest_request() atomically
-- inserts the key and reports whether it is new, so a replayed (timestamp, signature) pair is rejected while
-- a re-signed re-ingest of the same payload (fresh timestamp, hence a new signature) still works -- row
-- upserts stay idempotent (F3). Keys older than one hour (well past MAX_SKEW_SECONDS, so any in-window
-- replay is still caught) are evicted on write, keeping the table small. Service-role only, deny-all RLS
-- like the rest (I-5, I-6).
create table ingest_seen_requests (
  request_key text primary key check (length(request_key) between 1 and 200),
  seen_at     timestamptz not null default now()
);
alter table ingest_seen_requests enable row level security;

create or replace function public.record_ingest_request(p_key text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from ingest_seen_requests where seen_at < now() - interval '1 hour';
  insert into ingest_seen_requests (request_key) values (p_key) on conflict do nothing;
  if not found then return false; end if;
  return true;
end $$;
revoke all on function public.record_ingest_request(text) from public, anon, authenticated;
grant execute on function public.record_ingest_request(text) to service_role;
