-- SPEC §11 Judges (v0.12.4, owner's request): the event's judges, imported from the organizers' tracker, each with an
-- optional LinkedIn and one NFC badge that opens their profile (name, "Judge", title, LinkedIn; §6.5). Judges aren't
-- participants: no pass, scans, emails, teams or connections. Deny-all RLS like every table (I-6): the app reads and
-- writes through the service role after requireStaff() (I-5). Additive only.
create table public.judges (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 120),
  title           text check (length(title) between 1 and 200),
  linkedin_url    text check (linkedin_url ~ '^https://(www\.)?linkedin\.com/in/[A-Za-z0-9_%-]+/?$'),
  badge_uid       text check (badge_uid ~ '^([0-9a-f]{2}){4,10}$'),
  badge_linked_at timestamptz,
  created_at      timestamptz not null default now(),
  check ((badge_uid is null) = (badge_linked_at is null))
);
create unique index judges_event_name on public.judges (event_id, lower(name));   -- the import's key
create unique index judges_event_badge on public.judges (event_id, badge_uid) where badge_uid is not null;
create index judges_badge on public.judges (badge_uid) where badge_uid is not null; -- the badge page's lookup
alter table public.judges enable row level security;
