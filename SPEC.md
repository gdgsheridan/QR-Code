# Sheridan Datathon Station — Product & Technical Specification

> **Status:** Draft v0.11.24 · **Owner:** Ade · **Last updated:** 2026-10-31
> The app is **Station** (Sheridan Datathon Station, `https://station.sheridandatathon.com`); it was called Passline until v0.11.21.

## 0. How to read this document

- **MUST / MUST NOT / SHOULD / MAY** are used as in RFC 2119.
- Every MUST has at least one test in §14. Test IDs look like `T-SCAN-11`. Code and test names reference them.
- Anything marked **DECISION** was a deliberate trade-off. Don't "fix" it without updating this spec.
- Anything we have not confirmed against real docs or devices is listed in §17 (Assumptions to verify). Treat those as hypotheses until checked.
- If this spec and the code disagree, the spec wins until the spec is changed. Changes to behaviour go in the changelog (§20).

---

## 1. Problem & goals

The club runs tech and networking events. People apply through a Google Form, which writes to a Google Sheet. Organizers decide acceptance in the Sheet. Today, check-in, food distribution and workshop attendance are tracked by hand, or not tracked at all.

| ID | Goal | Measure |
|----|------|---------|
| G1 | An applicant who answers Yes to their RSVP gets a personal QR pass by email automatically | ≤ 5 min from the RSVP Yes to the email being sent (p95) |
| G2 | Fast, duplicate-proof door check-in | ≤ 3 s per person, from the code entering the frame to the result on screen |
| G3 | At most one serving per participant per meal | 0 duplicate live meal scans, enforced by the database |
| G4 | Workshop/session attendance recorded | Every session scan attributable to a participant and a time |
| G5 | Organizers see live counts and post-event analytics | Dashboard refresh ≤ 10 s; CSV export |
| G6 | A linked NFC badge works wherever a QR pass works, and opens an opt-in profile when tapped | Same rules and result codes as QR; the profile shows only opted-in fields (§6.5) |

### Non-goals (v1)

The following are out of scope for v1:
- Ticket sales or payments.
- Hosting the application form (Google Forms stays).
- **Offline scanning** (DECISION: this roughly doubles complexity; a paper fallback is covered in §16).
- LinkedIn sign-in or scraping.
- Native apps and Apple/Google Wallet passes.
- Checkpoints that allow unlimited scans per participant.
- Multi-club tenancy.

### v2 candidates (do not build yet)

- A Wallet pass (`.pkpass`).
- "Contact swap": saving another participant's opted-in profile to your own list. (The opt-in badge profile itself shipped in v0.3, §6.5.)
- Co-attendance analytics UI.
- Offline queue with sync.
- Unlimited-scan checkpoints (booth visit counters).

---

## 2. Glossary

| Term | Meaning |
|------|---------|
| **Event** | One dated occurrence (e.g. `hackday-2026`). All data is scoped to an event. |
| **Participant** | An applicant row imported from the Sheet (or a walk-in), with a `status`. |
| **RSVP** | An invitation an organizer emails to chosen applicants. Yes accepts them, No withdraws them (F13). |
| **Account** | A Supabase Auth user, signed in with email + password. Staff get one from an invite email, attendees from their RSVP Yes (F9, F13). |
| **Pass** | A credential issued to an accepted participant. At most one is **active** at a time. |
| **Token** | The secret random string inside a pass's QR code. It is never stored raw; only `sha256(token)` is stored. |
| **Checkpoint** | A place where scans happen: `door`, `meal`, `session`, or `custom` (swag, raffle, booth). |
| **Scan** | A recorded participant × checkpoint event. It is **live** if `voided_at IS NULL`. |
| **Void** | Soft-undo of a scan. Voided scans are excluded from every rule and count. |
| **Staff** | An authenticated user with a role on an event: `organizer` or `volunteer`. |
| **Door check-in** | A live scan at the event's single `door` checkpoint. |
| **Outbox** | A queue table of emails to send. Emails are never sent inline in a request. |
| **Badge** | An NFC tag whose UID is linked to one participant for one event, by staff at the event (v0.10; from v0.5 to v0.9.2 its holder claimed it). Its NDEF payload is `${BADGE_ORIGIN}/profile/<uid>?tap` (§6.5). |
| **Badge profile** | The page `/profile/<uid>`. Public since v0.9: anyone who taps the badge sees the name and links (LinkedIn, and since v0.9.2 Discord and website) if the participant shares them (on by default). |
| **Hacker menu** | `/me` (v0.6; no event slug since v0.6.1): an attendee's own page for their event, with **Hacker profile**, **Team** (v0.7), **Hackers** (F16), **Schedule**, **Emergency contact** and **My pass**. Tapping your own badge opens it (F14). |
| **Team** | Up to 4 accepted attendees of one event, with a name, a join code and at most one track (F15, v0.7). |
| **Track** | A prize category of an event that a team enters (e.g. "Best AI/ML Project"). Organizers type them; placing prizes (1st, 2nd, 3rd) are not tracks. |

---

## 3. Actors & permissions

| Action | Anonymous | Pass holder (has token) | Volunteer | Organizer |
|--------|:-:|:-:|:-:|:-:|
| View own pass page (`/p#token`) | — | ✅ | — | — |
| Scan at a checkpoint of their event | — | — | ✅ | ✅ |
| Manual search + manual scan | — | — | ✅ (masked email) | ✅ (full email) |
| Void own scan ≤ 120 s old | — | — | ✅ | ✅ |
| Void any scan | — | — | — | ✅ |
| See who was scanned at a checkpoint and remove a scan from that list (= void, rows above; v0.8) | — | — | ✅ (own event) | ✅ |
| Open/close checkpoints, CRUD checkpoints | — | — | — | ✅ |
| Resend/revoke pass, add attendee (walk-in or not RSVPed yet), delete participant | — | — | — | ✅ |
| Invite/remove staff | — | — | — | ✅ |
| Organizer on every event without an invite | — | — | — | ✅ only an account whose email is in `ADMIN_EMAILS` (F9) |
| Dashboard, analytics, CSV export | — | — | — | ✅ |
| Sheet ingest endpoint | HMAC-signed Apps Script only | | | |
| Answer an RSVP (`/rsvp#token`), and set a first password | RSVP link holder only | | | |
| Send RSVPs to chosen applicants; revoke someone's RSVP (v0.9.1) | — | — | — | ✅ |
| See own passes (`/me`) | — | ✅ signed in with their registered email | — | — |
| Link a badge (v0.10: staff only) | — | — | ✅ from Manual search in the scanner (only an unlinked badge; giving someone a new badge frees their old one) | ✅ from the Participants page or the scanner (can move a badge linked to someone else) |
| Unlink a badge (v0.10) | — | — | — | ✅ (Participants page) |
| View a badge profile (`/profile/<uid>`, shared fields only; public since v0.9) | ✅ | ✅ | ✅ | ✅ |
| Opt in/out of the badge profile | — | ✅ | — | — |
| Browse the Hacker directory and set own directory opt-in, bio and pace (F16) | — | ✅ signed-in accepted, undeleted attendee of the selected event only (F14 window); a token alone is insufficient | Only if also such an attendee | Only if also such an attendee |
| Set own LinkedIn (`/me/profile`, v0.5), Discord username and website (v0.9.2) | — | ✅ signed in with their registered email | — | — |
| Open own hacker menu; set own emergency contact and profile setup answers (F14, v0.6, v0.9; dietary notes come only from the Sheet since v0.8.2) | — | ✅ signed in with their registered email | — | — |
| Write the event's schedule and emergency info (Info page, v0.6) | — | — | — | ✅ |
| Create, join (with a code) or leave a team while forming is open; pick its track once released (F15, v0.7) | — | ✅ signed in with their registered email | — | — |
| Open team forming, release tracks, edit tracks and any team at any time (§11 Teams, v0.7) | — | — | — | ✅ |
| See an attendee's emergency contact, overnight stay, team status and accessibility needs (v0.6, v0.9) | — | — | — | ✅ |
| See an attendee's allergies (v0.9) | — | — | ✅ on an accepted meal scan | ✅ |
| Set the RSVP deadline (Info page, v0.9) | — | — | — | ✅ |
| Write badge tags while linking | — | — | ✅ | ✅ |

Authorization is always checked **server-side**. Hiding a button is not authorization.

---

## 4. Architecture

```
Google Form ──► Google Sheet ──(Apps Script onEdit, HMAC-signed POST)──► /api/ingest/sheet
                     ▲                                                          │
                     └──────────── "Sync now" (Sheets API, service acct) ◄──────┤
                                                                                ▼
 Participant email ◄── Email provider ◄── outbox drainer ◄── Postgres (Supabase) ◄── Next.js route handlers
        │                                                          ▲
        ▼                                                          │
  /p#<token> pass page ── POST /api/pass ─────────────────────────┤
                                                                   │
 Volunteer phone: /scan/<event> ── camera ── POST /api/scan ── record_scan() (single SQL function)
 Organizer: /admin/<event> ── dashboard, participants, checkpoints, staff, sync, export
```

| Layer | Choice | Notes |
|-------|--------|-------|
| Framework | Next.js (App Router), TypeScript `strict` | Route handlers are the only API surface |
| Hosting | Vercel | Co-locate the function region with the DB region |
| DB/Auth/Storage | Supabase (Postgres, Auth, Storage) | Local dev via `supabase start` (Docker) |
| Email | Transactional provider (Resend assumed, §17 A1) | `EMAIL_PROVIDER=console` in dev/test |
| QR generation | `qrcode` (npm) | Server PNG for email; client canvas on pass page |
| QR scanning | Library behind a `QrScanner` interface (§17 A7) | Swappable |
| Validation | `zod` at every boundary | Request bodies, Sheet rows, env vars |
| Tests | Vitest (unit + integration), Playwright (e2e), pgTAP optional | See §14 |

### Architectural principles

1. **The browser never queries Supabase tables.** All data access goes through Next.js route handlers or server actions. These use a server-only service-role client **after** an explicit authorization check. RLS is enabled on every table with **no policies** (deny-all), so a leaked anon key exposes nothing. DECISION: this centralizes authorization in app code, which is easier to reason about than per-table policies for a small team. The cost is that route-level authorization tests are mandatory (T-SEC-04).
2. **Postgres is the source of truth for event-day state.** The Sheet is the source of truth for acceptance decisions.
3. **Every scan decision happens in one SQL function, `record_scan()`.** That means one round trip and one transaction, with the database enforcing uniqueness. App code MUST NOT read scan state and then write it.
4. **Server time is authoritative.** Client timestamps are stored for diagnostics only.
5. **Constraints live in the database.** Uniqueness, foreign keys, cross-event consistency and checks are enforced by Postgres, not just in TypeScript.

---

## 5. Data model

Migration `0001_init.sql` (reference implementation; the tests in §14 are authoritative):

```sql
create extension if not exists pgcrypto;  -- gen_random_uuid()
create extension if not exists pg_trgm;   -- fuzzy name search

create type participant_status as enum ('pending','accepted','waitlisted','rejected','withdrawn');
create type staff_role        as enum ('organizer','volunteer');
create type checkpoint_kind   as enum ('door','meal','session','custom');
create type scan_method       as enum ('qr','manual');
create type outbox_status     as enum ('pending','sending','sent','failed','cancelled');

create table events (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  name       text not null,
  venue      text not null,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  timezone   text not null default 'America/Toronto',
  sheet_id   text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table staff_profiles (
  user_id      uuid primary key references auth.users on delete cascade,
  display_name text not null check (length(display_name) between 1 and 60)
);

create table event_staff (
  event_id uuid not null references events on delete cascade,
  user_id  uuid not null references auth.users on delete cascade,
  role     staff_role not null,
  added_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

-- Organizers invite by email; consumed on first sign-in (§7 F9).
create table staff_invites (
  event_id uuid not null references events on delete cascade,
  email    text not null check (email = lower(btrim(email))),
  role     staff_role not null,
  primary key (event_id, email)
);

create table participants (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references events on delete cascade,
  external_id      text,                       -- "Applicant ID" from the Sheet; null for walk-ins
  email            text not null check (email = lower(btrim(email))),
  first_name       text not null check (length(first_name) between 1 and 100),
  last_name        text not null default '' check (length(last_name) <= 100),
  search_text      text not null,              -- normalized by app: see §10.4
  dietary_notes    text check (length(dietary_notes) <= 500),
  linkedin_url     text check (linkedin_url ~ '^https://(www\.)?linkedin\.com/in/[A-Za-z0-9_%-]+/?$'),
  photo_path       text,                      -- retained only to delete existing photos
  photo_updated_at timestamptz,               -- retained only to delete existing photos
  status           participant_status not null,
  source           text not null check (source in ('sheet','walk_in','seed')),
  is_test          boolean not null default false,
  deleted_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, event_id),          -- target for composite FKs
  unique (event_id, external_id), -- NULLs allowed (walk-ins)
  unique (event_id, email)
);
create index participants_search_trgm on participants using gin (search_text gin_trgm_ops);

create table passes (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants on delete cascade,
  token_hash     text not null unique check (token_hash ~ '^[0-9a-f]{64}$'), -- hex sha256
  issued_at      timestamptz not null default now(),
  revoked_at     timestamptz,
  revoke_reason  text check (revoke_reason in ('rotated','status_change','manual','deleted')),
  check ((revoked_at is null) = (revoke_reason is null))
);
create unique index passes_one_active on passes (participant_id) where revoked_at is null;

create table checkpoints (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references events on delete cascade,
  name             text not null,
  kind             checkpoint_kind not null,
  requires_checkin boolean not null default true,
  capacity         int check (capacity > 0),
  is_open          boolean not null default false,  -- manual toggle is authoritative (DECISION)
  starts_at        timestamptz,                     -- informational: schedule + analytics
  sort_order       int not null default 0,
  unique (id, event_id),
  unique (event_id, name),
  check (kind <> 'door' or requires_checkin = false)
);
create unique index checkpoints_one_door on checkpoints (event_id) where kind = 'door';

create table scans (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null,
  participant_id    uuid not null,
  checkpoint_id     uuid not null,
  pass_id           uuid references passes,
  method            scan_method not null,
  scanned_by        uuid not null references auth.users,
  scanned_at        timestamptz not null default now(),
  client_scan_id    uuid not null unique,
  client_scanned_at timestamptz,
  voided_at         timestamptz,
  voided_by         uuid references auth.users,
  void_reason       text check (length(void_reason) between 3 and 200),
  -- A scan can never join a participant and a checkpoint from different events:
  foreign key (participant_id, event_id) references participants (id, event_id),
  foreign key (checkpoint_id,  event_id) references checkpoints  (id, event_id),
  check ((method = 'qr') = (pass_id is not null)),
  check ((voided_at is null) = (voided_by is null)),
  check ((voided_at is null) = (void_reason is null))
);
create unique index scans_one_live       on scans (participant_id, checkpoint_id) where voided_at is null;
create index        scans_checkpoint_time on scans (checkpoint_id, scanned_at)    where voided_at is null;

-- Every attempt, including failures. Feeds rate limiting, alerts and debugging. No PII.
create table scan_attempts (
  id             bigint generated always as identity primary key,
  event_id       uuid references events,
  checkpoint_id  uuid references checkpoints,
  staff_user_id  uuid references auth.users,
  participant_id uuid,
  result_code    text not null,
  latency_ms     int,
  created_at     timestamptz not null default now()
);
create index scan_attempts_staff_time on scan_attempts (staff_user_id, created_at);

create table email_outbox (
  id                  uuid primary key default gen_random_uuid(),
  participant_id      uuid not null references participants,
  kind                text not null check (kind in ('pass_issued','pass_reissued')),
  status              outbox_status not null default 'pending',
  attempts            int not null default 0,
  next_attempt_at     timestamptz not null default now(),
  locked_until        timestamptz,
  last_error          text check (length(last_error) <= 500),
  provider_message_id text,
  created_at          timestamptz not null default now(),
  sent_at             timestamptz
);
create unique index outbox_one_inflight on email_outbox (participant_id) where status in ('pending','sending');
create index        outbox_due          on email_outbox (next_attempt_at) where status = 'pending';

create table audit_log (
  id            bigint generated always as identity primary key,
  event_id      uuid references events,
  actor_user_id uuid references auth.users,
  actor_kind    text not null check (actor_kind in ('staff','sheet_sync','system','participant')),
  action        text not null,              -- e.g. 'scan.void', 'pass.resend', 'participant.delete'
  subject_id    uuid,
  detail        jsonb not null default '{}', -- MUST NOT contain names, emails or tokens
  created_at    timestamptz not null default now()
);

create table rate_limits (
  key          text not null,
  window_start timestamptz not null,
  hits         int not null default 0,
  primary key (key, window_start)
);

-- Deny-all RLS on every table in public. New tables MUST be covered (T-SEC-02 enforces this).
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
```

### 5.1 Data-model rules

- **One active pass per participant** is enforced by `passes_one_active`. Issuing a pass MUST go through `issue_pass()` (§6.3).
- **Once per checkpoint** is enforced by `scans_one_live`. Voiding a scan frees the slot.
- **Cross-event scans are impossible**, enforced by the composite foreign keys (T-SCAN-22).
- **Exactly one door checkpoint per event** is enforced by `checkpoints_one_door`.
- **Never hard-delete scans.** Void them instead.
- **Participant deletion is a tombstone.** Set `deleted_at`, set `first_name = 'Deleted'`, `last_name = ''`, `email = 'deleted+<id>@invalid'`, set `search_text = ''`, and null out dietary notes, LinkedIn, Discord username and website (v0.9.2), emergency contact (v0.6), the profile setup answers (v0.9) and any legacy photo (deleting the existing photo object from storage). Revoke the pass with reason `deleted`. Delete the badge link. Scans remain, so aggregate counts stay correct. The tombstone also takes them out of their team (v0.7), clears bio and pace, and sets `directory_opt_in = false` (F16).
- **Any view** MUST be created `with (security_invoker = true)`, and `select` on it MUST be revoked from `anon` and `authenticated`. Views otherwise run with owner privileges and bypass RLS.
- **Any function** in `public` MUST have `revoke all ... from public, anon, authenticated` and `grant execute ... to service_role`. Postgres grants EXECUTE to PUBLIC by default. SECURITY DEFINER functions MUST `set search_path = public, pg_temp` (T-SEC-08).

### 5.2 Badges (v0.3)

```sql
alter type scan_method add value 'nfc';   -- its own migration: a new enum value can't be used in the same transaction

create table badges (
  uid            text not null check (uid ~ '^([0-9a-f]{2}){4,10}$'),
  event_id       uuid not null references events on delete cascade,
  participant_id uuid not null unique,                        -- one badge per participant
  linked_at      timestamptz not null default now(),
  primary key (uid, event_id),                                -- links are per event
  foreign key (participant_id, event_id) references participants (id, event_id) on delete cascade
);

alter table participants add column profile_public boolean not null default false;  -- badge profile sharing (default true since v0.9)
alter table participants add column linkedin_set_at timestamptz;  -- v0.5: the attendee set their own LinkedIn (§6.5, F3)
alter table participants                                            -- v0.9.2: optional, shown on the badge profile (§6.5)
  add column discord_username text check (discord_username ~ '^[a-z0-9_.]{2,32}$'),
  add column website_url text check (website_url ~ '^https?://\S+$' and length(website_url) <= 300); -- the field takes 200
```
`badges` follows the deny-all rules above. Who linked a badge is recorded in `audit_log` (`badge.link`), not on the row.

### 5.3 RSVP (v0.4)

```sql
alter table participants
  add column rsvp_token_hash text unique check (rsvp_token_hash ~ '^[0-9a-f]{64}$'),  -- sha256 hex, rotated per RSVP email
  add column rsvp_sent_at timestamptz;
-- email_outbox.kind gains 'rsvp'.
```

### 5.4 Hacker menu (v0.6)

```sql
alter table participants
  add column emergency_name     text check (length(emergency_name) between 1 and 100),
  add column emergency_phone    text check (emergency_phone ~ '^[0-9+() .-]{3,30}$'),
  add column emergency_relation text check (length(emergency_relation) <= 60),
  add column dietary_set_at     timestamptz,  -- the attendee set their own dietary notes (F3)
  add constraint participants_emergency_pair check ((emergency_name is null) = (emergency_phone is null));

alter table events
  add column schedule       text not null default '' check (length(schedule) <= 5000),  -- plain text (§11 Info)
  add column emergency_info text not null default '' check (length(emergency_info) <= 2000);
```
The emergency contact is personal data: organizers only (§11), never in logs or `audit_log.detail` (I-11), not in any CSV, deleted by the tombstone (§5.1) and by retention (§15). `save_hacker_profile()` and `rsvp_respond()` write the attendee's fields through one internal helper (`_set_hacker_profile`, no grants); `linkedin_set_at` and `dietary_set_at` move only when the value actually changes.

### 5.5 Teams (v0.7)

```sql
alter table events
  add column teams_open boolean not null default false,       -- organizers open team forming (F15)
  add column tracks_released boolean not null default false;  -- and release the tracks

create table tracks (id uuid primary key, event_id uuid not null references events on delete cascade,
  name text not null check (length(name) between 1 and 100), created_at timestamptz not null default clock_timestamp(),
  unique (id, event_id));                                        -- + unique (event_id, lower(name))
create table teams (id uuid primary key, event_id uuid not null references events on delete cascade,
  name text not null check (length(name) between 1 and 60),
  join_code text not null check (join_code ~ '^[A-HJ-NP-Z2-9]{8}$'), track_id uuid,
  unique (id, event_id), unique (event_id, join_code),        -- + unique (event_id, lower(name))
  foreign key (track_id, event_id) references tracks (id, event_id) on delete set null (track_id));
alter table participants
  add column team_id uuid, add column looking_for_team boolean not null default false,
  add foreign key (team_id, event_id) references teams (id, event_id) on delete set null (team_id);
create table team_invites (team_id uuid not null, participant_id uuid not null, event_id uuid not null,
  invited_by uuid references participants on delete set null, created_at timestamptz not null default now(),
  primary key (team_id, participant_id),
  foreign key (team_id, event_id) references teams (id, event_id) on delete cascade,
  foreign key (participant_id, event_id) references participants (id, event_id) on delete cascade);
```
Composite foreign keys keep a team's track and members in its own event. A trigger (`_participant_team`) locks the team row and refuses a 5th member (`check_violation`), however the member is added, and takes a new member out of the teammate directory (`looking_for_team = false`) and deletes all their pending invites. The tombstone also deletes their invites. `team_invites` has an index on `participant_id` and deny-all RLS. Deleting a track leaves its teams without one; deleting a team moves its members out.

### 5.6 RSVP deadline and profile setup (v0.9)

```sql
alter table events add column rsvp_deadline timestamptz;  -- null: no deadline (F13)
create table reminder_runs (event_id uuid not null references events on delete cascade,
  kind text not null check (kind in ('rsvp','profile')), run_on date not null,
  primary key (event_id, kind, run_on));                  -- each reminder day fires once
-- email_outbox.kind gains 'rsvp_reminder' and 'profile_reminder'.
alter table participants
  add column overnight text check (overnight in ('yes','no','unsure')),
  add column allergies text check (length(allergies) between 1 and 300),
  add column allergy_severity text check (allergy_severity in ('mild','moderate','severe')),
  add column team_status text check (team_status in ('team','looking','solo')),
  add column accessibility text check (length(accessibility) between 1 and 500),
  add constraint participants_allergy_pair check ((allergies is null) = (allergy_severity is null));
```
A profile is **finished** once the emergency contact, `overnight` and `team_status` are set (computed, not stored). Allergies and accessibility needs are personal data like the emergency contact (§5.4): organizers only (allergies also on accepted meal scans, F7), never in logs or `audit_log.detail`, deleted by the tombstone and by retention. The participants CSV carries overnight, team status and allergies (for catering and rooms), never accessibility or the emergency contact.

### 5.7 Hacker directory (F16)

```sql
alter table participants
  add column directory_opt_in boolean not null default false,  -- default true since v0.11.19
  add column bio text check (length(bio) between 1 and 280),
  add column pace text check (pace in ('competitive','balanced','casual'));
```
Directory consent is independent of `profile_public` (badge sharing) and `looking_for_team` (names-only teammate discovery). `parseProfileInput()` validates bio and pace: missing fields stay unchanged, blank text clears to NULL, CRLF becomes LF, outer whitespace is trimmed; bio is plain text. `_set_hacker_profile()` / `save_hacker_profile()` write them with the existing own-row authorization. Audit `profile.update` contains at most boolean sharing/opt-in flags; never bio, pace or networking details. New signatures and `hacker_directory()` have I-6 permissions and T-SEC-08 coverage.

---

## 6. Tokens, passes & QR codes

### 6.1 Token

- **DECISION (v0.4): derived, not random.** `token = base64url(HMAC-SHA256(PASS_TOKEN_SECRET, pass_id)[0:24])`: 32 characters, charset `[A-Za-z0-9_-]`, 192 bits. The pass id is a random uuid chosen when the pass is issued (§6.3). The server can recompute the token to show a signed-in owner their pass on `/me`, without ever storing it. Someone holding both the database and `PASS_TOKEN_SECRET` could compute live tokens; the service-role key already lets its holder issue passes, so this adds little. Passes issued before v0.4 have random tokens (`crypto.randomBytes(24)`) and aren't shown on `/me`. Changing the secret has the same effect on older passes; scanning is unaffected.
- RSVP tokens (F13) are random (`crypto.randomBytes(24)`), stored only as `sha256` in `participants.rsvp_token_hash`, and carried only in `/rsvp#token` and the `POST /api/rsvp` body.
- Store `sha256(token)` as lowercase hex in `passes.token_hash`. The raw token MUST NOT be written to the DB, logs, analytics, error trackers, URLs' path or query string, or `audit_log`.
- The token exists in plaintext only in these places:
  - in memory during email rendering,
  - inside the email,
  - inside the QR code,
  - in the pass page's URL **fragment**,
  - in POST bodies to `/api/scan` and `/api/pass*`, and the `PATCH /api/pass` body (badge profile opt-in, §6.5),
  - in the `/p#token` link on the signed-in owner's `/me` page (v0.4).

### 6.2 QR payload

- The payload is exactly `${APP_ORIGIN}/p#${token}`.
- **Why a URL:** if a participant scans their own code with their phone camera, it opens their pass page.
- **Why a fragment:** browsers do not send the fragment to the server, so the token never appears in server or CDN access logs.
- No PII is ever in the QR code.
- Render settings:
  - error correction **M** (about 15% recovery),
  - quiet zone of **4 modules**,
  - **opaque white background** (`#FFFFFFFF`), dark modules `#000000`,
  - PNG width 600 px.
- The background MUST be opaque. A transparent PNG in dark-mode email clients shows black modules on a dark background, which will not scan.

### 6.3 Pass issuance — `issue_pass()`

```sql
create or replace function public.issue_pass(p_participant_id uuid, p_token_hash text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare new_id uuid;
begin
  perform 1 from participants where id = p_participant_id for update;  -- serialize issuance
  update passes set revoked_at = now(), revoke_reason = 'rotated'
   where participant_id = p_participant_id and revoked_at is null;
  insert into passes (participant_id, token_hash) values (p_participant_id, p_token_hash)
  returning id into new_id;
  return new_id;
end $$;
revoke all on function public.issue_pass(uuid, text) from public, anon, authenticated;
grant execute on function public.issue_pass(uuid, text) to service_role;
```

**v0.4:** `issue_pass(p_participant_id, p_token_hash, p_pass_id uuid default gen_random_uuid())`. The drainer chooses the id so it can derive the token from it (§6.1); everything else is unchanged.

**DECISION: rotate on every send.** Because only hashes are stored, a pass cannot be "resent". Every send, including an organizer's Resend, issues a new token and revokes the old one. Scanning an old token returns `REVOKED` with `reissued = true`, and the UI tells the volunteer to ask for the latest email.

### 6.4 Parsing scanned text (client and server)

`parseScannedText(raw: string): { ok: true, token } | { ok: false, reason }`
1. Trim whitespace.
2. If `raw` matches `^${APP_ORIGIN}/p#([A-Za-z0-9_-]{32})$`, return the captured token. **v0.11.15:** the same goes for the legacy origin `https://nfc.yvesdonato.com`, which passes emailed before the domain moved still carry.
3. Else if `raw` matches `^[A-Za-z0-9_-]{32}$`, return it (manual paste or printed fallback).
4. Anything else returns `MALFORMED`. This includes other origins, `http:` in production, extra query or fragment parameters, Wi-Fi QR codes, vCards, and strings over 2 KB. `MALFORMED` MUST NOT trigger a network request, and parsing MUST NOT throw.

### 6.5 NFC badges (v0.3)

- **UID** (what identifies a badge). Every NFC chip has a serial number set at the factory: 4, 7 or 10 bytes (our NTAG21x tags have 7). Chrome's Web NFC reports it as `serialNumber`, in hex pairs separated by colons, e.g. `04:A1:B2:C3:D4:E5:F6`; copied by hand it may also have capitals, dashes or spaces.
  - **Why it's normalized:** the badge row (`badges.uid`), the link written on the tag, a tap in the scanner and a link made from the Participants page must all spell the same chip the same way, or a tap would miss the badge it was linked to.
  - **How (`normalizeUid()`, `lib/domain/badge.ts`):** trim, lowercase, and remove `:`, `-` and spaces. What's left must be 4–10 bytes of hex, i.e. an even number of 8 to 20 characters from `0-9a-f`: `^([0-9a-f]{2}){4,10}$`. Anything else becomes `null` and is never sent or stored.
  - **Examples:** `04:A1:B2:C3:D4:E5:F6` → `04a1b2c3d4e5f6`; ` 04-a1-b2-c3 ` → `04a1b2c3`; `04:A1:B2` (3 bytes), `04A1B2C3D` (odd length) and `04:G1:B2:C3` (not hex) are invalid.
  - **Where:** the browser normalizes every read before using it (scanner, Manual search and Participants page linking, tag writer). An unusable UID shows `MALFORMED` in the scanner, or a "couldn't read" message when linking or writing, and sends nothing. The APIs don't normalize: `/api/scan` (`badgeUid`) and `POST /api/events/:slug/badges` (`uid`) accept only the normalized form and answer `400` to anything else, capitals included (T-NFC-05). The database checks the same pattern on `badges.uid`. The badge page normalizes the UID in its URL, so capitals and dashes still find the badge, and an invalid UID is `404`; tags always hold the normalized form.
  - **Display:** staff notices and the tag writer show a UID in Chrome's form again (`formatUid()`: `04:A1:B2:C3:D4:E5:F6`), so it matches what Android shows for the tag.
- **Tag payload:** one NDEF URL record, exactly `${BADGE_ORIGIN}/profile/<uid>?tap`. `?tap` is ignored; it is kept so tags written by the earlier datathon-badges app keep working. `BADGE_ORIGIN` defaults to `NEXT_PUBLIC_APP_ORIGIN`. Link badge checks the NDEF records from the linking tap and writes this payload first unless the tag already holds exactly one URL record equal to that link. Writing is skipped unless the origin is `https://`, so `localhost` is never written onto a physical tag. Writing never starts without a tap; a pending write is cancelled on close/Stop, leaving the page, a different serial, or after 5 s, so Chrome cannot write it onto the next tag.
- **DECISION: a UID is not a secret.** Any phone can read it, and it can be cloned onto writable tags. This is an accepted risk: the QR pass stays the primary credential, a badge only works once staff link it (v0.10; before, its holder could claim it), and the once-per-checkpoint rule limits what a clone can do; volunteers escalate suspected misuse to an organizer. I-3 does not apply to UIDs, but UIDs still never go into `audit_log.detail`.
- **DECISION (v0.10, reverses v0.5): staff link badges; attendees don't.** Self-claim ("This is my badge", `claim_badge()`) is gone: an unlinked badge's UID is in its URL, so anyone could claim a badge they didn't hold. Staff pick the hacker from the hacker list and tap the badge on an Android phone (Web NFC): organizers on the Participants page (§11), any staff in the scanner's Manual search (§10.4). Both write the profile link when missing using that same read and the safety rules above, then call `POST /api/events/:slug/badges` (`link_badge()`) and show the outcome as a notice (`linkNotice()`: the UID when linked or taken, the person's name when they're no longer in the event), never a green screen (I-1). A successful write adds "Its profile link is on the badge."; an already-correct tag keeps today's notice. A failed or timed-out write still links and adds "Couldn't write its profile link: hold the badge still and tap Link badge again."; failed linking keeps its existing notice. Only accepted attendees are offered; `link_badge()` itself still accepts any undeleted participant of the event (a non-accepted link scans `NOT_ACCEPTED` and shows no profile). **Organizers unlink** a badge on the Participants page (`unlink_badge()`: `UNLINKED` or `NOT_FOUND`, the same lock as `link_badge()`, audit `badge.unlink` with `{}`); unlinking never changes or locks the chip, so it can be linked again. An unlinked badge's page says staff link badges at the check-in desk. `badge.claim` audit rows from v0.5–v0.9.2 stay. (v0.5 history: attendees claimed their badge with `claim_badge()`, audited `badge.claim`.)
- **Links are per event.** One badge per participant; a badge can be reused at a later event. `link_badge()` (staff, v0.10: Participants page and scanner Manual search) returns `LINKED`, `NOT_FOUND` (participant not in this event, or deleted) or `BADGE_TAKEN` (a volunteer tried to take a badge linked to someone else; an organizer's link moves it). Links in one event are serialized (an advisory lock), so simultaneous swaps can't deadlock. Revoking a pass and deleting a participant both remove their badge link.
- **Profile:** **DECISION (v0.9, reverses v0.3): public.** Anyone who taps a badge sees what its holder shares, without signing in; sharing is on by default (`profile_public` defaults to true) and the holder can switch it off on `/me/profile` or their pass page. `proxy.ts` still refreshes the session on `/profile` (so the holder is recognized) but never sends anyone to sign in there. `badge_profile(uid, viewer_id?, viewer_email?)` looks at the newest link of an **accepted**, undeleted participant in an event that ended at most 30 days ago (otherwise null) and returns `{ allowed: true, public: false }` or `{ allowed: true, public: true, firstName, lastName, linkedinUrl, discord, websiteUrl }` to every viewer. The v0.9 migration switched sharing on only for people who had never seen the choice (no `rsvp.yes`, `profile.update`, `profile.visibility` or `badge.claim` in the audit log, and no pass); everyone else kept theirs. It never returns email, dietary notes, allergies, status or photo. **v0.6:** when the viewer's email is the linked participant's own, it also returns `self: true` and the event `slug`, and the page sends them to their hacker menu `/me` (F14) instead of their own profile. The page is rendered per request (never cached), so opting out takes effect immediately. LinkedIn comes from the Sheet until the attendee sets their own (v0.5: `normalizeLinkedIn()` turns `linkedin.com/in/x` and similar into `https://www.linkedin.com/in/x`; blank clears it), on their Hacker profile page (and, v0.6 to v0.8, the RSVP Yes form). `save_hacker_profile()` (v0.6; `save_badge_profile()` is kept for now but unused by the app) changes only the signed-in person's own accepted row, sets `linkedin_set_at` when the LinkedIn actually changes, and audits `profile.update` without PII; from then on the Sheet no longer changes their LinkedIn (F3). **v0.9.2:** the same page takes an optional Discord username (`normalizeDiscord()`: `@` and case dropped, 2–32 of `a-z 0-9 _ .`, no `..`) and an optional website (`normalizeWebsite()`: `http(s)` only, `https://` added when no scheme is typed (a port is not a scheme), no credentials, a host with a dot; the field takes 200 characters and the stored form at most 300, room for `https://` and percent-encoding); blank clears either. LinkedIn, Discord and website each carry their rule as an HTML `pattern`, so the browser refuses a typo before the form is sent (a server refusal reloads the form and loses what was typed); every stored value passes its pattern. The badge page shows the Discord name with a **Copy** button (Discord has no public link for a username) and the website as a `nofollow ugc` link labelled with its address. Neither comes from the Sheet.
- **Browsers:** Web NFC exists only in Chrome on Android. Every NFC control is **hidden** where `NDEFReader` is absent (no fallback text). iPhones still open the profile page by reading the URL record natively.

---

## 7. Flows

### F1 — Application intake (no code)

1. Participants apply through the Google Form, which writes to the Sheet.
2. The Sheet has two extra columns: `Applicant ID` and `Sync Status`. A `Status` column may stay for the organizers' own notes; since v0.4 Station ignores it for participant status (v0.11.22: Import CSV can filter rows by it).

### F2 — Applicant ID assignment

The installable `onFormSubmit` trigger writes `Utilities.getUuid()` into `Applicant ID` for the new row (Appendix A). **Row identity is Applicant ID, never the row number or email.** People sort sheets, and people change emails.

### F3 — Applicant import (v0.4)

**DECISION (v0.4): the Sheet only imports applicants.** Acceptance happens in Station: organizers send RSVPs (F13) and a Yes accepts. Editing `Status` in the Sheet never accepts, emails or revokes anyone.

1. A form submission, or an edit to any data cell except `Sync Status`, fires the installable trigger. The script reads **every row in the edited range** and POSTs them in one signed request (§9.2).
2. The server upserts each row using the table below and returns per-row results **in request order**.
3. Apps Script writes each result into `Sync Status` (e.g. `CREATED 2026-10-03T14:02:11Z`, or `ERROR HTTP 500`).
4. If the trigger was missed or failed, an organizer uses **Sync now** (F10) to reconcile. (v0.11.7: there is no admin Sync page; see F10. v0.11.22: organizers import a CSV export of the Sheet instead, F10.)

**Transition table** (per row, keyed by `(event_id, external_id)`):

| Existing | Row | Action | Row result |
|----------|-----|--------|-----------|
| none | valid | insert participant as `pending` | `CREATED` |
| any (not deleted) | nothing changed | nothing | `UNCHANGED` |
| not accepted | name, dietary notes, LinkedIn or email changed | update | `UPDATED` |
| accepted | name, dietary notes or LinkedIn changed | update | `UPDATED` |
| accepted | **different email** | update email, enqueue `pass_reissued` (rotation revokes old) | `PASS_QUEUED` |

Any email change also clears the RSVP token (F13): that link was sent to the old address. A LinkedIn the attendee set themselves (`linkedin_set_at`, v0.5), or dietary notes they set themselves (`dietary_set_at`, v0.6), are never overwritten or compared: only the other fields count.
| deleted (tombstone) | anything | nothing | `UNCHANGED` |
| any | invalid row | nothing | `INVALID:<field,field>` |
| none, or an email change, where the email is already used by another `external_id` in this event | — | nothing | `CONFLICT_DUPLICATE_EMAIL` |

Rows are processed independently, so one bad row never fails the batch. The whole request MUST be idempotent: replaying an identical request produces no new participants, passes or emails.

### F4 — Pass email (outbox drain)

Draining is triggered by three things:
- (a) Next.js `after()` following an RSVP send, an RSVP Yes, an ingest or a resend,
- (b) the admin **Send pending** button,
- (c) a scheduled job every 5 minutes (v0.10.1: a Vercel Cron Job in `vercel.json` calling `GET /api/cron` with `Authorization: Bearer $CRON_SECRET`, which is set to `DRAIN_SECRET`; it also runs the RSVP deadline and reminders, F13, then drains; §17 A5).

**Claim** (safe with concurrent drainers):
```sql
update email_outbox o
   set status = 'sending', locked_until = now() + interval '2 minutes', attempts = attempts + 1
 where o.id in (
   select id from email_outbox
    where (status = 'pending' and next_attempt_at <= now())
       or (status = 'sending' and locked_until < now())      -- crashed drainer's lease expired
    order by next_attempt_at
    limit 20
    for update skip locked)
returning o.*;
```

**Per claimed row, in this order:**
1. Reload the participant. If it is deleted, or (for `pass_*` rows) not `accepted`, or (for `rsvp` rows, F13) already `accepted`, set the row to `cancelled` and stop.
2. For a pass: choose the pass id, derive the token (§6.1), and call `issue_pass(participant_id, sha256hex(token), pass_id)`. For an RSVP: generate a random token and store its hash in `rsvp_token_hash` (with `rsvp_sent_at`). **This commits before sending** (I-10). The emailed link must already work when it lands.
3. Render the email (§12) and send it through the provider. Use the provider's idempotency key (`outbox.id:attempts`) if supported (§17 A1).
4. On success: set `status = 'sent'`, `sent_at`, and `provider_message_id`.
5. On failure: set `status = 'pending'`, `next_attempt_at = now() + backoff[attempts]` (1 min, 5 min, 25 min, 2 h), and `last_error` (truncated, no PII). After 5 attempts, set `status = 'failed'`, which surfaces on the dashboard. On a 429, honor `Retry-After`.

**Known edge (accepted):** if the provider accepted the send but marking the row `sent` failed, the retry rotates the pass and sends a second email. Only the newest code works. This is safe, just noisy.

### F5 — Pass page

1. The participant opens `/p#<token>`. Client JS reads `location.hash` and POSTs `{ token }` to `/api/pass`.
2. The response carries `state`:
   - `active`: first name, event name/venue/local time and badge-profile sharing state. The page renders the QR client-side with the §6.2 settings.
   - `replaced`: "This pass was replaced. Check your most recent email."
   - `cancelled`: "This pass is no longer valid. Contact the organizers."
   - Not found: a generic "Pass not found". Do not distinguish further (no enumeration).

### F6 — Door check-in

1. The volunteer signs in and opens `/scan/<event-slug>`, then selects a checkpoint (persisted per device).
2. The camera decodes a QR code, and `parseScannedText` runs.
3. On `MALFORMED`, the volunteer sees an amber screen and no request is sent.
4. Otherwise, POST `/api/scan` with a fresh `clientScanId` (UUID v4).
5. The server authenticates, rate-limits, hashes the token and calls `record_scan()`. It logs to `scan_attempts` and returns a `ScanResponse` (§9.1).
6. The client renders the result (§10.2). While a result is on screen, scanning is paused.

### F7 — Meals

Same as F6 at a `meal` checkpoint with `requires_checkin = true`. The response includes `dietaryNotes` **only** for meal checkpoints. Each meal is its own checkpoint (e.g. "Lunch Sat", "Dinner Sat").

### F8 — Sessions, workshops & custom checkpoints

- **Sessions:** `kind = session`, with optional `capacity`. This feeds attendance analytics.
- **Custom:** swag pickup, raffle entry, sponsor booth. These are once per participant in v1. `requires_checkin` is configurable (e.g. a raffle desk outside the venue sets it to false).

### F9 — Staff onboarding and sign-in (v0.4)

1. An organizer enters an email and role on `/admin/<slug>/staff`. An existing account becomes staff at once (and any pending invite for that address is dropped, so an older role can't come back). Otherwise a `staff_invites` row is created and Supabase Auth emails an **invite** link to set a password. **v0.11.12:** the existing account (e.g. a hacker whose RSVP Yes made one, F13) is emailed too: `invite_staff()` queues a `staff_added` outbox row in the same transaction, drained after the response like every other email (I-10 spirit). The row names the account and the event (`user_id`, `event_id`) instead of a participant (a check keeps each kind's recipient straight), at most one waits per account and event, and the drainer reads their current role when it sends (`staff_email_target()`), cancelling it if they were removed meanwhile. The Staff page says "Added. We emailed them a link to sign in."; when the auth server couldn't send an invite (`emailed: false`, logged with its error code only) it says the email didn't go out and points to "Forgot or never set your password?".
2. Everyone signs in at `/login` with **email + password**. The first time, staff set `display_name`. Only staff get this step; attendees go straight on (to `/me` by default, or back to the badge, §6.5).
3. On every sign-in, and after setting a password, every invite matching their verified, lowercased email is consumed: it becomes an `event_staff` row and the invite is deleted.
4. **"Forgot or never set your password?"** emails a **reset** link for an existing account, an **invite** link (first password) to an accepted participant or invited staff member without an account, and nothing to anyone else. The page shows the same message every time, so it can't be used to find out who has an account.
5. Invite and reset links open `/auth/confirm` with the token in the **fragment** (never sent to a server, like I-3). It is used only when the person presses **Continue** (a POST), so mail scanners that open links can't spend it. Then `/set-password` (8–72 characters).
6. An account's email can't be changed without confirming the new address (Supabase "secure email change" stays on), because `/me`, badge profiles and invites trust the account's email.
7. **Admin emails (v0.4.1).** An account whose verified email is in `ADMIN_EMAILS` becomes organizer on every event at each sign-in (`grant_admin_roles()`: real `event_staff` rows, so every check in §3 and §8 applies unchanged). Without an account, step 4 sends such an address an invite. Events created later are granted at the next sign-in; removing an address from `ADMIN_EMAILS` doesn't remove roles already granted (remove them on the Staff page). `/me` lists a signed-in staff member's events with **Admin** (organizers) and **Scanner** links, and `/` redirects to `/me`.
8. **DECISION (v0.4): no public sign-up.** Accounts are created only by an RSVP Yes (F13), a staff invite, or step 4.
9. Removing a staff member deletes the `event_staff` row. Their **next** scan returns `FORBIDDEN`, with no caching of roles.

### F10 — Sync now (reconcile)

**v0.11.7:** the admin **Sync** page is removed (owner's decision: prod has no Google service account, so it could not run). The steps below and `POST /api/admin/:slug/sync` remain, tested by T-ING-25, for a later setup; applicants arrive through the Apps Script (F3).

**v0.11.22: Import CSV.** On the admin **Tools** page (back in the header for this; owner’s request) an organizer picks a CSV export of the Sheet (File → Download → CSV) instead of step 1; no Sheet link or service account is needed. The browser sends its text as `POST /api/admin/:slug/sync` `{ dryRun, csv }` (at most 4,000,000 characters; the page refuses files over 2 MB). `parseCsv()` reads it (RFC 4180, BOM dropped) and the same header lookup and upsert run (Appendix A headers, keyed by Applicant ID, I-14): first a dry run, whose counts the page shows, then **Import** applies it, audited `sheet.sync` with counts only. A missing required header is 422 `BAD_SHEET` naming it. Optional `statuses: ['accepted', 'waitlisted']` (either or both; empty means all rows) filters trimmed, case-insensitive Sheet Status values, with `waitlist` counting as waitlisted; a nonempty filter without the Status header returns 422 `BAD_SHEET` "Missing header: Status", `skipped` counts rows excluded by the filter (0 without one) while `total` counts only imported rows, and Status still never changes anyone’s participant status. New people are pending ("not RSVPed yet") and nobody is emailed, except a `pass_reissued` for an accepted person whose email changed (F3).

1. Read the entire Sheet through the Sheets API, with the Sheet shared to the service-account email.
2. Run the **same** upsert code as F3 in **dry-run** mode, producing a diff (counts per result, plus the rows that would change).
3. The organizer reviews and confirms, then the diff is applied.
4. Record `audit_log` action `sheet.sync` with counts only.

### F11 — Void (undo)

- Volunteers can void **their own** scan within **120 s**. Organizers can void any scan, at any time.
- A reason is required (3–200 chars).
- Voiding sets `voided_at`, `voided_by` and `void_reason`, and writes an `audit_log` entry.
- DECISION: voiding a door scan does **not** cascade to later meal or session scans.

### F12 — Walk-ins

An organizer adds a walk-in with name and email (source `walk_in`, status `accepted`). An optional "check in now" performs a manual door scan. Sending a pass email is optional. A walk-in who wants an account uses "Forgot or never set your password?" (F9).

**v0.7.1:** the dialog is **Add attendee**. With **Not RSVPed yet** ticked, the person is added as a pending applicant instead (source `walk_in`, audit `participant.applicant`) and sent nothing; an organizer sends their RSVP like anyone else's (F13), e.g. to see the RSVP email. Check-in and a pass can't be combined with it (400). They have no Applicant ID, so the Sheet never updates them.

### F13 — RSVP (v0.4)

1. On the Participants page an organizer ticks applicants who aren't accepted yet and presses **Send RSVP**. `queue_rsvps()` queues one `rsvp` outbox row each; accepted, deleted and other events' people are skipped. Audit `rsvp.send` records the count only.
2. The drainer emails the invitation (§12) with a link `${APP_ORIGIN}/rsvp#<token>` and the reply-by time (v0.9). Each send rotates the token, so only the newest link works; the token is stored only while the drainer still holds the job (`set_rsvp_token`). An email change in the Sheet (F3) clears it: the link went to the old address.
   **Deadline (v0.9).** Organizers set the event's RSVP deadline on the Info page (Datathon: Nov 3, 11:59 PM ET; a past time is refused). An invitation **closes** at the deadline, or 48 h after it was sent if that's later (late invites, e.g. from the waitlist); no deadline means it never closes. After it closes, Yes is refused (`CLOSED`, 409 before any account is made) and the page says the deadline passed; No still works. `run_rsvp_jobs()`, every 5 minutes from `/api/cron`:
   - **No reply counts as a no:** pending, invited people past their close become `withdrawn` with the same effects as a No, unless an organizer's re-send to them is still waiting to go out. Audit `rsvp.expire`, one row each with `{}`. Their spot goes back to the organizers, who send the next RSVPs themselves (DECISION: no automatic waitlist).
   - **Reminders** at 10:00 local on the deadline day and the two days before it (Nov 1, 2 and 3), once each (`reminder_runs`) and never more than 6 h late, to pending invitees who can still answer and weren't invited in the last 24 h. A reminder is an RSVP email (`rsvp_reminder`) with a new link (older links stop working) that doesn't restart the 48 h; one still unsent 6 h after it was queued is dropped. An organizer's RSVP replaces a waiting reminder.
   - **Profile reminder** at 10:00 local two days before the event (Nov 5), once, to accepted hackers whose profile isn't finished (F14, `profile_reminder`).
3. `/rsvp` reads the fragment and POSTs `{ token }` to `/api/rsvp`. It shows the event and **Yes** / **No**.
4. **Yes** ("Yes, I'm coming"; No is "No, give my spot away", v0.9) asks only for a **password, always required** (v0.7.2): a new one (8–72 characters) without an account, their own with one. **v0.9:** the emergency contact, networking profile and directory opt-in moved to profile setup (F14 step 3), where the signed-in hacker lands next (`/me/profile`); `/api/rsvp` still accepts and checks those optional fields from older pages. The server checks it all with `parseProfileInput()` before anything changes (400 `invalid_profile` with the field; no account is made), and `rsvp_respond()` stores the fields in the same transaction as the answer. It then sets `accepted` and, when that accepts them, queues `pass_issued`, unless a pass is already active or an organizer revoked their last pass (only an organizer's Resend issues a new one). An RSVP still waiting in the outbox is cancelled first. Without an account the server creates a confirmed account with the chosen password (the emailed link proved the address). With an account the password is checked like a sign-in, with its own per-email limit (§15: only the token holder gets here, so burning someone's `/login` tries can't block their Yes); a wrong one, or one past the limit, is 400 `wrong_password` and nothing changes, and so is an account made since the lookup (a double tap). A sign-in failure that isn't a wrong password (GoTrue rate limit, 5xx) is a 500, never shown as a wrong password. A Yes without a password is 400 `password_required`. Either way the server signs them in, with the same steps as `/login` (admin roles, staff invites, and the display-name step for staff who need it, F9), and the page goes where those steps say, normally `/me`. A new account whose sign-in fails after its answer is recorded keeps the answer and is asked to sign in (`signedIn: false`). The body must be JSON (400 otherwise): a cross-site form can't send it, so no other site can sign a visitor into someone else's account. An RSVP never changes an existing account's password (a forgotten one is reset on `/login`).
5. **No:** `withdrawn`; any active pass is revoked (`status_change`), in-flight email cancelled and the badge link removed.
6. Answers can change until the invitation closes (v0.9; No until the event ends); after the event the link returns not found. Audit `rsvp.yes` / `rsvp.no`, with no personal data. Known edge (accepted): a deadline crossed in the moment between the lookup and the answer can leave a new account behind with the answer refused.

### F14 — Hacker menu (v0.6)

1. **Opening it.** An attendee taps their own badge (§6.5: `badge_profile` returns `self`), or signs in: both open `/me` (v0.6.1: no event slug in the URL). `/me` also keeps the staff links (F9 step 7). (v0.11.8 showed the schedule on the menu page; v0.11.9 moved it back to `/me/schedule`.)
2. **Menu items** (v0.11.18 order): **Hackers** (`/me/hackers`), Schedule, Team, Emergency contact and Hacker profile, with My pass above them. **Who and which event.** A signed-in, accepted, undeleted attendee, matched by verified email, up to 30 days after the event ends (`myEvent()`). With more than one such event, `/me` shows the next one that hasn't ended, else the most recent (DECISION, v0.6.1: one event at a time; an event picker can come later). Without one, `/me` shows only staff links or "No upcoming events yet", and the other menu pages are 404. `proxy.ts` sends signed-out visitors to `/login` and back.
3. **Hacker profile** (`/me/profile`): **v0.9 profile setup** first: staying overnight (Yes / No / Not sure, required), team status (have a team / looking for a team, which lists their name in the teammate directory / going solo, required), allergies with how severe (Mild / Moderate / Severe: life-threatening; optional, separate from dietary preferences) and accessibility needs (optional, short answer). **v0.11.17:** the emergency contact is no longer on this page: it is set only on the Emergency contact page (step 5). It is still required for a finished profile (§5.6), so while it is missing the profile page links to it ("Add your emergency contact →") and its menu item warns "Not set". Until overnight and team status are answered the page is headed "Finish setting up your profile" and the menu item says "Finish setting up". Arriving from the RSVP's "Set up my hacker profile" (`/me/profile?setup=1`), setup is a guided walkthrough, one step at a time: the event → health and access → networking (optional). Step 3 includes **List me in the Hacker directory** (checked by default since v0.11.19), optional pace and a 280-character bio alongside LinkedIn, Discord, website and badge sharing. This is the RSVP directory opt-in: RSVP Yes itself still asks only for a password (F13). Opened any other way (the menu, the profile reminder), the page shows its sections as tabs, each saving its own fields (v0.11.14), in the order Networking, The event, Health and access (v0.11.18); it opens on The event while overnight or team status is unanswered, otherwise on Networking. Team status moves the names-only Looking opt-in only when it changes, so it never undoes an opt-out made on the Team page. Then, as before: name (read-only: the Sheet owns it), badge status, LinkedIn, Discord username and website (v0.9.2, all optional) and badge sharing, plus directory opt-in, pace and bio (the same networking form, **Save links**, also on the full profile page). **DECISION (v0.8.2):** attendees no longer see or edit dietary notes in the app; they come from the Sheet (F3) and only staff see them (organizers, meal scans F7). The forms send no dietary key, so saving keeps the stored notes. (`/api/rsvp` still accepts and prefills them; notes an attendee set earlier still win over the Sheet, F3.)
4. **Schedule** (`/me/schedule`): the event's `schedule` text with its line breaks, or "not posted yet". **v0.8.2:** a line `9:00-10:00 | Title | Place` (end time and place optional; 24-hour or `1:00 PM`, shown as typed) shows as a time slot, under the other lines above it as day headings (`parseSchedule()`); a line with no slot below it is plain text, and text without any slot line shows as written. **v0.11.5:** timed slots render as a calendar grid with days side by side on wide screens (v0.11.19: from 1024px, each day's width weighted by the square root of its slot count, so a busy day is wider) and one selectable day on phones (default: today in the event timezone, otherwise the first day), a compact 64px-per-hour axis. **v0.11.16:** slots are laid out like the Hacker Package poster: columns by category (Hacking and Workshops left, Food middle, Sponsors and Activities right; a day uses only the columns it has); a slot with nothing overlapping it in another column, and none within 15 minutes, spans the whole day; hacking also runs under the Food column (food draws on top) and into the right column when that is free; overlaps in one column stack, each a step further in than the cards it covers, and a card starting within 15 minutes of one beneath it sits just below that card's title (v0.11.21: a card of 2 hours or more over a same-column card that starts with it is drawn from an hour later, so the card beneath shows its title, time and place; its own text keeps the real start, e.g. Photo Booth on Sponsor Station). A live red now line updates each minute in the event timezone, including the same-night midnight tail, and auto-selects that day on phones; outside the schedule there is no line. Past events turn grey with their category colour retained as a thin left edge; in-progress events have an accent ring and accessible status text. A missing end lasts 30 minutes; crossing midnight and after-midnight starts following afternoon/evening slots stay on the same night. Categories are inferred from titles (first match wins): Workshop, Talk or MLH Meetup → Workshops; Lunch, Dinner, Breakfast or Snack(s), including Snack Cart → Food; Sponsor → Sponsors; Hacking Begins/Ends, Devpost, Draft Due, Demos, Judging, Quiet Rooms or Team formation → Hacking; everything else → Activities. Blocks have category colours and accessible category names, with a legend below; notes remain above the grid and free text keeps its original rendering. **v0.11.19:** each event is a button that opens a dialog with its title, subtitle, category, status (upcoming, happening now, finished), day, start and end with the duration, and place; Escape, Close or a tap outside closes it and focus returns to the event. It replaces the hover card.
5. **Emergency contact** (`/me/emergency`): the event's `emergency_info`, read-only, and the attendee's own contact (name and phone required, relationship optional). The phone input carries the same rule as an HTML `pattern`, so a typo is caught before the form is sent.
6. **My pass:** the `/p#token` link, or "In your email", "On its way by email" or "The event is over".
7. Saves go through `save_hacker_profile()` (own row only, §6.5) and audit `profile.update` with at most the sharing and directory opt-in flags.

### F15 — Teams (v0.7)

1. **Organizers set it up** by creating tracks through `POST /api/admin/:slug/tracks` and editing them on the admin **Teams** page (§11): they switch **Team forming open** on the morning of the hackathon (DECISION: an organizer switch, not a time), and **Tracks released** when the tracks are announced. They can edit tracks and any team at any time.
2. **Team page** (`/me/team`, a **Team** item in the hacker menu, F14). Before forming opens it says "Teams open on hackathon day"; a team an organizer already made shows read-only.
3. **Create** a team (a name, 1–60 characters, unique in the event in any case): the creator joins it and sees its **join code**, 8 characters without look-alikes (no I, O, 0, 1), shown as `ABCD-EFGH`. **DECISION: a join code is not a secret.** Teams share it on purpose; it only lets an accepted attendee of the same event join until the team is full, and a member can leave.
4. **Join** with a code (case, spaces and dashes ignored): `BAD_CODE` for an unknown code or another event's, `TEAM_FULL` past 4 (**DECISION: at most 4**, enforced by the database), `IN_A_TEAM` if they already have one.
5. **Leave**: the last member leaving deletes the team. The team row is locked first, so a join racing the last leaver either lands before (the team stays) or finds it gone (`BAD_CODE`).
6. **Track**: once tracks are released, any member picks the team's one track until the event ends, even after forming closes.
7. **Teammate directory moved to Hackers (F16):** `/me/team` keeps create/join/leave/track, received invites with Accept/Decline and the **Looking for a team** switch. It links **Find teammates in the Hacker directory** to `/me/hackers?looking=1`. An accepted hacker without a team can switch Looking on here or choose looking during profile setup. **DECISION: the old opt-in remains names only.** Looking hackers without full directory consent appear only under the Looking filter, names only; the viewer's own legacy names-only row stays excluded. Full directory opt-ins include the viewer, marked (you), without actions. A team with room can invite eligible other hackers while forming is open. Teamless viewers see "Create a team to invite them."
8. **Invites** (S11b): after verifying the caller’s own accepted, undeleted row in an event that has not ended, `team_invite` returns `SELF` if the invitee id equals the caller’s participant id, before checking forming or team status; it writes no invite, email or audit row. The UI never renders a self-Invite button; the full Hacker directory may show the viewer’s own card marked (you), without actions (F16). **Invite** stores a pending invite and queues a `team_invite` email (§12). The invitee sees the team name and inviter's first name on their Team page, with **Accept** and **Decline**. Consent is required: only Accept joins, with the same rules as a code. Decline deletes the invite. Joining by any route clears all their invites and turns looking off. A teamed hacker stays looking off even after RSVP Yes or a same-team preference update. The outbox allows one in-flight email per person: a second invite is stored and shown on the Team page but not emailed while another email is pending. The drainer emails about the newest pending invite, or cancels if none remain; an invite never issues a pass.
9. Team mutations use `team_create`, `team_join`, `team_leave`, `team_set_track` and `team_invite`: own accepted, undeleted row only (matched by verified email), event not ended, forming open (except the track). Directory preference and decline also check the caller's own accepted, undeleted row by email. Audit `team.*` with ids only: no team names or codes (I-11).

### F16 — Hacker directory (S13)

1. **Open Hackers** from the menu, `/me/hackers`. `loadMyEvent()` confirms a signed-in, accepted, undeleted attendee in their selected event, with F14's 30-day window, before any directory query. Signed-out visitors go to login; waitlisted, withdrawn and other ineligible viewers get 404. No route accepts a participant id for reading; the event and viewer email come from the session. It is private, never public.
2. **Opt in** in the RSVP onboarding's networking step (`/me/profile?setup=1`, step 4), or the full profile networking form later. **List me in the Hacker directory** is on by default (v0.11.19, owner's decision; it was off before), independent of badge sharing and Looking. Pace and bio are optional and can be saved before opting in. Opting out removes the full card on the next read.
3. **Browse** accepted, undeleted, opted-in hackers in the same event, including yourself marked **(you)** with no actions. Each card shows name; pace: **Going for the win** (`competitive`), **Balanced** (`balanced`), **Here to learn and meet people** (`casual`); plain-text bio with line breaks; actual team name (**In a team: {name}**), otherwise **Looking for a team** if looking, or **Going solo**. Missing pace says **Pace not set**. Networking links use the existing normalized LinkedIn, Discord username (badge Copy pattern) and website (`rel="nofollow ugc"`); self cards have no contact actions.
4. **Find people** with a name search normalized using `toSearchText` (I-12), a **Looking for a team** filter and a pace filter. Apply filters submits a GET form. Name ascending is fixed; at most 500 rows per Looking/all directory query, with deterministic id tie-break, before name/pace filtering. Browsing is available before forming opens and after it closes within the F14 window.
5. **Looking for teammates:** the Looking filter also returns accepted, undeleted Looking hackers without a team who have not opted into the full directory: **id and name only**, with no bio, pace, networking or other profile fields. A pace filter excludes these rows. Invite appears only for another Looking hacker without a team when your team has fewer than 4 members and forming is open before the event ends; `team_invite()` rechecks every rule, including self-invite refusal. Received invites stay on Team (F15).
6. **Privacy:** `hacker_directory()` repeats viewer/event eligibility checks and returns an explicit field allowlist, never email, phone, emergency contact, allergies, accessibility, dietary notes or participant status. It has service-role-only execution, pinned search_path and T-SEC-08 coverage. Tombstones clear all new fields (§5.1); retention follows §15.

---

## 8. Scan decision procedure — `record_scan()`

The **order matters**, and the tests pin it down. On every early return, nothing is written to `scans`.

| # | Check | Result code |
|---|-------|-------------|
| 1 | `client_scan_id` already exists → same staff: replay; different staff: conflict | `ACCEPTED` (`replayed: true`) / `CLIENT_ID_CONFLICT` |
| 2 | Checkpoint exists | `CHECKPOINT_NOT_FOUND` |
| 3 | Caller is staff on the checkpoint's event | `FORBIDDEN` |
| 4 | Resolve participant (QR: pass by hash; manual: id, not deleted) | `NOT_FOUND` |
| 5 | QR only: pass not revoked | `REVOKED` (+ `reissued`, `revokeReason`) |
| 6 | Participant's event = checkpoint's event | `WRONG_EVENT` (+ other event name; no participant data) |
| 7 | Participant `status = accepted` | `NOT_ACCEPTED` (+ status) |
| 8 | Checkpoint `is_open` | `CHECKPOINT_CLOSED` |
| 9 | If capacity is set: lock the checkpoint row **before** step 10 | — |
| 10 | No live scan exists for (participant, checkpoint). If one exists with **this** `client_scan_id`, it's a replay that committed after step 1 | `ALREADY_SCANNED` (+ previous scan info) / `ACCEPTED` (`replayed: true`) |
| 11 | If `requires_checkin`: a live door scan exists | `NOT_CHECKED_IN` |
| 12 | If capacity is set: live count < capacity | `CAPACITY_REACHED` |
| 13 | Insert. On conflict with the arbiter index, re-read: same `client_scan_id` means replay, otherwise `ALREADY_SCANNED` | `ACCEPTED` |

Why step 9 comes before step 10: without the lock, two simultaneous scans of the *same* person at a nearly full session could return `CAPACITY_REACHED` to the second scan instead of `ALREADY_SCANNED` (T-SCAN-11, T-CONC-06).

**NFC scans (v0.3)** go through `record_badge_scan(p_checkpoint_id, p_staff_user_id, p_badge_uid, p_client_scan_id, p_client_scanned_at)`. It resolves the badge within the checkpoint's event to a participant id (or null) and calls `record_scan(…, 'nfc', null, <participant id>, …)` in the same transaction. Step 4 then resolves like `manual`; a null id returns `NOT_FOUND` after steps 1–3. Step 5 stays QR-only. A badge linked only in another event resolves to null, so NFC never returns `WRONG_EVENT`. `record_scan()` itself is unchanged.

Reference implementation:

```sql
create or replace function public._who(pa participants, k checkpoint_kind)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', pa.id,
    'displayName', btrim(pa.first_name || ' ' || pa.last_name),
    'photoPath', pa.photo_path,
    'status', pa.status,
    'dietaryNotes', case when k = 'meal' then pa.dietary_notes end)
$$;

create or replace function public._prior(s scans, me uuid)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'scannedAt', s.scanned_at,
    'scannedByName', (select display_name from staff_profiles where user_id = s.scanned_by),
    'scannedByMe', s.scanned_by = me)
$$;

create or replace function public.record_scan(
  p_checkpoint_id     uuid,
  p_staff_user_id     uuid,
  p_method            scan_method,
  p_token_hash        text,         -- required iff p_method = 'qr'
  p_participant_id    uuid,         -- required iff p_method = 'manual'
  p_client_scan_id    uuid,
  p_client_scanned_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cp checkpoints%rowtype; pa participants%rowtype; ps passes%rowtype; prior scans%rowtype;
  live_n int; new_id uuid; who jsonb;
begin
  -- 1. replay
  select * into prior from scans where client_scan_id = p_client_scan_id;
  if found then
    if prior.scanned_by <> p_staff_user_id then
      return jsonb_build_object('code','CLIENT_ID_CONFLICT');
    end if;
    select * into cp from checkpoints  where id = prior.checkpoint_id;
    select * into pa from participants where id = prior.participant_id;
    return jsonb_build_object('code','ACCEPTED','replayed',true,'scanId',prior.id,
      'voided', prior.voided_at is not null, 'participant', _who(pa, cp.kind));
  end if;

  -- 2-3. checkpoint + authz
  select * into cp from checkpoints where id = p_checkpoint_id;
  if not found then return jsonb_build_object('code','CHECKPOINT_NOT_FOUND'); end if;
  if not exists (select 1 from event_staff where event_id = cp.event_id and user_id = p_staff_user_id) then
    return jsonb_build_object('code','FORBIDDEN');
  end if;

  -- 4. resolve
  if p_method = 'qr' then
    select * into ps from passes where token_hash = p_token_hash;
    if not found then return jsonb_build_object('code','NOT_FOUND'); end if;
    select * into pa from participants where id = ps.participant_id;
  else
    select * into pa from participants where id = p_participant_id and deleted_at is null;
    if not found then return jsonb_build_object('code','NOT_FOUND'); end if;
  end if;
  who := _who(pa, cp.kind);

  -- 5. revoked
  if p_method = 'qr' and ps.revoked_at is not null then
    return jsonb_build_object('code','REVOKED','participant',who,'revokeReason',ps.revoke_reason,
      'reissued', exists (select 1 from passes where participant_id = pa.id and revoked_at is null));
  end if;

  -- 6-8. event, status, open
  if pa.event_id <> cp.event_id then
    return jsonb_build_object('code','WRONG_EVENT','otherEvent',(select name from events where id = pa.event_id));
  end if;
  if pa.status <> 'accepted' then return jsonb_build_object('code','NOT_ACCEPTED','participant',who); end if;
  if not cp.is_open then return jsonb_build_object('code','CHECKPOINT_CLOSED','participant',who); end if;

  -- 9. serialize capacity-limited checkpoints
  if cp.capacity is not null then
    perform 1 from checkpoints where id = cp.id for update;
  end if;

  -- 10. already scanned (a concurrent retry of THIS scan may have committed after step 1)
  select * into prior from scans where participant_id = pa.id and checkpoint_id = cp.id and voided_at is null;
  if found then
    if prior.client_scan_id = p_client_scan_id then
      return jsonb_build_object('code','ACCEPTED','replayed',true,'scanId',prior.id,'participant',who);
    end if;
    return jsonb_build_object('code','ALREADY_SCANNED','participant',who,'previous',_prior(prior, p_staff_user_id));
  end if;

  -- 11. door prerequisite
  if cp.requires_checkin and not exists (
      select 1 from scans s join checkpoints d on d.id = s.checkpoint_id
       where s.participant_id = pa.id and d.kind = 'door' and s.voided_at is null) then
    return jsonb_build_object('code','NOT_CHECKED_IN','participant',who);
  end if;

  -- 12. capacity
  if cp.capacity is not null then
    select count(*) into live_n from scans where checkpoint_id = cp.id and voided_at is null;
    if live_n >= cp.capacity then
      return jsonb_build_object('code','CAPACITY_REACHED','participant',who,'capacity',cp.capacity);
    end if;
  end if;

  -- 13. insert
  begin
    insert into scans (event_id, participant_id, checkpoint_id, pass_id, method,
                       scanned_by, client_scan_id, client_scanned_at)
    values (cp.event_id, pa.id, cp.id, case when p_method = 'qr' then ps.id end, p_method,
            p_staff_user_id, p_client_scan_id, p_client_scanned_at)
    on conflict (participant_id, checkpoint_id) where voided_at is null do nothing
    returning id into new_id;
  exception when unique_violation then
    -- client_scan_id collided (a concurrent retry of this same scan won the race)
    select * into prior from scans where client_scan_id = p_client_scan_id;
    if found and prior.scanned_by = p_staff_user_id then
      return jsonb_build_object('code','ACCEPTED','replayed',true,'scanId',prior.id,'participant',who);
    end if;
    return jsonb_build_object('code','CLIENT_ID_CONFLICT');
  end;

  if new_id is null then
    select * into prior from scans where participant_id = pa.id and checkpoint_id = cp.id and voided_at is null;
    if prior.client_scan_id = p_client_scan_id then
      return jsonb_build_object('code','ACCEPTED','replayed',true,'scanId',prior.id,'participant',who);
    end if;
    return jsonb_build_object('code','ALREADY_SCANNED','participant',who,'previous',_prior(prior, p_staff_user_id));
  end if;

  return jsonb_build_object('code','ACCEPTED','replayed',false,'scanId',new_id,'participant',who);
end $$;

revoke all on function public._who(participants, checkpoint_kind) from public, anon, authenticated;
revoke all on function public._prior(scans, uuid)                 from public, anon, authenticated;
revoke all on function public.record_scan(uuid,uuid,scan_method,text,uuid,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.record_scan(uuid,uuid,scan_method,text,uuid,uuid,timestamptz) to service_role;
```

A `void_scan(p_scan_id, p_staff_user_id, p_reason)` function follows the same pattern. It returns `VOIDED`, `NOT_FOUND`, `FORBIDDEN` (not staff; or a volunteer voiding someone else's scan, or a scan older than 120 s), or `ALREADY_VOIDED`.

---

## 9. API contracts

All request bodies are validated with zod, and unknown keys are rejected (`.strict()`). All responses are JSON. Domain outcomes return **HTTP 200** with a `code`. HTTP errors are reserved for transport, auth or validation failures.

### 9.1 `POST /api/scan` (staff session required)

```ts
// Request
{ checkpointId: string /*uuid*/, method: 'qr' | 'manual' | 'nfc',
  token?: string /*^[A-Za-z0-9_-]{32}$, iff qr*/, participantId?: string /*uuid, iff manual*/,
  badgeUid?: string /*normalized UID §6.5, iff nfc*/,
  clientScanId: string /*uuid v4*/, clientScannedAt: string /*ISO 8601*/ }

// 200 Response
type ScanCode = 'ACCEPTED' | 'ALREADY_SCANNED' | 'NOT_FOUND' | 'REVOKED' | 'NOT_ACCEPTED'
  | 'WRONG_EVENT' | 'NOT_CHECKED_IN' | 'CHECKPOINT_CLOSED' | 'CAPACITY_REACHED'
  | 'FORBIDDEN' | 'CHECKPOINT_NOT_FOUND' | 'CLIENT_ID_CONFLICT';
{ code: ScanCode, replayed?: boolean, voided?: boolean,
  participant?: { id, displayName, status, dietaryNotes?: string | null,
    allergies?: string | null, allergySeverity?: string | null /*v0.9: meal checkpoints, ACCEPTED only*/ },
  previous?: { scannedAt, scannedByName, scannedByMe: boolean },
  reissued?: boolean, revokeReason?: string, otherEvent?: string, capacity?: number,
  serverTime: string }
```
- `ScanCode` is defined **once** in `lib/domain/scan-codes.ts` and imported by both server and client. The SQL function's codes MUST match; a test asserts the set equality (T-SCAN-23).
- Status codes:
  - `400`: schema invalid.
  - `401`: no session.
  - `429`: rate limited (120 scans/min per staff member, or more than 30 `NOT_FOUND` per staff member in 5 min, §15).
  - `5xx`: the client shows NETWORK/SERVER, never green.
- The handler ignores legacy `photoPath` returned by SQL, logs `scan_attempts` (with latency), and never logs the token.

### 9.2 `POST /api/ingest/sheet` (HMAC)

Headers:
- `X-Station-Timestamp`: unix **seconds**.
- `X-Station-Signature`: lowercase hex of `HMAC_SHA256(SHEET_INGEST_SECRET, timestamp + "." + rawBody)`.
- v0.11.21: `X-Passline-Timestamp` / `X-Passline-Signature` (the names before the rename) are still accepted when the `X-Station-*` header is absent, so Apps Scripts already pasted into Sheets keep working.

Verification:
1. Read the raw body with `await req.text()` **before** parsing.
2. Reject with `401` if `|now − ts| > 300 s`.
3. Compare the signature with `crypto.timingSafeEqual`, after checking the lengths match.
4. Reject bodies over 1 MB with `413`.

```ts
// Request
{ event_slug: string, rows: Array<{ external_id: string, email: string, first_name: string,
  last_name?: string, dietary_notes?: string, linkedin_url?: string, status: string }> } // ≤ 500 rows
// 200 Response — same length and order as rows
{ results: Array<{ external_id: string, result: 'CREATED'|'UPDATED'|'UNCHANGED'|'PASS_QUEUED'
  |'CONFLICT_DUPLICATE_EMAIL'|`INVALID:${string}` }> }
```
`status` is still accepted (older scripts send it) and ignored (F3, v0.4).
Unknown `event_slug` returns `404`. An invalid `linkedin_url` is dropped (set to null) with the row still processed, and `INVALID` is **not** raised for it (DECISION: optional field).

### 9.3 Other endpoints

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /api/pass` | token in body; 30 req/min/IP | Pass page data (F5) |
| `GET /api/events/:slug/participants/search?q=` | staff | Manual lookup (§10.4) |
| `POST /api/scans/:id/void` | staff | F11 |
| `POST /api/email/drain` | `Authorization: Bearer DRAIN_SECRET` or organizer session | F4 |
| `/api/admin/*` | organizer | Checkpoints, staff, participants, sync, export |
| `POST /api/events/:slug/badges` | staff | Link a badge: `{ participantId, uid }` → `{ code }` (§6.5); used by the Participants page (§11) and the scanner's Manual search (§10.4, v0.10) |
| `DELETE /api/admin/:slug/participants/:id/badge` | organizer | v0.10: unlink their badge → `{ code: 'UNLINKED' }`, or 404 `{ code: 'NOT_FOUND' }` (no badge, or not in this event) (§6.5) |
| `GET /api/events/:slug/checkpoints/:id/scans` | staff of the event | Who was scanned at that checkpoint (v0.8): live scans of undeleted people, newest first (at most 1000), `{ role, scans: [{ id, displayName, isTest, scannedAt, method, scannedByName, canRemove }] }`; names only, no emails; 404 for another event's checkpoint. `canRemove` only decides whether to offer Remove; removing is `POST /api/scans/:id/void` (§10.6, §11) |
| `PATCH /api/pass` | token in body; 30 req/min/IP | Badge profile opt-in: `{ token, profilePublic }` |
| `GET /profile/:uid` | anyone (v0.9) | Badge profile page (§6.5); an unlinked badge says staff link badges at the check-in desk (v0.10; no self-claim) |
| `POST /api/cron` (also `GET`, v0.10.1, for Vercel Cron) | `Authorization: Bearer DRAIN_SECRET` | v0.9: `run_rsvp_jobs()` (deadline, reminders, F13), then drain the outbox even if the jobs failed; `{ jobs, claimed }`. Every 5 minutes from the scheduler (F4) |
| `POST /api/admin/:slug/participants/rsvp` | organizer | Queue RSVPs: `{ ids }` → `{ queued }` (F13) |
| `POST /api/rsvp` | RSVP token in body; 30 req/min/IP | `{ token }` → invitation + `profile` prefill; `{ token, going, password, emergencyName, emergencyPhone, emergencyRelation?, dietaryNotes?, linkedin?, profilePublic?, lookingForTeam? }` → `{ code: 'GOING' \| 'NOT_GOING', signedIn, next? }` (F13; `next` is where to go once signed in; JSON bodies only; the emergency contact and a password are required on Yes: 400 `password_required`, `weak_password` or `wrong_password`) |
| `GET /me` | signed in | The hacker menu for the signed-in person's event (F14, v0.6.1), with their pass (§6.1), and staff links |
| `GET /me/profile`, `/me/schedule`, `/me/emergency` | signed-in accepted attendee | Hacker menu pages (F14); profile and emergency saves are server actions calling `save_hacker_profile()` |
| `PATCH /api/admin/:slug/event` | organizer | `{ sheet?, schedule?, emergencyInfo?, teamsOpen?, tracksReleased?, rsvpDeadline? }`, strict, at least one key; `rsvpDeadline` is a future ISO instant or null (v0.9, F13); `{ sheet }` answers `{ sheetId }` as before (F10, §11 Info, §11 Teams) |
| `GET /api/admin/:slug/teams`, `POST …/teams` `{ name, trackId? }`, `PATCH`/`DELETE …/teams/:id`, `POST …/tracks` `{ text }`, `PATCH`/`DELETE …/tracks/:id`, `PATCH …/participants/:id` `{ teamId }` | organizer | Teams page (§11, v0.7): switches, tracks, teams with members, accepted people without a team; 409 `NAME_TAKEN` / `TEAM_FULL`, 404 for another event's team or track |
| `GET /me/hackers` | signed-in accepted attendee | Private event-scoped Hacker directory (F16); filters `q`, `looking=1`, `pace`; server action invites through `team_invite()` |
| `GET /me/team` | signed-in accepted attendee | Team page (F15); its actions are server actions calling the `team_*` functions |
| `/login`, `/auth/confirm`, `/set-password` | — / emailed link / signed in | Password sign-in and set/reset (F9) |

---

## 10. Scanner UI (`/scan/[slug]`)

### 10.1 Layout

- A **checkpoint banner** is always visible at the top. It shows the checkpoint name and a kind color (door = blue, meal = orange, session = purple, custom = teal).
- Changing the checkpoint requires a confirm dialog. The selection is saved to `localStorage` under `station:checkpoint:<slug>` (v0.11.21; a value under the older `passline:` key is still read).
- **Camera or NFC badges, one at a time (v0.8.1).** On a phone with Web NFC (§10.5) a **Camera | NFC badges** switch picks the input; elsewhere there is no switch and the camera is the input. The choice is saved per device under `station:input`. DECISION: one at a time, because on a real Android phone a running camera stopped NFC reads; NFC mode releases the camera entirely (tracks stopped, preview hidden) and keeps the badge reader on.
- The camera viewport takes about 60% of the height, below that are the **Manual search** and **Undo last** buttons.
- The scanner abstraction:
  ```ts
  interface QrScanner { start(video: HTMLVideoElement, onDecode: (text: string) => void): Promise<void>;
    stop(): Promise<void>; listCameras(): Promise<MediaDeviceInfo[]> }
  ```
- Camera settings:
  - prefer `facingMode: 'environment'` and remember the chosen `deviceId` as a preference (`ideal`), never `exact`: Chrome can hand out new device ids (e.g. after a reload), and an exact id that no longer exists left the camera "unavailable" (v0.8.1),
  - decode at 10 fps or lower,
  - the `<video>` element MUST have `playsinline` and `muted`.
- Request a Screen Wake Lock while scanning where supported, and re-acquire it on `visibilitychange` (§17 A4).

### 10.2 Result screen

Every state needs an icon, a text label and a color, never color alone. Names are at least 32 px.

| Code | Color | Headline | Dismiss |
|------|-------|----------|---------|
| ACCEPTED (door) | green ✓ | **ADMIT** + name | auto 2.5 s |
| ACCEPTED (meal) | green ✓ | **SERVE** + name + allergy with severity (v0.9, first) and dietary notes (bold if present) | auto 2.5 s |
| ACCEPTED (session/custom) | green ✓ | **RECORDED** + name | auto 2.5 s |
| ACCEPTED `replayed` | green ✓ | same as ACCEPTED, "(confirmed)" | auto 2.5 s |
| ALREADY_SCANNED, `scannedByMe` and < 60 s ago | amber ⟳ | "You scanned this 8 s ago" | tap |
| ALREADY_SCANNED otherwise | red ✕ | "ALREADY SCANNED 12:03 PM by Maya" | tap |
| NOT_FOUND | red ✕ | "UNKNOWN CODE": use manual search | tap |
| NOT_FOUND via NFC | red ✕ | "UNKNOWN BADGE": scan their QR instead | tap |
| REVOKED, reissued | amber ! | "OLD CODE": ask for their newest email | tap |
| REVOKED, not reissued | red ✕ | "PASS CANCELLED": send to organizer | tap |
| NOT_ACCEPTED | red ✕ | "NOT ACCEPTED (waitlisted)" | tap |
| WRONG_EVENT | red ✕ | "This pass is for {otherEvent}" | tap |
| NOT_CHECKED_IN | amber ! | "Not checked in yet": send to entrance | tap |
| CHECKPOINT_CLOSED | amber ! | "{checkpoint} is closed" | tap |
| CAPACITY_REACHED | red ✕ | "FULL ({capacity})" | tap |
| FORBIDDEN / CHECKPOINT_NOT_FOUND | red ✕ | "No access": re-select event | tap → checkpoint picker |
| CLIENT_ID_CONFLICT | amber ! | "Rescan please" | tap |
| MALFORMED (client) | amber ? | "Not a Datathon code" | auto 1.5 s |
| NETWORK / 5xx (client) | amber ! | "NO RESULT: do not admit yet. Rescan." | tap |

Rules:
- Only green results auto-dismiss. Every problem requires a tap, so the volunteer notices it.
- **The client MUST NOT show green unless the server returned `ACCEPTED`** (I-1).
- Sounds: a distinct chime for green, a buzz for red, and a double tone for amber.
- `navigator.vibrate` where available. It is not supported on iOS Safari, so never rely on it.
- **Dedupe:** ignore any decode of the same text within 3 s. Pause decoding while a result is shown.
- **Network:** 8 s timeout, then auto-retry up to 2 times with the **same** `clientScanId`, then show NETWORK.
- **Offline:** when `navigator.onLine === false` or a fetch fails at the network level, show a persistent red banner "OFFLINE: use paper list" and disable scanning.

### 10.3 Undo

After a volunteer's own scan, "Undo last" is visible for 120 s. It asks for a reason with quick picks: "Wrong checkpoint", "Wrong person", "Test scan", or Other. The server enforces the time window.

### 10.4 Manual search

- Normalization, `toSearchText(s)`:
  1. Unicode NFKD.
  2. Remove combining marks (`\p{M}`).
  3. Lowercase.
  4. Replace every non-alphanumeric character with a space, collapse spaces, and trim.
  - `search_text = toSearchText(first + ' ' + last)`.
- Query: minimum 2 normalized chars. Match `search_text % q OR search_text LIKE '%' || q || '%'`, order by `similarity` descending, limit 10, same event only.
- Each row shows: name, status badge, email (**masked for volunteers**: `a***@gmail.com`; full for organizers), whether they already have a live scan at the selected checkpoint, and (v0.10) whether a badge is linked (`hasBadge`).
- "Record scan" calls `/api/scan` with `method: 'manual'`.
- **Link badge (v0.10, Android Chrome only):** accepted rows get **Link badge** (**Replace badge** when one is linked). It closes the search and opens a sheet, "Tap the badge to link it to {name}". The scanner's one reader is used: while the sheet is open a tap links (never also recorded as a scan, and it is fed to the 3 s dedupe so a repeated report isn't either), and QR and NFC scanning are paused. In Camera mode the sheet releases the camera while it is open (A10) and starts the reader from that tap, then restores the camera without changing the saved input. The linking tap first writes the profile link if missing (§6.5), then links even if writing fails or times out; the write outcome is included in the notice. The outcome stays in the sheet until **Done**.

### 10.5 NFC badges (v0.3, Android Chrome only)

- Every NFC control is rendered only when `'NDEFReader' in window`. Elsewhere there is no NFC UI and no fallback text.
- **NFC badges mode (v0.8.1; replaces the on/off toggle):** choosing **NFC badges** turns the camera off and starts the reader from that tap (it triggers Chrome's permission prompt the first time); the reader then stays on, with no off switch, until **Camera** is chosen. Opening the scanner in NFC mode auto-starts the reader if the `nfc` permission is already granted; otherwise a **Start badge reader** button asks for the tap. The reader's own state is still saved under `station:nfc`.
- **Each read:** `normalizeUid()`; an invalid UID shows MALFORMED with no request. Otherwise the same rules as QR apply: 3 s dedupe of the same UID, paused while a result is shown, 8 s timeout with retries reusing the `clientScanId`, offline disables it, and green only on `ACCEPTED`. The request is `/api/scan` with `method: 'nfc'`.
- **Keep the reader referenced (v0.7.4):** the page holds the active `NDEFReader` while scanning. On a real Android phone a reader reachable only through its own listeners was garbage-collected while Chrome kept the NFC session: Android no longer opened the tag's URL, and every tap went to nobody.
- **Read feedback (v0.7.3):** as soon as a read passes the dedupe and pause checks, the phone taps twice (30 ms, 60 ms gap, 30 ms, where `navigator.vibrate` exists), before the server answers: unlike every result pattern, so it can't be felt as the green single pulse. The result's own pattern follows (§10.2). An unreadable tag gets the amber double pulse with its notice, unless reads are being ignored (a result on screen, offline, a dialog open). Chrome ignores vibration (and sound) until the page has been tapped once, so until then the scanner shows "Tap the screen once so the phone can vibrate on each scan." Vibration is a nicety, never relied on: the screen stays the source of truth.
- **Linking a badge (v0.10)** is in Manual search (§10.4), not on the result screen. (v0.5 to v0.9.2: no Link badge in the scanner; attendees claimed their own.)
- The reader keeps running while a result is shown (taps are ignored), so Android doesn't open the tag's URL in a new tab.

---

### 10.6 Scanned here (v0.8)

- A **Scanned here** button next to Manual search lists who was scanned at the current checkpoint: name (test people marked; deleted people left out, like every count), day and time in the event timezone, how (QR, badge, manual) and by whom, newest first. Scanning pauses while it is open, like Manual search.
- **Remove** is the void (F11, I-9) with the Undo reasons: the scan stays in the history, stops counting, and the person drops off the list and can be scanned again. Volunteers see Remove only on their own scans from the last 120 s, organizers on every scan; `void_scan()` decides either way.
- A repeat scan still answers **ALREADY_SCANNED** (§10.2); the list is how staff check who has been through.

## 11. Admin UI (`/admin/[slug]`, organizer only)

| Page | Contents |
|------|----------|
| Dashboard | Live counts per checkpoint (10 s poll). Door check-in rate. Meals served vs checked in. Arrivals chart (15-min buckets). Outbox pending/failed. `NOT_FOUND` spike alert. **Warning if within 30 min of `starts_at` and the door is closed.** |
| Participants | Search/filter by status, pass state, scans. Tick applicants and **Send RSVP** (F13); pending rows show "RSVP sent". **Add attendee**: a walk-in, or **Not RSVPed yet** for a pending applicant (F12, v0.7.1). **Revoke RSVP** (v0.9.1, e.g. after a test; confirm first) on anyone invited or answered: their link stops working, waiting email is cancelled, any pass is cancelled (`status_change`, so a Yes to a new RSVP issues a fresh one) and the badge unlinked, and they are pending with no RSVP sent; profile and account stay (`revoke_rsvp()`, audit `rsvp.reset` with `{}`). Actions: resend pass (confirm: "their old code will stop working"), revoke, add walk-in, mark test, delete (tombstone), view scan history, void a scan. The detail shows the hacker's emergency contact, with a `tel:` link (v0.6), and their profile setup answers (v0.9). **Badges (v0.10):** rows show "Badge linked"; accepted rows get **Link badge** / **Replace badge** where Web NFC exists (Android Chrome; no button elsewhere): a dialog "Tap the badge to link it to {name}" runs the reader until one good tap and any profile-link write (§6.5) finishes, then `POST /api/events/:slug/badges` (an organizer's link moves a badge linked to someone else) and the outcome is the page's status message (`linkNotice()`), never a green screen. If Chrome refuses NFC, the dialog's **Start badge reader** retries. **Unlink badge** (confirm first): the badge stops scanning and showing their profile until staff link it again (`DELETE …/participants/:id/badge`); a badge already gone (moved, or the attendee said No) says "That badge was already unlinked". |
| Checkpoints | CRUD, open/close toggle, capacity, requires_checkin, sort order. Deleting a checkpoint with scans is blocked. **People** (v0.8): who was scanned there, newest first, with **Remove** (a void with a reason, F11). |
| Staff | Invite by email + role, list, remove. |
| Info (v0.6) | **RSVP deadline** only (v0.9, in the event timezone, F13), saved with `PATCH /api/admin/:slug/event`; audit `event.info` with `{}`. **Owner’s decision (v0.11.11):** Schedule and Emergency info are set through the same API (`schedule`, `emergencyInfo`), with no fields on this page. The stored text still appears on the hacker Schedule and Emergency contact pages (F14). |
| Teams (v0.7) | **Team forming open** and **Tracks released** switches. Tracks can be renamed and deleted here (teams that chose a deleted track have none). Tracks are created through `POST /api/admin/:slug/tracks` (v0.11.1: no add box on the page). Teams: create (name, track), rename, change the track, delete (members move out), each with its join code and members (status shown when not accepted); remove a member, or add an accepted person without a team (those looking for one are marked). The 4-member limit applies to organizers too. Audit `team.*`, `track.*`, `event.teams` with ids, counts and flags only. |
| Tools (v0.11.22) | **Import CSV** only: applicants from a CSV export of the Sheet, optionally only rows whose Status is Accepted and/or Waitlisted, previewed before import (F10). No badge writing or linking here (v0.11.4: that moved to Link badge). |
| Export | CSVs: participants (v0.9: with overnight, team status, allergies and severity), scans (live only, with a voided toggle), per-checkpoint summary. |

---

## 12. Email

- **From:** an address on a domain you control, with SPF and DKIM verified at the provider.
- **Subject:** `You're in: {Event name} — your check-in pass`.
- **HTML body, in this order:**
  1. greeting with first name,
  2. event name,
  3. **local** date and time (`event.timezone`, e.g. "Sat, Oct 3 · 9:00 AM EDT"),
  4. venue,
  5. QR image,
  6. "Open your pass" link (`/p#token`),
  7. (v0.9) a "Set up your profile" button to `/me/profile` with what it asks, and links to the Discord, the hacker package and the Google Group (constants in `lib/email/links.ts`; Discord and the package point to the event site until the real links are known),
  8. privacy line (v0.9: dietary notes, allergies, accessibility needs and emergency contacts are deleted 30 days after the event).
- **Plain-text part** includes the pass link and all the facts above.
- **QR image:** embed as an inline attachment referenced by `cid:` if the provider supports it. Otherwise attach it as a normal PNG attachment as well (§17 A1). Do **not** use a `data:` URI, because many clients block them.
- **Escape** all interpolated values. Keep the HTML well under Gmail's ~102 KB clipping threshold.
- **Disable open and click tracking.** Tracking rewrites links, which leaks fragments into redirect logs, and adds pixels.
- **RSVP email (F13):** subject `You're invited: {Event name}` (v0.11.23; it ended “— will you be there?” before; every email uses the datathon's full name, “Sheridan Datathon 2026”); greeting, event, local date and time, venue, (v0.9) "Please reply by {closes}. No reply by then counts as a no, and your spot goes to someone on the waitlist." when there is a deadline, one "Reply to the invitation" button to `/rsvp#token`, privacy line (v0.6: mentions emergencies and the 30-day deletion). A **reminder** (v0.9) is the same email opening "A reminder…", subject `Reminder: reply by {date} — {Event name}`. Same escaping and tracking rules.
- **Profile reminder email (F14, v0.9):** subject `Finish setting up your profile for {Event name}`; greeting, what setup asks, one "Set up your profile" button to `${APP_ORIGIN}/me/profile`, plain-text part. No token. Cancelled if the person is no longer accepted or has finished.
- **Team invite email (F15, S11b):** subject `{Inviter first name} invited you to join {Team} at {Event}`; greeting, one sentence, one "Open your Team page" button to `${APP_ORIGIN}/me/team`, plain-text part. No join code or token. Same escaping and tracking rules. Cancel if the invitee is deleted, not accepted or has no pending invite.
- **Staff added email (F9 step 1, v0.11.12):** to an existing account an organizer added as staff. Subject `You’re now {a volunteer | an organizer} for {Event name}`; the website's look (v0.11.21) with the **Staff access** hero title, greeting with their display name if set, the event's local date and time, what they can open, one centred "Sign in" button to `${APP_ORIGIN}/login?next=/scan/<slug>` (volunteer) or `/login?next=/admin/<slug>` (organizer), a line pointing to "Forgot or never set your password?", plain-text part. No token. Same escaping and tracking rules. Cancelled if they are no longer staff on the event.
- **Auth emails** (staff invite, password reset) are sent by Supabase Auth through the same SMTP domain, from the templates in `public/auth-email/` (fetched by URL by the hosted auth server).
- **Dev/test:** `EMAIL_PROVIDER=console` writes `.eml`-style output to `./.mail/` and never calls the network. It also saves each QR image to `./.mail/qr/<Event>-<First>.png` (never overwriting: `-2`, `-3`… on repeats) so passes can be shown to a scanner without opening the email. The label travels as `EmailMessage.fileLabel`, which real providers never send.

---

## 13. Analytics definitions

All metrics exclude voided scans, `is_test` participants and deleted participants unless stated. Time buckets use UTC `date_bin` with the event's `starts_at` as origin, and are **labelled** in `event.timezone`. This avoids DST collisions: on 2026-11-01 in Toronto, 01:00–02:00 happens twice.

| Metric | Definition |
|--------|------------|
| Accepted | participants with `status = accepted` |
| Checked in | distinct participants with a live door scan |
| Check-in rate | checked in ÷ accepted |
| No-shows | accepted without a live door scan (list) |
| Meal uptake | live scans at meal M ÷ checked in |
| Session attendance | live scans per session; ranking by count desc, then name asc |
| Session fill | live scans ÷ capacity (if set) |
| Arrival curve | live door scans per 15-min bucket |
| Scan problems | `scan_attempts` grouped by `result_code`, per checkpoint. For the post-event review (§16); not shown on the dashboard since v0.7.4 |

```sql
create view v_checkpoint_counts with (security_invoker = true) as
select c.event_id, c.id as checkpoint_id, c.name, c.kind, c.capacity,
       count(s.id) filter (where s.voided_at is null and not p.is_test and p.deleted_at is null) as live_scans
  from checkpoints c
  left join scans s        on s.checkpoint_id = c.id
  left join participants p on p.id = s.participant_id
 group by c.id;

-- Arrivals (parameterized in app code)
select date_bin('15 minutes', s.scanned_at, e.starts_at) as bucket_utc, count(*) as arrivals
  from scans s
  join checkpoints c on c.id = s.checkpoint_id and c.kind = 'door'
  join participants p on p.id = s.participant_id
  join events e on e.id = s.event_id
 where s.event_id = $1 and s.voided_at is null and not p.is_test and p.deleted_at is null
 group by 1 order by 1;

-- v1.1: co-attendance between sessions
select a.checkpoint_id as x, b.checkpoint_id as y, count(*) as both_attended
  from scans a join scans b
    on a.participant_id = b.participant_id and a.checkpoint_id < b.checkpoint_id
 where a.event_id = $1 and a.voided_at is null and b.voided_at is null
 group by 1, 2;
```

**CSV rules** (all exports go through `toCsv()`):
- UTF-8 **with BOM**, so Excel shows accents correctly.
- CRLF line endings, every field quoted, `"` doubled.
- **Formula-injection guard:** any cell starting with `=`, `+`, `-`, `@`, TAB or CR gets a `'` prefix.

---

## 14. Test catalog

**Layers:** **U** = unit (Vitest, no I/O) · **I** = integration (Vitest against local Supabase, real Postgres) · **E** = end-to-end (Playwright) · **M** = manual (checklist before each event).

**Standard fixture** (`tests/fixtures/standard.ts`). Each test file creates its own event with a unique slug:
- Event **E1** has checkpoints:
  - door **D**,
  - meal **L** (`requires_checkin`),
  - session **W** (capacity 2),
  - custom **R** (`requires_checkin = false`).
- Event **E2** has door **D2**.
- Participants in E1:
  - **A**, **B**: accepted, with passes,
  - **C**: waitlisted,
  - **Rv**: pass rotated once, so it has an old token and a new token,
  - **Wd**: withdrawn after acceptance (pass revoked for `status_change`),
  - **T**: `is_test`.
- **X** is accepted in E2.
- Staff:
  - **org1**: organizer on E1,
  - **vol1**, **vol2**: volunteers on E1,
  - **vol3**: volunteer on E2 only.
- All checkpoints start open unless the test says otherwise.

### 14.1 Tokens & QR — `T-TOK`
| ID | Scenario | Expected | L |
|----|----------|----------|---|
| T-TOK-01 | Generate 10,000 tokens | All unique, all 32 chars, all match `^[A-Za-z0-9_-]{32}$` | U |
| T-TOK-02 | Parse `${APP_ORIGIN}/p#<token>`; v0.11.15: `https://nfc.yvesdonato.com/p#<token>`, and the same over `http:` | `{ok:true, token}`; ok; `MALFORMED` | U |
| T-TOK-03 | Parse a bare 32-char token, and one with surrounding whitespace | ok | U |
| T-TOK-04 | Parse another origin, `http:` in prod, `/p?t=`, `/pass#`, a 31/33-char token, `+` or `/` characters, an extra `&x=1` | `MALFORMED`, no throw | U |
| T-TOK-05 | Parse `WIFI:S:x;;`, a vCard, an empty string, a 5 KB string, emoji | `MALFORMED`, no throw | U |
| T-TOK-06 | `sha256hex` known vector (`"abc"` → `ba7816bf…15ad`) | matches | U |
| T-TOK-07 | After a full ingest → RSVP → Yes → pass email → scan flow, search every text column in every table for the raw pass and RSVP tokens | not found anywhere | I |
| T-TOK-08 | Render a QR PNG and decode it (zxing/jsQR in Node) | decodes to the exact URL; corner pixel opaque white; quiet zone ≥ 4 modules | U |
| T-TOK-09 | Downscale the QR to 25%, re-encode as JPEG q40, decode | still decodes | U |
| T-TOK-10 | `passToken(secret, passId)` | deterministic; 32 chars `^[A-Za-z0-9_-]{32}$`; changes with the pass id or the secret | U |

### 14.2 Sheet ingest — `T-ING`
| ID | Scenario | Expected | L |
|----|----------|----------|---|
| T-ING-01 | Valid signature, fresh timestamp | 200, per-row results | I |
| T-ING-02 | Signature off by one hex char; wrong secret; missing header | 401, zero DB writes | I |
| T-ING-03 | Timestamp 301 s old; 301 s in the future | 401 | I |
| T-ING-04 | Same signed request sent twice | Second response: every row `UNCHANGED`; no duplicate participants, passes or outbox rows | I |
| T-ING-05 | Body with non-ASCII (`Zoë`, `李雷`, `محمد`), signed over the raw UTF-8 bytes | Verifies; names stored byte-exact | I |
| T-ING-06 | New row, `Status = Accepted` (v0.4) | participant `pending`; no outbox row; no drain scheduled | I |
| T-ING-07 | New rows `Waitlisted` / `Rejected` / blank (v0.4) | all `pending`; no outbox | I |
| T-ING-08 | Status Waitlisted → Accepted in the Sheet (v0.4) | `UNCHANGED`; still `pending`; no outbox | I |
| T-ING-09 | Accepted participant (via RSVP), row unchanged | `UNCHANGED`; no outbox, no new pass | I |
| T-ING-10 | Accepted participant, Sheet says Withdrawn (v0.4) | `UNCHANGED`; still accepted; pass active; scans untouched | I |
| T-ING-11 | Answered No (withdrawn), Sheet says Accepted (v0.4) | `UNCHANGED`; still withdrawn; no outbox | I |
| T-ING-12 | Email `" Ade@Gmail.COM "` | stored `ade@gmail.com` | I |
| T-ING-13 | Same `external_id`, new email: accepted; not accepted | email updated, `pass_reissued` queued, `audit_log` row with no PII; `UPDATED`, no outbox, old RSVP link no longer found | I |
| T-ING-14 | New `external_id` with an email already used in the event | `CONFLICT_DUPLICATE_EMAIL`; other rows in the batch still processed | I |
| T-ING-15 | Same email in E1 and E2 | two participants (allowed) | I |
| T-ING-16 | Missing email / first_name / external_id | `INVALID:email` etc.; batch continues | I |
| T-ING-17 | Status `"ACCEPTED "`, `"accepted"`, `"Maybe"`, blank, missing (v0.4) | all the same valid row; `CREATED` as `pending` | U+I |
| T-ING-18 | Accepted participant, Status cleared (v0.4) | `UNCHANGED`; pass still active | I |
| T-ING-19 | Unknown `event_slug` | 404 | I |
| T-ING-20 | 500 rows (v0.4) | < 10 s; 500 `pending` participants; 0 outbox rows; **zero provider calls**; no drain scheduled | I |
| T-ING-21 | 501 rows; body > 1 MB | 400; 413 | I |
| T-ING-22 | Names `O'Brien`, `<script>alert(1)</script>`, 100-char name, 101-char name | stored / stored (escaped on render) / stored / `INVALID:first_name` | I |
| T-ING-23 | Invalid `linkedin_url` (`linkedin.com/company/x`, `javascript:`) | row processed, `linkedin_url` null | I |
| T-ING-24 | Same row posted 5× concurrently | 1 participant (1 `CREATED`), no outbox row | I |
| T-ING-25 | Sync-now dry run | returns diff; zero writes (row counts identical before/after) | I |
| T-ING-26 | Accepted participant set their own LinkedIn on `/me` (v0.5); the Sheet row resent, then with another LinkedIn, then with a new first name and a blank LinkedIn | `UNCHANGED`; `UNCHANGED`; `UPDATED` with the new name and their own LinkedIn kept | I |
| T-ING-27 | Accepted participant changed their own dietary notes (v0.6); the Sheet row resent, then with other notes, then with a new first name and blank notes | `UNCHANGED`; `UNCHANGED`; `UPDATED` with the new name and their own dietary notes kept | I |
| T-ING-28 | v0.11.22 Import CSV: `parseCsv` with quotes, `""`, commas and line breaks in quotes, CRLF/LF, BOM, blank lines, empty cells, `toCsv` output; an event with no Sheet link: a CSV with extra columns in another order, an upper-case email and an invalid row, dry run then apply then again; no Applicant ID column; a bad body; Status values Accepted, padded waitlisted, Waitlist, Rejected and blank with accepted-only and accepted+waitlisted filters; missing Status header with a filter; empty selection; unsupported or too many statuses; the same filter on the Sheets API path. In the browser: Tools in the header, pick the file, tick Accepted, read the updated preview and skipped line, Import | rows of cells, no throw; dry run counts with no writes, then `CREATED` ×2 as `pending` (`sheet`), `INVALID:email`, no drain, one `sheet.sync` audit row with counts only, then `UNCHANGED` ×2; 422 `BAD_SHEET` "Missing header: Applicant ID"; 400. Filtered counts and `skipped` in preview/apply (0 without a filter), only matching people imported as pending; 422 "Missing header: Status"; invalid selections 400. The counts, "Import 2", the updated skipped line in preview and success, only accepted rows imported, the new rows pending without "RSVP sent", and the missing-header message | U+I+E |

### 14.3 Apps Script — `T-GAS` (manual, on a copy of the real Sheet)
| ID | Scenario | Expected |
|----|----------|----------|
| T-GAS-01 | Submit the form | `Applicant ID` filled with a UUID within seconds |
| T-GAS-02 | Submit the form (v0.4) | `Sync Status` shows `CREATED <time>`; the applicant is on the Participants page as pending |
| T-GAS-03 | Paste into a column across 30 rows at once | one POST; 30 Sync Status cells filled |
| T-GAS-04 | Edit only the Sync Status column | no POST |
| T-GAS-05 | Edit the header row | no POST |
| T-GAS-06 | Sort the sheet by name, then change a first name | the correct participant changes (keyed by Applicant ID) |
| T-GAS-07 | Insert a column left of Sync Status; add a new form question; delete the Status column | still works (header lookup) |
| T-GAS-08 | Point `ENDPOINT` at a dead URL, edit a row | `ERROR ...` in Sync Status; restore; Sync now reconciles |
| T-GAS-09 | Change the Status of someone accepted through their RSVP | `UNCHANGED`; still accepted |

### 14.4 Email & outbox — `T-MAIL`
| ID | Scenario | Expected | L |
|----|----------|----------|---|
| T-MAIL-01 | Two drainers run concurrently over 50 pending rows | each row sent exactly once (mock provider call count = 50) | I |
| T-MAIL-02 | At provider-call time, look up `sha256(token in email)` | exists in `passes` with `revoked_at IS NULL` (pass committed before send) | I |
| T-MAIL-03 | Provider throws 500 on every attempt | attempts 1..5 with backoff 1 min/5 min/25 min/2 h; then `failed`; `last_error` contains no email address | I |
| T-MAIL-04 | Provider 429 with `Retry-After: 120` | `next_attempt_at ≈ now + 120 s` | I |
| T-MAIL-05 | Drainer claims then "crashes" (never finishes) | row reclaimable after `locked_until` passes | I |
| T-MAIL-06 | Participant withdrawn between enqueue and drain | outbox `cancelled`; no pass issued; no send | I |
| T-MAIL-07 | Rendered email content | contains first name, event name, local time with TZ abbreviation, venue, `cid:` QR (or attachment), `/p#` link, plain-text part; v0.9: the profile setup link after the pass link, and the Discord, hacker package and Google Group links | U |
| T-MAIL-08 | First name `<b>x</b>` | appears escaped | U |
| T-MAIL-09 | Rendered HTML size | < 60 KB | U |
| T-MAIL-10 | `EMAIL_PROVIDER=console` | no network call (fetch spy), file written to `.mail/` | U |
| T-MAIL-11 | Organizer resends | new pass active; old token → `REVOKED` + `reissued: true` | I |
| T-MAIL-12 | Real inboxes: Gmail web, Gmail iOS (dark mode), Apple Mail, Outlook web, college email | arrives in inbox (not spam); QR scannable off each screen | M |
| T-MAIL-13 | Console provider sends a pass for "Hack Day" / "Ada" three times, and 10 in parallel | `qr/Hack-Day-Ada.png`, `-2`, `-3`, byte-identical to the inline image; 10 parallel sends → 10 files; Resend request body never contains the label | U |
| T-MAIL-14 | `toFileLabel` with accents, punctuation, `../`, empty input, 100-char names | `Cafe-Night-Zoe`; no `/`, `\\` or `..` survive; `pass` fallback; ≤ 80 chars | U |

### 14.5 Pass page — `T-PASS`
| ID | Scenario | Expected | L |
|----|----------|----------|---|
| T-PASS-01 | Open `/p#<token>` | name, event, QR shown; server request log has no token (the request is `POST /api/pass`, and `/p` is fetched without the fragment) | E |
| T-PASS-02 | Garbage token; valid-format but unknown token | same generic "Pass not found" response body and timing class | I |
| T-PASS-03 | Rotated token; revoked (withdrawn) token | `replaced`; `cancelled` | I |
| T-PASS-04 | Removed in v0.11 with participant photos | — | — |
| T-PASS-05 | Removed in v0.11 with participant photos | — | — |
| T-PASS-06 | Removed in v0.11 with participant photos | — | — |
| T-PASS-07 | Removed in v0.11 with participant photos | — | — |
| T-PASS-08 | Removed in v0.11 with participant photos | — | — |
| T-PASS-09 | Removed in v0.11 with participant photos | — | — |
| T-PASS-10 | Removed in v0.11 with participant photos | — | — |

### 14.6 Scan decision logic — `T-SCAN` (call `record_scan` directly via SQL and via `/api/scan`)
| ID | Scenario | Expected |
|----|----------|----------|
| T-SCAN-01 | A at D | `ACCEPTED`; 1 live row; `method=qr`; `scanned_at` = server time (± 2 s), unaffected by a client time of 1999; HTTP participant fields limited to §9.1 |
| T-SCAN-02 | A at D again | `ALREADY_SCANNED`; `previous.scannedByName`; `scannedByMe` true for same staff, false for vol2 |
| T-SCAN-03 | Random well-formed token | `NOT_FOUND` |
| T-SCAN-04 | Rv old token | `REVOKED`, `reissued: true`, `revokeReason: 'rotated'` |
| T-SCAN-05 | Wd token | `REVOKED`, `reissued: false`, `revokeReason: 'status_change'` |
| T-SCAN-06 | C (waitlisted, via manual since there is no pass) | `NOT_ACCEPTED` |
| T-SCAN-07 | X token at D | `WRONG_EVENT`, `otherEvent` = E2 name, **no participant object** |
| T-SCAN-08 | A at L before door; at D; at L; at L | `NOT_CHECKED_IN`, `ACCEPTED`, `ACCEPTED` (with `dietaryNotes`), `ALREADY_SCANNED` |
| T-SCAN-09 | A at R without door | `ACCEPTED` |
| T-SCAN-10 | Close D; scan B | `CHECKPOINT_CLOSED`; zero rows written |
| T-SCAN-11 | A, B at W (cap 2); then A at W again | third scan → `ALREADY_SCANNED` (**not** `CAPACITY_REACHED`) |
| T-SCAN-12 | A, B at W; new accepted participant N at W | `CAPACITY_REACHED`, `capacity: 2` |
| T-SCAN-13 | Void A at L; scan A at L | `ACCEPTED`; exactly one live and one voided row |
| T-SCAN-14 | Void B at W; N at W | `ACCEPTED` (voided scans free capacity) |
| T-SCAN-15 | Void A's door scan after lunch | lunch scan remains live (no cascade) |
| T-SCAN-16 | vol3 scans at D | `FORBIDDEN` |
| T-SCAN-17 | Remove vol1 from event staff; vol1 scans | `FORBIDDEN` on the very next call |
| T-SCAN-18 | Manual path for cases 01, 02, 06, 08 | same codes; `method=manual`, `pass_id` null |
| T-SCAN-19 | `dietaryNotes` present at L; absent (undefined/null) at D, W, R. v0.9: allergies and severity at L only; dietary notes and allergies only on `ACCEPTED` (not on a REVOKED scan), still on a retry, but not on a replay after the volunteer lost their staff role | as stated |
| T-SCAN-20 | Same `clientScanId` sent twice by vol1 | both `ACCEPTED`, second `replayed: true`; 1 row |
| T-SCAN-21 | Same `clientScanId` reused by vol2 | `CLIENT_ID_CONFLICT`; no new row |
| T-SCAN-22 | Raw SQL insert of a scan joining E2 participant X to E1 checkpoint D | FK violation |
| T-SCAN-23 | Set of codes the SQL function can return (grep function source) == `ScanCode` union | equal |
| T-SCAN-24 | `select record_scan(...)` as `anon` and as `authenticated` | permission denied |
| T-SCAN-25 | Precedence: X's **revoked** old token at D | `REVOKED` (step 5 before step 6) |
| T-SCAN-26 | Precedence: C at a **closed** checkpoint | `NOT_ACCEPTED` (step 7 before step 8) |
| T-SCAN-27 | Deleted participant: old token → ; manual by id → | `REVOKED` (`deleted`); `NOT_FOUND` |
| T-SCAN-28 | Volunteer voids own scan at 119 s; at 121 s; voids vol2's scan | `VOIDED`; `FORBIDDEN`; `FORBIDDEN` (organizer: all `VOIDED`) |
| T-SCAN-29 | Void without reason / reason "ok" (2 chars) | 400 / 400 |
| T-SCAN-30 | `GET …/checkpoints/:id/scans` (v0.8): A (vol1, fresh), B (vol2), T (org1, manual), N (vol1, 5 min old) at R, as org1 and as vol1; Rv scanned, then tombstoned; vol3; no session; D2 through E1's slug; a bad id; then void A's scan and scan A again | newest first, names and who scanned, `isTest` for T, no email; org1 may remove all, vol1 only A; Rv listed, then left out; 403; 401; 404; 404; A drops off the list and scans `ACCEPTED` again |

### 14.7 Concurrency — `T-CONC` (MUST use truly parallel connections, e.g. a `pg.Pool` of size ≥ N with `Promise.all`; never sequential awaits)
| ID | Scenario | Expected |
|----|----------|----------|
| T-CONC-01 | 50 parallel scans of A at D, distinct `clientScanId`s | exactly 1 `ACCEPTED`, 49 `ALREADY_SCANNED`; 1 live row |
| T-CONC-02 | 20 parallel scans with the **same** `clientScanId` | 20 × `ACCEPTED` (19 replayed); 1 row |
| T-CONC-03 | Capacity 10; 30 distinct participants in parallel | exactly 10 `ACCEPTED`, 20 `CAPACITY_REACHED` |
| T-CONC-04 | 10 parallel `issue_pass` for A (who already has 1 pass) | exactly 1 active pass; 11 rows total, 10 revoked `rotated` |
| T-CONC-05 | Parallel scan of A at L while the door scan is being voided | no deadlock/error; outcome is either `ACCEPTED` or `NOT_CHECKED_IN`; completes < 2 s |
| T-CONC-06 | W at capacity − 1; A scanned twice in parallel at W | 1 `ACCEPTED` + 1 `ALREADY_SCANNED` (never `CAPACITY_REACHED`) |
| T-CONC-08 | v0.9: three `run_rsvp_jobs()` at a reminder time, 20 Yes/No answers and `queue_rsvps` for the same 20 people, in parallel | no errors (no deadlock); reminders were queued; every Yes is accepted with a `pass_issued` row |
| T-CONC-07 | Loop T-CONC-01, -02 and -03 100× in CI nightly | 0 failures (flake = bug). T-CONC-02 caught a real race in this spec's first draft: it fails ~5% of runs without the step-10 replay check |

### 14.8 Scanner UI — `T-SCUI` (Playwright; Chromium with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-video-capture=tests/assets/<qr>.y4m`)
| ID | Scenario | Expected | L |
|----|----------|----------|---|
| T-SCUI-01 | Fake camera shows A's QR | ADMIT screen < 1.5 s after page ready | E |
| T-SCUI-02 | Same QR stays in frame for 10 s | exactly 1 `/api/scan` request (route interception count) | E |
| T-SCUI-03 | Each `ScanCode` stubbed via route interception | correct color, icon, text label, dismiss rule per §10.2 (screenshot + DOM assertions) | E |
| T-SCUI-04 | `/api/scan` hangs | 2 retries with the same `clientScanId` (assert request bodies), then NETWORK screen; never green | E |
| T-SCUI-05 | `context.setOffline(true)` | OFFLINE banner; scanning disabled; manual scan disabled | E |
| T-SCUI-06 | QR encoding `https://example.com` | "Not a Datathon code"; zero `/api/scan` requests | E |
| T-SCUI-07 | Change checkpoint | confirm dialog; banner updates; persisted after reload | E |
| T-SCUI-08 | Camera permission denied | instructions shown; manual search usable | E |
| T-SCUI-09 | Undo visible at 0–120 s, hidden after (fake timers) | as stated | E |
| T-SCUI-10 | Session expired mid-shift | redirect to login, then back to the same slug + checkpoint | E |
| T-SCUI-11 | `<video>` has `playsinline` and `muted` | yes | E |
| T-SCUI-12 | ALREADY_SCANNED with `scannedByMe` 8 s ago vs 90 s ago vs by vol2 | amber vs red vs red; red shows the scan time and staff name, with no additional hint | E |
| T-SCUI-14 | Scanned here at R after vol1 scanned N and vol2 scanned Rv (v0.8); Remove N with "Test scan" | both listed; Remove only on N; N drops off, Rv stays | E |
| T-SCUI-13 | Device matrix (§14.13) | all pass | M |

### 14.9 Manual search — `T-SRCH`
| ID | Scenario | Expected | L |
|----|----------|----------|---|
| T-SRCH-01 | `toSearchText("Zoë O'Brien-Smith")` | `"zoe o brien smith"` | U |
| T-SRCH-02 | Query `zoe`; `obrien`; `ade` (matching Adebayo); `李` | finds each | I |
| T-SRCH-03 | Query of 1 char | 400 | I |
| T-SRCH-04 | 30 matching names | 10 results | I |
| T-SRCH-05 | Name in E2 only, searched from E1 | not returned | I |
| T-SRCH-06 | Volunteer vs organizer | masked vs full email | I |
| T-SRCH-07 | Result shows scan state at the selected checkpoint | yes; HTTP row fields limited to §10.4 | I+E |

### 14.10 Admin — `T-ADM`
| ID | Scenario | Expected | L |
|----|----------|----------|---|
| T-ADM-01 | Volunteer requests every `/admin/*` page and `/api/admin/*` route | 403 server-side | I+E |
| T-ADM-02 | Toggle checkpoint open → scan → close → scan | applies on the very next scan | I |
| T-ADM-03 | Add walk-in with "check in now" | participant `walk_in`, live manual door scan | I |
| T-ADM-04 | Delete a checkpoint that has scans | blocked with message | I |
| T-ADM-05 | Delete participant | tombstone per §5.1; counts unchanged; token → `REVOKED` | I |
| T-ADM-06 | Door closed, now = `starts_at − 20 min` | dashboard warning visible | E |
| T-ADM-07 | 31 `NOT_FOUND` from vol1 in 5 min | 429 for vol1; alert on dashboard | I |
| T-ADM-08 | PATCH `{schedule, emergencyInfo}`; v0.9: `rsvpDeadline` (future, null, past, not a time) and the setup answers on the detail; one field alone; 5001 / 2001 chars, `{}`, a wrong type or an extra key; `{sheet}`. Info tab in the browser: only RSVP deadline, save and clear it; no Schedule or Emergency info fields; set their text through the API; participant detail with and without a contact (v0.6) | saved, returned by GET, audit `event.info` with `{}`; the other field unchanged; 400; still `{sheetId}`. The text shows on the hacker Schedule page; the organizer sees the contact with a `tel:` link, or `emergency: null` | I+E |
| T-ADM-09 | Add attendee with **Not RSVPed yet** (v0.7.1); then Send RSVP; with check-in or a pass as well; the same email again. In the browser: the dialog, the pending row, Send RSVP | 201, `pending`, source `walk_in`, no outbox row, no drain, no scan or pass, audit `participant.applicant` with `{}`; one RSVP email with a `/rsvp#` link; 400; 409. The check-in box disappears; the row shows "RSVP sent" | I+E |
| T-ADM-11 | v0.9.1 Revoke RSVP on an accepted person with a pass, a badge, an RSVP link and a waiting email; as a volunteer; another event's person; a bad id; then a new RSVP and Yes. In the browser, on the row that shows "RSVP sent" | `RESET`: pending, link and sent time cleared, pass revoked (`status_change`, scans `REVOKED`), badge gone, email cancelled, one `rsvp.reset` audit row with `{}`; 403; 404; 404; queued, then `GOING` with a new `pass_issued`. Confirm dialog, "RSVP revoked", "RSVP sent" and the button gone | I+E |
| T-ADM-10 | Checkpoints → People at R after A and B were scanned (v0.8); Remove A with "Test scan"; scan A again | both listed, "2 people"; A gone, "1 person"; `ACCEPTED` | E |

### 14.11 Analytics & export — `T-ANA`
| ID | Scenario | Expected | L |
|----|----------|----------|---|
| T-ANA-01 | Golden fixture with a hand-computed expected JSON | every dashboard number equals the expected value | I |
| T-ANA-02 | Voided, `is_test` and deleted participants in the fixture | excluded from every metric | I |
| T-ANA-03 | Event spanning 2026-10-31 22:00 → 2026-11-01 04:00 America/Toronto | 01:00–02:00 appears as **two** distinct buckets labelled EDT and EST | I |
| T-ANA-04 | `toCsv` with `=SUM(A1)`, `+1`, `-1`, `@x`, `"quoted"`, `a,b`, newline | guarded/escaped per §13; starts with BOM; CRLF | U |
| T-ANA-05 | Export as volunteer | 403 | I |
| T-ANA-06 | Session ranking tie | sorted by name asc | I |

### 14.12 Security & privacy — `T-SEC`, `T-PRIV`
| ID | Scenario | Expected | L |
|----|----------|----------|---|
| T-SEC-01 | For **every** table in `public` (enumerated from `pg_tables`): select/insert/update/delete with the anon key and with an authenticated user JWT | denied or 0 rows | I |
| T-SEC-02 | `pg_tables.rowsecurity` for every public table | all true | I |
| T-SEC-03 | After `next build`, grep `.next/static` for `SERVICE_ROLE` and the key's value | not found | CI |
| T-SEC-04 | Enumerate every route handler file; call each unauthenticated | 401 (except `/api/pass*`, `/api/rsvp`, `/api/ingest/sheet`, `/api/email/drain` with their own auth) | I |
| T-SEC-05 | Capture server logs during the full e2e flow | contain no token, no email, no participant name, no emergency contact (v0.6) | E |
| T-SEC-06 | Response headers | CSP present; `frame-ancestors 'none'`; `Permissions-Policy: camera=(self)`; HSTS in prod | E |
| T-SEC-07 | Every view | `security_invoker = true`; no grant to anon/authenticated | I |
| T-SEC-08 | Every `SECURITY DEFINER` function in `public` | `proconfig` contains `search_path`; no EXECUTE for anon/authenticated/PUBLIC | I |
| T-PRIV-01 | Retention job at `ends_at + 30 d` | existing photos deleted from storage, `photo_path` null, `dietary_notes` null, emergency contact null (v0.6), allergies and accessibility null (v0.9) | I |
| T-PRIV-02 | Retention job run twice | idempotent | I |
| T-PRIV-03 | `audit_log.detail` after the full e2e flow | contains no email, name, emergency contact or token | I |

### 14.13 Device & venue matrix — `T-DEV` (manual, before every event)

Run all combinations of these **scanners** against these **codes**. Record each result as pass/fail with the time to result.

Scanners:
- iPhone Safari (current iOS and one version back)
- Android Chrome (a recent phone and a cheap or old one)

Codes:
- email on a phone at 100% brightness
- the same at 30% brightness
- a screenshot in the phone’s image library
- a printed code on paper
- a code with about 10% covered by tape (tests ECC M)
- a code shown in Gmail iOS dark mode

Conditions:
- bright window light
- dim room

Target: at least 95% of attempts under 3 s.

### 14.14 Performance — `T-PERF`
| ID | Scenario | Expected |
|----|----------|----------|
| T-PERF-01 | Load test against a preview deployment: 5 virtual scanners, 300 scans in 10 min, seeded 500 participants | `/api/scan` p95 < 700 ms, 0 errors |
| T-PERF-02 | Dashboard with 1,000 participants and 5,000 scans | first render < 2 s; poll query < 200 ms |

### 14.15 NFC badges — `T-NFC` (e2e fakes `window.NDEFReader` via `addInitScript`)
| ID | Scenario | Expected | L |
|----|----------|----------|---|
| T-NFC-01 | `normalizeUid`: `04:A1:B2:C3:D4:E5:F6`; empty string; 3 or 11 bytes; odd length; non-hex | `04a1b2c3d4e5f6`; the rest invalid, no throw | U |
| T-NFC-02 | Scan request shape | nfc requires a normalized `badgeUid` and forbids `token`/`participantId`; qr and manual reject `badgeUid` | U |
| T-NFC-03 | A's badge at D; again; C's badge at D; B's badge at L before the door; A by QR at R, then A's badge at R | `ACCEPTED` (`method = nfc`, `pass_id` null); `ALREADY_SCANNED`; `NOT_ACCEPTED`; `NOT_CHECKED_IN`; `ALREADY_SCANNED` | I |
| T-NFC-04 | Unknown badge at D; X's E2 badge at D; vol3 with A's badge at D | `NOT_FOUND` and no rows; `NOT_FOUND` with no `otherEvent`; `FORBIDDEN` | I |
| T-NFC-05 | Link API: vol1 links A; A relinked to a new badge; vol1 links A's badge to B; org1 does the same; an E2 participant via the E1 slug; vol3; no session; uppercase UID | `LINKED` + audit row without UID or PII; old badge → `NOT_FOUND`; `BADGE_TAKEN`; `LINKED` (moved); `NOT_FOUND`; 403; 401; 400 | I |
| T-NFC-06 | Delete (tombstone) a participant with a badge; revoke a participant's pass | link removed; the badge scans `NOT_FOUND` (both) | I |
| T-NFC-07 | Raw SQL: bad UID; a second badge for one participant; X linked in E1 | check violation; unique violation; FK violation | I |
| T-NFC-08 | 10 parallel `link_badge` (volunteer) with one UID and 10 participants, 20 rounds; two badges swapped in parallel, 30 rounds | exactly 1 `LINKED`, 9 `BADGE_TAKEN`, 1 row per round; swaps return only `LINKED`/`BADGE_TAKEN`, never an error (deadlock) | I |
| T-NFC-09 | Result view: `NOT_FOUND` via NFC; every non-`ACCEPTED` code via NFC | red "UNKNOWN BADGE", tap to dismiss; never green (I-1) | U |
| T-NFC-10 | Scanner without `NDEFReader`; with the fake: A's linked badge; same tap twice within 3 s; tap while offline; empty serial; a read while the answer is held back; the page before and after its first tap; an unreadable tag while a result is shown, then without one (v0.7.3); a tap after a forced garbage collection, with the fake holding readers weakly like Chrome (v0.7.4) | no NFC UI; ADMIT; 1 `/api/scan` request; 0 requests; "Not a Datathon code", 0 requests; the two-tap read pattern before any result, then the green pattern; the tap-once hint until the page is tapped; nothing, then the amber pulse and notice; green | E |
| T-NFC-11 | Replaced in v0.10 by T-NFC-28 (Participants page) and T-NFC-29 (scanner Manual search); the Tools page no longer links badges | — | E |
| T-NFC-12 | `badge_profile`: unlinked; tombstoned; not public; public; linked in two events; withdrawn after opting in; event ended 31 vs 29 days ago. v0.9: signed out, another event's attendee, a waitlisted attendee, another event's staff, a random account | null; null; `{allowed,public:false}`; name + LinkedIn; newest link wins; null; null vs shown. Everyone sees the same shared fields; never email, dietary, allergies, status or photo | I |
| T-NFC-13 | `PATCH /api/pass`: active token; replaced, cancelled or unknown token; extra keys | updated + audit row without PII; 404, nothing changed; 400 | I |
| T-NFC-14 | v0.9: signed out `/profile/<uid>?tap`, shared and then not; an unlinked badge signed out; invalid UID; another event's attendee signed in | 200 with the name and LinkedIn, no email or dietary notes in the HTML; the private message on the next view; v0.10: "This badge isn’t linked yet" and "Staff link badges at the check-in desk", no sign-in link or claim button; 404; the same profile | E |
| T-NFC-15 | `badgeUrl(origin, uid)`; `badgeWritable` for `https://` vs `http://` origins; `BADGE_ORIGIN` env | exact string; only `https://` is writable; optional, bare origin like `NEXT_PUBLIC_APP_ORIGIN` | U |
| T-NFC-16 | Removed in v0.11.4 with the Tools page; writing while linking is covered by T-NFC-28/29 | — | E |
| T-NFC-18 | Auth callback: staff with a display name; staff without one; an account with no staff role (attendee) | no onboarding; onboarding; no onboarding | I |
| T-NFC-19 | `normalizeLinkedIn`: `linkedin.com/in/x`, `www.`, `http://`, query/fragment, country host, accented handle; blank, `/company/x`, `/in/`, `/in/a/b`, `javascript:`, other hosts, credentials, a port, `ftp:`, > 200 chars | `https://www.linkedin.com/in/x` (accents percent-encoded); the rest null, no throw | U |
| T-NFC-20 | Removed in v0.10 with `claim_badge()` (attendees no longer claim badges); T-NFC-27 checks the function is gone | — | I |
| T-NFC-21 | v0.10: staff linked A's badge; A signs in → Hacker profile (`/me/profile`) shows "Badge linked"; saves `linkedin.com/company/x`, then `linkedin.com/in/ada-claimed` + sharing (v0.9.2: with Discord `ada#1234`, then website `ada`, then `@Ada.Codes` and `ada.dev`); B taps the badge and copies the Discord name; the badge at D; waitlisted C opens an unlinked badge | the browser refuses `/company/x`, then saved as `https://www.linkedin.com/in/ada-claimed` (the browser refuses `ada#1234` and `ada` and keeps what was typed; then `ada.codes` and `https://ada.dev/`); B sees Ada's name and that link, `@ada.codes` with a Copy button and an `ada.dev` link, and "Discord username copied." is announced; `ACCEPTED`; "Staff link badges at the check-in desk", no claim button | E |
| T-NFC-27 | v0.10: an organizer unlinks A's badge; again; a volunteer; another event's participant through this slug; relink; `hasBadge` in the participants list and the scanner search, also with 1,001 other badges in the event; `claim_badge` | `UNLINKED`, the badge scans `NOT_FOUND`, `badge_profile` null, one `badge.unlink` audit row with `{}`; 404; 403; 404; linked again; true/false; no such function | I |
| T-NFC-28 | v0.10 `linkNotice()` for each `link_badge()` outcome. Participants page with the fake NFC: Link badge for Ada → tap; a second tap; that badge at R; stubbed `BADGE_TAKEN`; waitlisted C; Unlink badge for Ada; Unlink when the badge was removed meanwhile; NFC refused, then Start badge reader and a tap; blank tag; exactly one correct URL; multiple URL records; failed/timed-out write; different serial or close during writing; no Web NFC; Tools with Web NFC | the UID (linked, taken) or the name (not in the event), "✕ Badge not linked. Try again." for anything else. "✓ Badge … linked to Ada Fixture.", the row shows "Badge linked"; nothing more linked (no reader running); `ACCEPTED`; red "linked to someone else", no result screen; no Link badge button; confirm, "✓ Badge unlinked…", the badge scans `NOT_FOUND`; "! That badge was already unlinked."; the denial shown, then linked; exactly one URL written before linking and "Its profile link is on the badge."; no write and today's notice; rewritten to one URL; still linked with "Couldn't write its profile link: hold the badge still and tap Link badge again."; pending write aborted; no Link badge buttons; Tools (v0.11.22) shows only Import CSV, with no badge writing or linking. Unit `linkNotice()` covers written/unchanged/failed and unchanged refusal notices | U+E |
| T-NFC-29 | v0.10 scanner Manual search with the fake NFC: NFC mode, Link badge for Ben → tap; an immediate repeat tap; a later tap; another badge tapped while saving, then repeated just after Done; the sheet closed (Escape) while saving, then a new link; stubbed `BADGE_TAKEN`; Camera mode Link badge, then Cancel; waitlisted C; no `NDEFReader`; blank, already-correct and write-failing tags; different serial, close or timeout during a pending write | "✓ Badge … linked to Ben Fixture." in the sheet and no scan recorded or result shown; still no scan; ADMIT; no scan; scanning resumes and the outcome shows as a notice, and the next Link badge opens a fresh sheet that links a new tap; red notice in the sheet, no result screen; no live camera track and one reader while open, then the camera is back and the input still Camera; no Link badge button; no Link badge buttons; one URL written then linked, no write then linked, still linked with write-failure notice; no scan from linking, camera restored; pending write aborted, only the original badge linked with the write-failure notice | E |
| T-NFC-22 | `badge_profile` viewed by the badge's holder (email in another case), shared and not; by another attendee, staff, another event's attendee. E: A taps their own badge; B taps it (v0.6) | `self: true` and the event `slug` added to the usual keys; never `self` or `slug` for anyone else. A lands on `/me`; B sees the badge profile | I+E |
| T-NFC-23 | Scanner with the fake reader (v0.8.1): the default; NFC badges; reload; Start badge reader and a tap; Camera; a tap of another badge; reload. NFC badges while a slow camera start is still pending. With the `nfc` permission granted: NFC badges, then a reload | Camera pressed; every camera track ended, one reader, no reader off switch; still NFC mode with the camera off; a green result; the camera ready again and no reader; no `/api/scan` request; still Camera mode. The late camera stream is stopped at once (no live track). One reader after the tap (not replaced), and after the reload the reader is ready without a tap, still exactly one | E |
| T-NFC-24 | v0.9: a new participant; the backfill rule on someone untouched, someone who answered an RSVP, saved their profile, set sharing on the pass page, claimed a badge, or holds a pass | shares by default; only the untouched one is switched on | I |
| T-NFC-25 | v0.9.2: `normalizeDiscord`: ` @Ada.Codes `, `ada_99`; empty, 1 or 33 chars, `ada#1234`, a space, `a..b`, `-`, `@@ada`, `ä`. `normalizeWebsite`: `ada.dev`, `http://…?x=1`, an upper-case host, `ada.dev:8443/x`; empty, `javascript:`, `data:`, `mailto:`, `ftp:`, credentials, `localhost`, a space, over 200 chars. The LinkedIn, Discord and website `pattern`s on these inputs (also handles with `.` or `!`, and 200 typed website characters), and on stored values. `parseProfileInput` with both, blank, missing, invalid | `ada.codes`, `ada_99`; the rest null, no throw; `https://ada.dev/`, kept, lower-cased host, `https://ada.dev:8443/x`; the rest null; the patterns refuse what the server refuses and accept every stored value; normalized, `''` (clear), unchanged, the field named | U |
| T-NFC-26 | v0.9.2: save a Discord name and website on `/me/profile`; the badge viewed signed out, shared and then not; invalid values; a save without those keys; blank values; raw SQL bad values; the tombstone | stored normalized; shown in `badge_profile`, then only `{allowed, public:false}`; `INVALID_DISCORD` / `INVALID_WEBSITE` and nothing changed; unchanged; cleared; check violations; both null. Audit without PII | I |
| T-NFC-17 | Real Android Chrome + real badges; iPhone tapping a written tag; an old nfc.yvesdonato.com tag | serial present and Android doesn't open the URL while scanning; `/profile` opens; resolves once the domain points at Station | M |

### 14.16 RSVP — `T-RSVP` (v0.4)
| ID | Scenario | Expected | L |
|----|----------|----------|---|
| T-RSVP-01 | Organizer queues RSVPs for C, a new pending applicant, accepted A, a deleted participant and E2's X; a volunteer tries; extra keys | `{ queued: 2 }` (C and the new one), drain scheduled; 403; 400. Audit `rsvp.send` detail is only the count | I |
| T-RSVP-02 | Drain an `rsvp` row; one for a person accepted meanwhile; a claimed job cancelled by a No | the hash of the emailed `/rsvp#token` is already stored when the provider is called; the other row `cancelled`, no email; `set_rsvp_token` refuses, old token kept | I |
| T-RSVP-03 | Also: Yes after an organizer's revoke, and No then Yes after it; No for someone with a badge; 20 RSVP sends racing 20 answers | no pass queued; badge link removed; no errors (no deadlock) | I |
| T-RSVP-03 | `{token}`; Yes twice; No; unknown token; ended event; bad `going`; extra keys; 31 requests/min from one IP | invitation without email; `GOING` ×2 with exactly 1 `pass_issued` and a drain; `NOT_GOING`: withdrawn, outbox cancelled; 404 `{state:'not_found'}` (same as `/api/pass`); 404; 400; 400; 429. Audit `rsvp.yes`, `rsvp.no` | I |
| T-RSVP-04 | Yes without a password, and with a 5-char one; Yes + password without an account; when an account exists (v0.7.2): no password, a wrong one, their own; their own past this limit; their own with `/login`'s limit used up; an account made since the lookup with another password; GoTrue failing; a `text/plain` body; staff who still need a display name; a new account whose sign-in fails after its answer. In the browser, someone with an account, and a volunteer without a display name | 400 `password_required`, 400 `weak_password`, nothing changed; confirmed account, `signedIn: true`; 400 `password_required`, 400 `wrong_password` and still pending, `GOING` with `signedIn: true` and the password unchanged; still `wrong_password`; `GOING` (separate buckets); `wrong_password` and still pending; a 500 and still pending; 400 `invalid_body`; `next` is the onboarding page; `GOING` with `signedIn: false`. The form asks for "Your Datathon password", refuses a wrong one, then lands on `/me`; the volunteer lands on `/onboarding?next=%2Fme` | I+E |
| T-RSVP-05 | Organizer ticks a row → Send RSVP → link from the email → Yes + password → profile setup (v0.9) | "RSVP sent" on the row; the email and page show the reply-by time, and "No, give my spot away"; no dietary notes or contact fields on Yes; lands on `/me/profile` "Finish setting up your profile"; the setup answers are stored and the Sheet's dietary notes kept; "My pass" links the same token as the pass email, which scans `ACCEPTED`; no token in any request URL; signed out `/me` → login → back | E |
| T-RSVP-06 | v0.9: Yes with only a password; with a name only; a bad phone; an invalid LinkedIn; 501 chars of dietary notes; a wrong type | `GOING`, no contact stored; 400 `invalid_profile` with the field (400 `invalid_body` for the type), still pending, no account created; No needs no form | I |
| T-RSVP-08 | v0.9: an invitation closes at the later of the deadline and 48 h after it was sent; a null deadline never closes. Yes after closing; the answer itself after closing (SQL); No after closing; a late invite inside its 48 h; an accepted person's lookup. In the browser: a closed link | `closed: true`, 409 `closed` with no account made and still pending; `CLOSED`; withdrawn; `GOING`; `closed: false`. The deadline-passed text, no Yes button, No works | I+E |
| T-RSVP-09 | v0.9: `run_rsvp_jobs()` with a past-deadline invitee, someone not invited, an accepted person, a late invite inside 48 h, an organizer's re-send in flight, an ended event; run twice | only the first withdrawn, its outbox cancelled, one `rsvp.expire` audit row with `{}` (not repeated); the link still opens, `closed` | I |
| T-RSVP-10 | v0.9: reminders with an injected time: 09:59, 10:00, 10:05, the next day, 17:00 on the deadline day; someone invited 2 h before; Yes with a reminder waiting; draining; Nov 1, 2026 (DST ends) at 14:00Z, 21:00Z, 15:00Z; a reminder still unsent 7 h later; an organizer's RSVP and Resend with a reminder waiting | none, one each, none, one each, none; skipped that day; the reminder cancelled and `pass_issued` queued; "Reminder: reply by…", a new working link, the old one dead, `rsvp_sent_at` unchanged; none, none, one; dropped, the link still works; the reminder replaced by the RSVP, the pass queued | I |
| T-RSVP-11 | v0.9: the RSVP email with a deadline, as a reminder, without a deadline, with HTML in names; the drainer with an unknown outbox kind | "Tue, Nov 3 · 11:59 PM EST" and what no reply means; the reminder subject; no deadline lines; escaped; cancelled, nothing sent, no pass | U |
| T-RSVP-12 | v0.9: the profile reminder at 09:59 and 10:00 EST two days before the event, run again; finished, unfinished and pending people; one finishing before the drain | one each for unfinished accepted people only, once; the email links `/me/profile` with no token; cancelled for the one who finished | I |
| T-RSVP-07 | The lookup; Yes with every field; the lookup again; `rsvp_respond(hash, true)` in SQL; No sent with form fields | prefill of the Sheet's dietary notes and LinkedIn, no email or emergency contact; everything stored with the answer, `linkedin_set_at` set (changed), `dietary_set_at` not (unchanged); still no contact; profile untouched; withdrawn, profile untouched | I |

### 14.17 Accounts — `T-AUTH`, `T-ME` (v0.4)
| ID | Scenario | Expected | L |
|----|----------|----------|---|
| T-AUTH-01 | Wrong password; right password; 10 wrong then the right one for another email; sign-in and set-password with JavaScript off | "Wrong email or password", no session; lands on `next`; refused with the same message; both work (forms posted before hydration carry a real Origin, so `Referrer-Policy` is `same-origin`) | E |
| T-AUTH-02 | "Forgot or never set your password?" for an account; an accepted participant without one (4 times); a staff invite; waitlisted, withdrawn and unknown emails | reset email → set password → new password works, old fails; 3 emails, not 4; invite; nothing sent, same message (`password_link_kind`: reset / invite / invite / none) | I+E |
| T-AUTH-03 | Organizer invites a new address; an existing account (v0.11.12: also a hacker whose RSVP Yes made one, as volunteer then organizer; two adds before the drain; removed before the drain; raw `staff_added` / pass rows with the wrong recipient columns); the auth server failing to send (stubbed); the staff-added email template with HTML in names. In the browser, that hacker follows the email | `{ code: 'INVITED', emailed: true }`, invite email → Continue → set password → display name → `/admin/<slug>`, invite consumed; `ADDED` with nothing from the auth server, a drain scheduled and one `staff_added` email with "Sign in" to `/login?next=/scan/<slug>`, then `/admin/<slug>`, audit `{role, result}` only; one row waiting; cancelled, no email; check violations; `emailed: false` and the page says the email didn't go out; escaped, one link, text part, under 60 KB. Sign in → display name → the scanner; `/me` shows the hacker menu and the Scanner link | U+I+E |
| T-AUTH-04 | `/auth/confirm` with a bad token; the same invite link twice; the emailed link | `/login?error=link` with the error text; the token is only in the fragment and never in a request URL | E |
| T-AUTH-05 | A signed-in user changes their account email to an accepted participant's address | not applied (needs the new address confirmed) | I |
| T-AUTH-03 | Also: invite as organizer, then re-invite the same (no password yet) address as volunteer | `ADDED` (v0.11.12: with the staff email, whose "Forgot or never set your password?" line covers the missing password), pending invite gone, role stays volunteer after sign-in | I |
| T-AUTH-06 | `isAdminEmail` with case and spaces, another address, an empty list, null; `ADMIN_EMAILS` parsing; sign-in landing for an admin account (one event as volunteer) and for another account | matches only the normalized address; a normalized list, empty when unset; organizer on every event (volunteer row upgraded), still sent to onboarding without a display name; no roles | U+I |
| T-ME-01 | `/me` for A with an old random pass; with a derived pass; accepted with no pass yet; waitlisted, withdrawn, past event; signed out | "in your email"; `/p#<token>` whose hash matches; "on its way"; nothing; redirect to `/login?next=/me` | I+E |
| T-ME-02 | `/me` as an organizer; as a volunteer | Admin and Scanner links to the event; Scanner only | E |
| T-ME-04 | `parseProfileInput`: trimmed fields; blank vs missing; name 1/100/101; phones `+1 (416) 555-0100`, `416.555.0100` vs `abc`, `12`, `+() --`, 31 chars; name without phone; relation 61; dietary 501; LinkedIn `/in/` vs `/company/`; the RSVP's required contact (v0.6) | normalized values; missing = unchanged, blank = clear; the first invalid field named, no throw | U |
| T-ME-05 | `saveBadgeProfile` as A (email in another case): blank dietary when there was none; dietary + contact; every field at its limit; relation cleared; a bad phone, a name only, 501 chars of dietary notes; B's id; Wd's own row; an event that ended 31 days ago (v0.6) | `dietary_set_at` unset; saved and set; accepted by the DB checks; null; `INVALID_CONTACT`/`INVALID_DIETARY`, nothing changed; `NOT_FOUND` ×3, nothing changed. Audit `profile.update` without name, phone or dietary text | I |
| T-ME-06 | `myEvent` as A (email in another case); C; Wd; a deleted participant; 32 days after the event (v0.6). A also accepted at a later event: both upcoming; the first under way; the first over; both over; the first past the 30-day window (v0.6.1) | the event with its schedule and emergency info and A's own fields; null for each of the rest. The earlier event; the earlier; the later; the later (most recent); the later | I |
| T-ME-07 | Signed out `/me/profile`; A taps their own badge → menu at `/me` (Hacker profile, Schedule, Emergency contact, My pass); sees "Finish setting up" on the profile item (v0.9); saves LinkedIn on the profile page, which has no dietary notes field (v0.8.2); reads the schedule; types a bad phone, then saves a contact; C opens `/me`, then `/me/profile` (v0.6.1) | login with `next`; the four items, "In your email"; saved, the Sheet's dietary notes kept; line breaks kept; the browser refuses the phone and keeps the typed name, then saved; "My events" without the menu, then 404 | E |
| T-ME-08 | `parseSchedule` (v0.8.2): day lines over `9:00-10:00 \| Title \| Place` lines with -, →, – or "to", no end, no place, extra `\|`; `1:00 PM`, `9:30am`, `2:15 p.m.`; slots before any day line; day lines in a row; free text, `25:00`, `9:60`, a blank title, no `\|`, 6,000 chars | sections in order with their slots; a null label first; joined labels; null for the rest, no throw | U |
| T-ME-11 | `scheduleTimeline`: real 23/6-slot poster, typed 24-hour/AM/PM/dotted times, midnight rollover and same-night starts, missing end, malformed times, empty day, overlapping intervals and touching endpoints, title categories including MLH Meetup; injected now/timezone before, during and after events, midnight, non-local timezone and outside event dates | minutes and rounded hour ranges; 30-minute default; bad starts preserved outside the grid, no throw; distinct lanes for overlaps and shared lane counts per connected group; poster categories; timezone-correct now line and past/current/upcoming state, grey past blocks and current ring | U |
| T-ME-09 | v0.9 `parseProfileInput` setup fields: every answer; blank allergies with a severity; at the limits; a bad or missing overnight or team status, a missing or bad severity, 301/501 chars, no contact (with `requireSetup`); a bad overnight without it | normalized values, allergies and severity cleared together; ok; the field named, no throw; missing answers unchanged outside setup | U |
| T-ME-10 | v0.9: profile setup as an attendee: each invalid answer; every answer; a Team-page opt-out then saving again; team status solo, then looking | the matching `INVALID_*`, nothing changed; saved, `profileDone`, listed in the directory; still not listed; not listed, then listed. Audit without PII | I |
| T-ME-03 | `saveBadgeProfile` as A (email in another case): `linkedin.com/in/ada-l` + share; `/company/x`; blank + hide; B's id; a malformed id (v0.10: the `myBadgeProfiles` half went with self-claim) | saved normalized; `INVALID_LINKEDIN`, nothing changed; cleared; `NOT_FOUND`, B unchanged; `NOT_FOUND`. Audit `profile.update` rows without PII | I |

### 14.18 Teams — `T-TEAM` (v0.7)
| ID | Scenario | Expected | L |
|----|----------|----------|---|
| T-TEAM-01 | 1,000 join codes; `normalizeJoinCode` with case, spaces, dashes, wrong length, `I`/`O`/`0`/`1`, a 2 KB string; `parseTeamName` (with a line break or tab); `parseTrackNames` with blank lines, repeats in another case, 100/101 chars, 21 lines | 8 chars without look-alikes, almost all distinct; normalized or null, no throw; trimmed 1–60, no control characters; trimmed, unique, in order, or null | U |
| T-TEAM-02 | Forming closed; open: blank name; another's row; create; again; a taken name in another case; join with a lowercase dashed code; again; unknown, malformed and E2 codes; C, Wd; track before release, E2's track, without a team, after release with forming closed; leave while closed; leave (two members); last leaves; after the event ends | `CLOSED`; `INVALID_NAME`; `NOT_FOUND`; `CREATED` with a valid code; `IN_A_TEAM`; `NAME_TAKEN`; `JOINED`; `IN_A_TEAM`; `BAD_CODE` ×3; `NOT_FOUND` ×2; `NOT_RELEASED`, `NOT_FOUND` ×2, `SAVED`; `CLOSED`; `LEFT` (team stays); `LEFT` (team deleted); `NOT_FOUND`. Audit `team.*` without names, codes or emails | I |
| T-TEAM-03 | 10 parallel joins into a 1-member team; a raw 5th-member update; the last member leaving while someone joins, 30 rounds | 3 `JOINED` + 7 `TEAM_FULL`, 4 members; check violation; never a `JOINED` member of a deleted team (`BAD_CODE` and no team instead) | I |
| T-TEAM-04 | Admin API: GET; switches; add tracks with repeats, again with an existing one in another case, blank; rename to a taken name; create a team with a track, a taken name, a blank name; rename + change track; 4 members, a 5th, E2's participant, E2's team; another event's team through this slug; remove a member; delete a track; tombstone a member; delete the team, twice | the switches, tracks, teams and unassigned accepted people; saved and audited; 201, `{added: 1}`, 400; 409; 201 with a code, 409, 400; 200; 200 ×4, 409, 404, 404; 404; 200; the team's track null; the tombstone has no team; members moved out, 404. Audit without names or codes | I |
| T-TEAM-05 | Directory opt-in; invite someone not looking, again, another event; drain; accept, decline, full team, no invite, closed forming; join by code or organizer; answer before drain; tombstone; RSVP Yes opt-in; self-exclusion with and without a team; direct SQL self-invites; teamed RSVP Yes and same-team updates; same-name rows with different emails; forged caller | Own accepted rows only, names only, same event; directory always excludes the viewer by participant id; same-name rows remain distinct; forged caller returns `NOT_FOUND`; self-invites return `SELF` without invite, email or audit writes; teamed looking flag stays false; `NOT_LOOKING`, `INVITED`, `ALREADY_INVITED`; one invite email, no code or pass; consent, 4-member limit, invite cleanup; cancelled email after answer; flag stored with Yes. Audit without PII | I |
| T-TEAM-06 | Invite template with HTML in team and inviter names | Escaped, exact `/me/team` link, plain text, no join code, HTML under 60 KB | U |
| T-TEAM-07 | Organizer creates tracks through the API; A opens Team before forming opens; organizer opens it; A creates a team; B joins with the code in lowercase; organizer releases tracks; A picks one; the admin page; N opts into the directory, A invites N, N reads the email and accepts | "Teams open on hackathon day", no forms; created, code shown, "Tracks are announced at the hackathon"; B sees the team and Ada; track saved; the team card shows Ada, Ben and the track; directory shows Nia, email links to `/me/team`, N accepts and both see the team | E |

---

### 14.19 Hacker directory — `T-DIR`

| ID | Scenario | Expected | L |
|----|----------|----------|---|
| T-DIR-01 | Profile parser: missing, blank, lengths, CRLF, pace choices, HTML-like text | Missing unchanged, blank clears, bio ≤280, enum pace, text preserved | U |
| T-DIR-02 | Full/Looking directory: other event, non-consenting, waitlisted, withdrawn, tombstoned targets; safe field list | Full consent only; Looking adds names only; no private fields | I |
| T-DIR-03 | Waitlisted/withdrawn/unknown viewer, forged event | No directory access; myEvent returns null | I |
| T-DIR-04 | Own-row save, constraints, partial/blank save, audit, tombstone | Defaults on (v0.11.19); own only; no PII audit; tombstone clears all three fields | I |
| T-DIR-05 | Walkthrough networking opt-in → menu → directory → filters and contact → profile opt-out | Self has no actions, normalized search, pace/Looking filters, LinkedIn/website and Discord Copy; escaped bio; no private data in HTML; responsive | E |
| T-DIR-06 | Signed-out, waitlisted and withdrawn viewers open /me/hackers | Login / 404 respectively | E |

### 14.20 Look — `T-UI`

| ID | Scenario | Expected | L |
|----|----------|----------|---|
| T-UI-01 | Every visible text and form control on the signed-out pages (login, RSVP, pass, auth confirm, badge profile, 404), a real invitation from the email (`/rsvp#token`: the choice, the password step, You're in, No) and a real pass page, the hacker menu pages and the admin and scanner pages | computed font is Fira Code | E |

## 15. Non-functional requirements

- **Latency:** `/api/scan` p95 under 700 ms server-side. The Vercel function region MUST be co-located with the Supabase region.
- **Capacity:** 5 concurrent scanners and a 300-person peak arrival within 10 minutes.
- **Rate limits** (Postgres-backed `rate_limits`; never in-memory, because serverless instances do not share memory):

  | Scope | Limit |
  |-------|-------|
  | Scans per staff | 120 / min |
  | `NOT_FOUND` per staff | 30 / 5 min → 429 + alert |
  | `/api/pass` per IP | 30 / min |
  | `/api/rsvp` per IP | 30 / min |
  | Password sign-ins per email | 10 / 15 min (then refused like a wrong password) |
  | RSVP Yes password checks per email (v0.7.2; its own bucket) | 10 / 15 min (then refused like a wrong password) |
  | "Forgot or never set your password?" emails per address | 3 / h (over the limit looks the same) |
- **Browsers:** iOS Safari (current and previous major version) and Chrome for Android (last two versions). Desktop Chrome, Safari and Firefox for admin. NFC features (badge scanning, linking badges, the Tools page) need Chrome on Android and are hidden elsewhere. Opening a badge's profile works on any phone: it only opens the badge's URL.
- **Typeface (v0.11.24):** Fira Code everywhere, like sheridandatathon.com: every page, form control and email (emails fall back to a system monospace where mail apps block web fonts). No second typeface (T-UI-01).
- **Accessibility:**
  - WCAG 2.1 AA contrast,
  - status never conveyed by color alone,
  - tap targets at least 44×44 px,
  - the scanner is usable one-handed.
- **Privacy:**
  - The Google Form MUST include a collection notice covering what is collected, why (event admission, food, attendance analytics), who sees it (club organizers and volunteers), and retention.
  - Follow the college's student-organization data policies.
  - Retention: existing photos, dietary notes, emergency contacts (v0.6), allergies and accessibility needs (v0.9) are deleted 30 days after the event; participant PII 12 months after; aggregate stats are kept.
  - The Hacker directory (F16) is private to accepted attendees of the selected event, **on by default** (v0.11.19; attendees switch it off on their profile), with consent independent of public badge sharing. It shows name, pace, bio, actual team status and chosen networking links only. Looking without full consent remains names only under its filter. Bio, pace and directory consent follow participant PII retention (12 months); they are cleared immediately by the tombstone. Directory access ends 30 days after the event.
  - Deletion requests are handled through the admin tombstone.
  - The badge profile (v0.9) is public and on by default; participants switch it off or on on their pass page or `/me/profile`, where they can also set their LinkedIn (v0.5). Anyone who taps their badge sees only their name and the links they set: LinkedIn, Discord username and website (v0.9.2). The Google Form's notice should say so.
- **Logging:**
  - Structured JSON logs.
  - Allowed fields: `participant_id`, `event_id`, `checkpoint_id`, `result_code`, `latency_ms`.
  - Never names, emails, tokens, dietary notes, emergency contacts or photos.

---

## 16. Event-day runbook

**T − 7 days**
- Full dry run with 10 club members as fake participants on the production deployment, with `is_test = true`.
- Run T-DEV and T-MAIL-12.
- Confirm SPF/DKIM pass: check "Show original" in Gmail.

**T − 1 day**
- Create checkpoints, all closed.
- Send RSVPs to the chosen applicants well before this (Participants page), with the **RSVP deadline** set on the Info page (v0.9); check the outbox for failures and that the scheduler's `/api/cron` runs succeed.
- Invite staff; every volunteer sets their password from the invite email on their own phone and runs a test scan.
- Export and **print the accepted roster** (name, checkbox per checkpoint) as the offline fallback.
- If using badges: staff link each attendee's badge at check-in (Participants page, or Manual search in the scanner, on an Android phone); the same tap writes its profile link when missing. Check one opens `/profile/<uid>` on an iPhone. If the write fails, hold the badge still and tap Link badge again.
- Check the dashboard: outbox has 0 failed and 0 pending.
- Charge phones and bring battery packs.

**Doors (T − 30 min)**
- Open the door checkpoint.
- Each station scans a test pass and confirms the dashboard counter moves.
- Void the test scans.

**During**

| Situation | Action |
|-----------|--------|
| Code won't scan | Manual search → Record scan |
| `NOT_FOUND` | Manual search by name; check for an email typo in the Sheet; organizer adds a walk-in if they're legit |
| UNKNOWN BADGE | Scan their QR (or manual search). Then link the badge: Manual search → their name → **Link badge** → tap the badge (Android) |
| `REVOKED` + reissued | Ask them to open their **newest** email; organizer can resend on the spot |
| `ALREADY_SCANNED` by someone else | Escalate to an organizer |
| `WRONG_EVENT` | Organizer decides |
| Network down | Switch to the paper roster; after recovery, an organizer enters paper check-ins through manual scan |
| Wrong checkpoint used by a volunteer | Volunteer voids within 120 s; otherwise an organizer voids with reason "Wrong checkpoint" |

**After**
- Close all checkpoints.
- Export CSVs.
- Put the retention date in the calendar.
- Run the post-event review: `scan_attempts` problems grouped by code.

---

## 17. Assumptions to verify (before or during the relevant slice)

| # | Assumption | If false |
|---|-----------|----------|
| A1 | Resend supports inline (`cid:`) attachments and an idempotency-key header | Attach the QR as a regular PNG and rely on the outbox for dedupe |
| A2 | Installable `onEdit` fires once for a multi-cell paste with the full range, and does not fire for script/API edits | Adjust the script; Sync now remains the backstop |
| A3 | Obsolete in v0.11 with participant photos | — |
| A4 | Screen Wake Lock API available on target iOS/Android versions | Instruct volunteers to extend auto-lock |
| A5 | Vercel plan limits (function duration, cron frequency) and Supabase `pg_cron` + `pg_net` availability fit the F4 drain | Pick whichever scheduler is available; the `after()` + button path still works. **Checked (2026-10-26):** the cloud DB has no pg_cron. **v0.10.1 (2026-10-27):** the app moved from Coolify to Vercel Pro, which allows a cron every 5 minutes; `vercel.json` schedules `/api/cron` every 5 minutes and `/api/retention` daily, functions run in `pdx1` next to the Supabase project (`us-west-2`). |
| A6 | The provider's rate limit handles bursts of about 300 sends | Throttle the drain batch size |
| A7 | Scanner library choice: compare html5-qrcode, nimiq `qr-scanner` and `@zxing/browser` on iOS reliability, bundle size and maintenance activity | Swap behind the `QrScanner` interface |
| A8 | `Utilities.computeHmacSha256Signature(value, key, Utilities.Charset.UTF_8)` output matches Node's HMAC for non-ASCII bodies | T-ING-05 catches it; fix encoding on one side |
| A9 | Supabase region near Toronto | Choose the nearest and co-locate the Vercel functions |
| A10 | Chrome on Android gives a `serialNumber` for our tags (NTAG21x) and doesn't open the tag's URL while the page is scanning | Ask volunteers to keep the scanner tab in front; consider tags without a URL record for staff-only use **Checked on a real phone (2026-10-20):** the serial is there, but reads only arrived with the camera off, hence the one-input-at-a-time switch (§10.1). |
| A11 | Web NFC needs no Permissions-Policy token (only the `nfc` permission) | Add `nfc=(self)` to `Permissions-Policy` and update T-SEC-06 |

---

## 18. Build plan (vertical slices)

Each slice ends with its tests green in CI and a short demo.

| Slice | Scope | Exit criteria |
|-------|-------|---------------|
| **S0** Tooling | Next.js TS strict, pnpm, ESLint, Vitest, Playwright, Supabase local, `.env.example`, GitHub Actions (lint, typecheck, unit, integration with `supabase start`) | CI green on an empty app |
| **S1** Core DB | §5 schema, `issue_pass`, `record_scan`, `void_scan`, deny-all RLS, fixtures | T-SCAN-*, T-CONC-*, T-SEC-01/02/07/08 |
| **S2** Passes & email | tokens, QR render, outbox, drainer, console mailer, templates | T-TOK-*, T-MAIL-01..11 |
| **S3** Sheet bridge | ingest endpoint, transitions, Apps Script, Sync now | T-ING-*, T-GAS-* |
| **S4** Pass page | `/p`, `/api/pass` | T-PASS-* |
| **S5** Scanner | staff auth + invites, `/scan`, result UI, manual search, undo | T-SCUI-*, T-SRCH-*, T-SEC-04 |
| **S6** Admin | dashboard, participants, checkpoints, staff, export | T-ADM-*, T-ANA-* |
| **S7** Hardening | headers, rate limits, retention, load test, device matrix, dry run | T-SEC-03/05/06, T-PRIV-*, T-PERF-*, T-DEV, T-MAIL-12 |
| **S9** Accounts & RSVP | Password sign-in, invite and reset links, RSVP (F13), `/me` with derived tokens, import-only Sheet; admin emails and staff links on `/me` (v0.4.1) | T-AUTH-01..06, T-RSVP-01..05, T-ME-01..02, T-TOK-10, rewritten T-ING |
| **S10** Hacker menu (v0.6) | `/me` menu (own badge tap; no slug since v0.6.1), Hacker profile with dietary notes, Schedule and Emergency contact pages, admin Info tab, emergency contact on the RSVP Yes form and participant detail; tombstone, retention, Sheet rule | T-ME-04..07, T-NFC-22, T-ING-27, T-RSVP-06..07, T-ADM-08 |
| **S11** Teams (v0.7) | S11a: tracks, teams, the forming and release switches, the hacker Team page (create, join by code, leave, pick a track) and the admin Teams page. S11b: teammate directory, invites with email, the RSVP opt-in | T-TEAM-01..04, T-TEAM-07 (S11a); T-TEAM-05..07 (S11b) |
| **S12** RSVP deadline & profile setup (v0.9) | A: RSVP deadline, auto-no, reminders, `/api/cron` and the Coolify scheduler. B: profile setup (overnight, allergies, team status, accessibility), the "you're in" email links, the profile reminder, allergies on meal scans. C: public badge profiles, sharing on by default | A: T-RSVP-08..11, T-CONC-08; B: T-ME-09..10, T-RSVP-12; C: T-NFC-24 (+ rewritten T-NFC-12/14, T-RSVP-06) |
| **S13** Hacker directory | F16 private event directory, profile networking consent/bio/pace, RSVP walkthrough step 4, moved teammate discovery and invites, tombstone and I-6 grants | T-DIR-01..06, T-TEAM-05/07, T-SEC-08 |
| **S8** NFC badges | N1 badges table + `record_badge_scan` + link API · N2 scanner NFC · N3 badge profile + opt-in · N4 tag writer · N5 (v0.5) self-claimed badges, LinkedIn on `/me`, Tools linker · N6 (v0.10) staff link from Participants and Manual search, organizer unlink, no self-claim | T-NFC-01..29, T-ME-03, T-ING-26 (+ T-NFC-17 manual) |

---

## 19. Environment variables

| Name | Where | Notes |
|------|-------|-------|
| `NEXT_PUBLIC_APP_ORIGIN` | client+server | e.g. `https://station.sheridandatathon.com`; used in QR payload + parser |
| `NEXT_PUBLIC_SUPABASE_URL` | client+server | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client | Auth only; tables are deny-all |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Never imported from client code |
| `SHEET_INGEST_SECRET` | server + Apps Script property | ≥ 32 random bytes |
| `DRAIN_SECRET` | server + scheduler | |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | server | Sync now (read-only Sheets scope) |
| `EMAIL_PROVIDER` | server | `console` \| `resend` |
| `DEV_PUBLIC_HOST` | `next.config.ts`, dev only | Optional stable tunnel host, added to `allowedDevOrigins` so a phone can open pages through it |
| `RESEND_API_KEY`, `EMAIL_FROM` | server | |
| `ADMIN_EMAILS` | server only | Optional, comma-separated. These accounts are organizer on every event (F9). Keep it short: whoever controls one of these mailboxes is organizer everywhere. |
| `PASS_TOKEN_SECRET` | server only | ≥ 32 random bytes. Pass tokens are derived from it (§6.1). Changing it hides older passes on `/me`; scanning is unaffected. |
| `BADGE_ORIGIN` | server | Optional. Origin written onto badge tags (§6.5); defaults to `NEXT_PUBLIC_APP_ORIGIN`. Must be `https://` for the writer to write. |

---

## 20. Changelog

- **v0.11.24 (2026-10-31)** — One typeface everywhere (owner's request): Geist is gone, Tailwind's sans font is Fira Code, and form controls inherit it instead of the system font, so login, RSVP, emergency contact and every other page match the schedule and the site. §15; new T-UI-01.

- **v0.11.23 (2026-10-31)** — The RSVP email's subject is `You're invited: {Event name}`, without “— will you be there?” (owner's request); every email calls the datathon by its full name, “Sheridan Datathon 2026” (`emailEventName()` in `lib/email/links.ts`), so it reads “You're invited: Sheridan Datathon 2026”, while the app keeps the event name “Datathon”. Emails come from “Sheridan Datathon” (the `EMAIL_FROM` display name). §12; T-RSVP-11 updated.

- **v0.11.22 (2026-10-31)** — **Import CSV** on a **Tools** tab, back in the admin header (owner’s request): organizers import applicants from a CSV export of the Sheet, with a preview (dry run) before anything is written. It reuses Sync now’s upsert (F10) through `POST /api/admin/:slug/sync` with a new optional `csv` field, so no Google service account is needed; optional Accepted/Waitlisted checkboxes filter Sheet Status rows, refresh the preview and report skipped rows without changing participant status. F3, F10, §11; new T-ING-28 (U+I+E); T-NFC-28 now finds Tools without badge writing or linking, instead of a 404.

- **v0.11.21 (2026-10-30)** — The app is renamed from Passline to **Station** (Sheridan Datathon Station, owner's request) in the docs, Apps Script, package and local Supabase project names. The Sheet ingest headers become `X-Station-Timestamp` / `X-Station-Signature`; the `X-Passline-*` names are still accepted, so pasted scripts keep working (§9.2). Scanner preferences move to `station:` keys and still read the old `passline:` ones (§10.1). Applied migrations keep their internal `passline:badge_link` lock name (never edit an applied migration). T-ING-01 also checks the old headers. Also: Photo Booth is drawn from 1 PM over Sponsor Station (F14); each card's text sits at its top; the schedule uses the site's dark surface at every width (event cards keep the poster colours), and below 1024px it fits the screen (44px time column, columns from 240px), and cards narrower than 8.5rem drop the redundant "Workshop:"/"Talk:" prefix and subtitle and shorten the time ("2:30–3:30 PM"); and the schedule dialog's title is dark on its light background (it inherited the dark theme's light heading colour). T-ME-11 updated.

- **v0.11.20 (2026-10-31)** — Every email (RSVP invite and reminder, pass, profile reminder, team invite, staff added) takes the Hacker Package look (owner's request): a navy hero with the SD badge, SHERIDAN DATATHON and a title, then a white card on the package's light blue page, Google Sans with system fallbacks, square full-weight call-to-action buttons and a pale When/Where box. v0.11.21 (owner's request): the emails follow the website instead: navy page, dark card, Fira Code (system monospace where mail apps block web fonts), terminal-green buttons and light-blue links, declared `color-scheme: dark`; the QR keeps its opaque white card. The schedule and its event dialog also use the site's Fira Code and dark popover instead of Google Sans and a light dialog. Buttons carry a thin outer ring; every email, HTML and plain text, ends "Waving from orbit, Atom and the Sheridan Datathon team", and in the HTML Atom, the datathon's astronaut, waves beside it in the bottom-left corner (`public/email-atom.png`, linked like the logo, not attached). Light colour scheme; the QR stays on an opaque white card (§6.2). Wording unchanged. §12; T-AUTH-03 (U) checks the new hero title.

- **v0.11.19 (2026-10-31)** — Owner's requests. Hacker directory listing is on by default (migration `20261031014344_directory_on_by_default`: new default, and switched on for people who never saved the networking form; anyone who did keeps their choice). The networking form is ordered LinkedIn, Discord, website, bio, pace, then directory listing and badge sharing, without the explanatory copy. Schedule: the busier day gets a wider column, and each event opens a detail dialog instead of the hover card. F14, F16, §5.7, §15; T-ME-11, T-DIR-02/04/05 and T-TEAM-05 updated.

- **v0.11.18 (2026-10-30)** — Hacker profile moves to the end of the hacker menu, and its tabs are ordered Networking, The event, Health and access (owner’s request). The RSVP walkthrough order is unchanged. F14; T-ME-07/10 updated.

- **v0.11.17 (2026-10-30)** — Hacker menu order is Hackers, Schedule, Team, Hacker profile, Emergency contact (owner’s request). The emergency contact leaves the Hacker profile (tabs and RSVP walkthrough, now 3 steps) and is set only on the Emergency contact page; it stays required, so the profile links there while it is missing. Profile setup no longer requires the contact (`parseProfileInput`). F14; T-ME-07/09/10, T-RSVP-05 and T-DIR-05 updated.

- **v0.11.16 (2026-10-30)** — The hacker Schedule matches the Hacker Package poster: category columns instead of side-by-side overlap lanes, free-standing slots span the day, and overlaps stack on top of each other; Team formation counts as Hacking (it sits in the Hacking Begins block on the poster). F14; T-ME-11 updated.

- **v0.11.15 (2026-10-30)** — The app moves to `https://station.sheridandatathon.com` (owner’s request). `nfc.yvesdonato.com` stays on the Vercel project as a permanent (308) redirect, so links already emailed (RSVP, pass, sign-in) and badge tags already written keep working; browsers keep the `#token` fragment across the redirect. The scanner still accepts QR codes for the old origin (§6.4). New badge links and emails use the new origin through `NEXT_PUBLIC_APP_ORIGIN`. T-TOK-02 extended.

- **v0.11.14 (2026-10-30)** — Split the full Hacker profile into Emergency contact, The event, Health and access, and Networking tabs, each saving only its own fields (owner’s request). Server-rendered links work without JavaScript; unfinished required sections are marked, and saves and validation errors return to their section. The RSVP guided walkthrough is unchanged. F14; T-ME-07/10, T-NFC-21/26 and T-DIR-05.

- **v0.11.13 (2026-10-30)** — Add the private, opt-in Hacker directory at `/me/hackers`, with bio, pace, networking contacts and name/Looking/pace filters. Consent and fields appear in RSVP onboarding step 4 and the full profile networking form. Move teammate discovery here, preserving names-only Looking consent and invite rules; Team keeps team management, received invites and its preference/link. New migration `20261030060236_hacker_directory`; own-row profile saves, tombstone and service-role-only directory query. §3, §5.1/5.7, F14–F16, §9.3, §14.19, §15, S13. T-DIR-01..06; T-TEAM-05/07 and T-SEC-08 updated.

- **v0.11.12 (2026-10-30)** — Staff said they never got an email when added: an organizer adding someone who already has an account (often a hacker whose RSVP Yes made one) added them silently. They now get a "You’re now a volunteer/organizer for {Event}" email with a Sign in link to their scanner or admin pages, queued by `invite_staff()` as a new `staff_added` outbox kind (`email_outbox.participant_id` is now optional; new `event_id`, `user_id`, a recipient check, one waiting per account and event; `staff_email_target()`), drained after the response. The Staff page says when the auth server couldn't send an invite instead of reporting success. Migration `20261030054932_staff_added_email`. F9, §12; T-AUTH-03 extended (U+I+E).
- **v0.11.11 (2026-10-30)** — Remove the Schedule and Emergency information blocks from admin Info (owner’s decision); the page keeps only RSVP deadline. Schedule and emergency info remain writable through `PATCH /api/admin/:slug/event`, with stored content still shown on the unchanged hacker pages. §11; T-ADM-08 browser coverage uses the API for that text.

- **v0.11.10 (2026-10-30)** — Harden self-exclusion on the Team page: never render the viewer’s own directory row or Invite button; SQL explicitly refuses self-invites with `SELF`. Keep teamed hackers’ looking flag off after RSVP and same-team updates. F15; T-TEAM-05, T-TEAM-07, T-SEC-08.
- **v0.11.9 (2026-10-30)** — The schedule is back on its own page (`/me/schedule`); the menu's Schedule item opens it again and the menu no longer shows the calendar (owner's decision, reverting v0.11.8). F14.
- **v0.11.8 (2026-10-30)** — The hacker menu (/me) shows the schedule calendar right below the menu items; the Schedule item jumps to it (owner's decision). F14.

- **v0.11.7 (2026-10-30)** — The admin Sync page and its tab are removed (owner's decision); `POST /api/admin/:slug/sync` and the Sync now logic stay (F10, T-ING-25). §11, F3, F10.
- **v0.11.6 (2026-10-30)** — The guided profile walkthrough is only for the RSVP's onboarding (`?setup=1` from "Set up my hacker profile"); from the menu or the reminder, the profile page shows every section at once, as before (owner's decision). F14.
- **v0.11.5 (2026-10-30)** — The hacker Schedule is a calendar grid like the official poster: hour axis, side-by-side overlaps, categories (Hacking, Activities, Workshops, Food, Sponsors) inferred from titles, with a legend. F14; new T-ME-11.

- **v0.11.4 (2026-10-29)** — Link badge also writes the badge's profile link when missing; the Tools page is gone (owner's decision). §3, §6.5, §10.4, §11, §16; T-NFC-16 retired, T-NFC-28/29 extended.
- **v0.11.3 (2026-10-29)** — Profile setup is a guided walkthrough while unfinished (owner's decision): emergency contact, the event, health and access, then networking (optional). F14.

- **v0.11.2 (2026-10-29)** — Shorter emails (owner's decision): the pass email drops its tips (brightness, screenshots, personal code) and the RSVP email and reminder drop the line on what Yes leads to; and no email says "just reply" any more, because they come from a no-reply address. §12, T-TEAM-06.
- **v0.11.1 (2026-10-29)** — The admin Teams page no longer has the "Add tracks, one per line" box (owner's decision): tracks are created through `POST /api/admin/:slug/tracks`; rename and delete stay on the page. §11, F15; T-TEAM-07 creates its tracks through the API.
- **v0.11 (2026-10-29)** — Participant photos removed from the pass page, upload API, scanner results and manual search, participant admin/detail/CSV and emails (§3, §4, F5, §6.5, §9.1, §9.3, §10.2, §10.4, §11, §12, §15, §16, §18). Database columns and SQL functions remain unchanged (§5, §8); the private bucket, retention and tombstone cleanup still delete existing uploads. A3 is obsolete (§17). Tests (§14): T-PASS-04..10 retired; T-PASS-01/03, T-SCAN-01, T-SCUI-03/12, T-SRCH-07, T-ADM-05, T-ANA-04, T-SEC-04/06, admin response contracts and fixtures updated; photo-only processing/unit and upload/e2e cases removed. T-PRIV-01 and the T-NFC-12 no-photo contract remain.
- **v0.1 (2026-09-23)** — Initial draft.
- **v0.3 (2026-10-16)** — NFC badges merged in from the datathon-badges app (G6, §5.2, §6.5, §8 note, §9, §10.5, §11, T-NFC-*, S8, `BADGE_ORIGIN`): badge check-in through `record_badge_scan()`, staff-linked badges per event, opt-in badge profile at `/profile/<uid>`, and a tag writer. Activity tap counts map onto checkpoints (once per participant). Not carried over: tap-to-sign-in, self-claimed profiles, unlimited tap counters. Badge profiles require a signed-in attendee or staff account of the same event (T-NFC-12/14/18); onboarding is staff-only.
- **v0.4 (2026-10-16)** — Accounts and RSVP. The Sheet only imports applicants (F3; `REVOKED`/`IGNORED_CLEAR` removed); organizers send RSVPs and a Yes accepts (F13, new `rsvp` outbox kind). Email + password sign-in replaces magic links; invite and reset links go through `/auth/confirm` and `/set-password`; no public sign-up (F9). Pass tokens are derived from `PASS_TOKEN_SECRET` and the pass id so `/me` can show them (§6.1, DECISION). New tests T-TOK-10, T-RSVP-01..05, T-AUTH-01..04, T-ME-01; T-ING rewritten; S9.
- **v0.5 (2026-10-19)** — Self-claimed badges, reversing a v0.3 DECISION: a signed-in attendee taps an unlinked badge and presses **This is my badge** (`claim_badge()`), then sets their LinkedIn and sharing on `/me` (`save_badge_profile()`, `normalizeLinkedIn()`); the Sheet stops overwriting a LinkedIn they set (`linkedin_set_at`, F3). The scanner's door "Link badge" is gone; organizers link badges on the admin **Tools** page (formerly Badges, which keeps the tag writer). §2, §3, §5.2, §6.5, F3, §9.3, §10.2, §10.5, §11, §15, §16, S8. New tests T-NFC-19..21, T-ME-03, T-ING-26; T-NFC-11 and T-NFC-16 rewritten for Tools.
- **v0.6 (2026-10-19)** — Hacker menu (F14, S10). Tapping your own badge opens `/me/<slug>` (`badge_profile` adds `self`, `slug`): Hacker profile (LinkedIn, sharing, and now dietary notes), Schedule and Emergency contact (the event's info and your own contact), and My pass. The RSVP Yes form requires an emergency contact and offers the networking profile and dietary notes, prefilled from the Sheet, all stored with the answer (`rsvp_respond` gains optional fields; `rsvp_lookup` returns the prefill). Organizers write the schedule and emergency info on a new admin **Info** tab and see the emergency contact on the participant detail. The Sheet stops overwriting dietary notes the attendee set (`dietary_set_at`); set-at timestamps move only on a real change. The emergency contact is deleted by the tombstone and by retention, and never logged. §2, §3, §5.1, §5.4, §6.5, F3, F13, F14, §9.3, §11, §12, §15, §18. New tests T-ME-04..07, T-NFC-22, T-ING-27, T-RSVP-06..07, T-ADM-08; T-ADM-05, T-PRIV-01, T-RSVP-05, T-NFC-21 and T-SEC-05/T-PRIV-03 updated.
- **v0.6.1 (2026-10-19)** — The hacker menu drops the event slug: `/me` is the menu for your event (the next one not yet over, else the most recent; DECISION), with `/me/profile`, `/me/schedule` and `/me/emergency`, and keeps the staff links. The pass list and its Menu button are gone (**My pass** replaces them). Your own badge and "This is my badge" open `/me` and `/me/profile`. §2, §3, §6.5, F14, §9.3; T-ME-06/07, T-NFC-21/22, T-RSVP-05 updated.
- **v0.7 (2026-10-20)** — Teams and tracks (F15, S11a). Organizers type an event's tracks, open team forming and release the tracks on a new admin **Teams** page, and can edit any team. Accepted hackers create a team or join one with its join code (not a secret, DECISION) from a **Team** item in their menu, up to 4 per team (DECISION, enforced by a trigger), and pick one track once released. The tombstone takes people out of their team. §2, §3, §5.1, §5.5, F15, §9.3, §11, §14.18, §18. New tests T-TEAM-01..04, T-TEAM-07. S11b adds the opt-in name-only teammate directory, consent-based invites and their email, invite cleanup on joining or tombstoning, and the RSVP directory checkbox. §5.5, F13, F15, §9.3, §12, §14.18, §18. New tests T-TEAM-05..06; T-TEAM-07 extended.
- **v0.7.1 (2026-10-20)** — The Participants page's **Add walk-in** becomes **Add attendee**, with a **Not RSVPed yet** box that adds a pending applicant (sent nothing) so organizers can send them an RSVP, e.g. to test the RSVP email (F12, §3, §11). `add_walk_in()` gains `p_not_rsvped` (default false). New test T-ADM-09.
- **v0.7.2 (2026-10-20)** — The RSVP Yes form always requires a password: people without an account set one, people with an account enter theirs (checked like a sign-in with its own per-email limit; 400 `wrong_password`), and both end up signed in with `/login`'s post-sign-in steps. An RSVP still never changes an existing password. `/api/rsvp` takes JSON bodies only (no cross-site form posts). F13, §9.3, §15; T-RSVP-04 rewritten (I+E).
- **v0.7.3 (2026-10-20)** — The scanner taps twice (a pattern no result uses) the moment it reads a badge, before the answer, so volunteers know the tap registered; unreadable tags get the amber pulse, and until the page has been tapped once (Chrome's rule for vibration) the scanner says so (§10.5). T-NFC-10 extended.
- **v0.7.4 (2026-10-20)** — Fix: on a real Android phone, badge taps on the scanner did nothing. The page didn't hold its `NDEFReader`, so Chrome collected it while keeping the NFC session. The hook now keeps the active reader, and an exception in the read handler shows a notice instead of failing silently (§10.5). T-NFC-10 gains a garbage-collection case; the e2e fake now holds readers weakly. The dashboard no longer shows the Scan problems table (§13).
- **v0.8 (2026-10-20)** — Who was scanned at each checkpoint: Admin → Checkpoints → **People**, and **Scanned here** in the scanner, with **Remove** (a void, F11: organizers any scan, volunteers their own within 120 s). New staff endpoint `GET /api/events/:slug/checkpoints/:id/scans` (§3, §9.3, §10.6, §11). New tests T-SCAN-30, T-SCUI-14, T-ADM-10.
- **v0.8.2 (2026-10-23)** — Dietary notes leave the attendee forms (Hacker profile and RSVP Yes): they come from the Sheet and only staff see them (DECISION, F14); the forms send no key, so saving keeps the stored notes. The hacker Schedule page shows `9:00-10:00 | Title | Place` lines as time slots under day headings (F14, §11 Info). §3, F13, F14, §11; T-ME-07 and T-RSVP-05 updated, new T-ME-08.
- **v0.10.1 (2026-10-27)** — Hosting moves from Coolify to Vercel (project `passline`, functions in `pdx1` next to Supabase `us-west-2`); `nfc.yvesdonato.com` points at it. Vercel Cron Jobs in `vercel.json` replace the planned Coolify tasks (`scripts/cron.mjs` removed): `/api/cron` every 5 minutes and `/api/retention` daily, called with `GET` and `Bearer $CRON_SECRET` (= `DRAIN_SECRET`). F4, §9.3, A5.
- **v0.10 (2026-10-27)** — **Staff link badges** (DECISION, reverses v0.5): attendees no longer claim their own badge (`claim_badge()` dropped; an unlinked badge's page points to the check-in desk). Organizers link from a **Link badge** button on the Participants page and volunteers from **Link badge** in the scanner's Manual search, by tapping the badge on an Android phone; both lists show "Badge linked". Organizers can **Unlink badge** (`unlink_badge()`, audit `badge.unlink`). Chips are never locked. The Tools page keeps only the tag writer. §2, §3, §6.5, §9.3, §10.4, §10.5, §11, §14, §15, §16, §18; new tests T-NFC-27..29; T-NFC-11 and T-NFC-20 retired; T-NFC-14, T-NFC-16, T-NFC-21 rewritten.
- **v0.9.2 (2026-10-27)** — Hackers can add an optional **Discord username** and **website** to their profile on `/me/profile` (one **Save links** form with LinkedIn). The public badge profile shows them while sharing is on: the Discord name with a Copy button, the website as a link labelled with its address. Each networking field checks its rule in the browser too, so a typo never reloads the form. New columns `discord_username` and `website_url` with database checks; `save_hacker_profile()`, `badge_profile()` and the tombstone (`delete_participant()`) cover them. §2, §3, §5.1, §5.2, §6.5, F14, §15; new tests T-NFC-25, T-NFC-26; T-NFC-21 extended.
- **v0.9.1 (2026-10-26)** — **Revoke RSVP** on the Participants page (§3, §11). Organizers put someone back to "not RSVPed yet", e.g. after a test. Their link stops working, any pass is cancelled and the badge unlinked, and a new RSVP can go out. Implemented as `revoke_rsvp()`. New test T-ADM-11.
- **v0.9 (2026-10-26)** — RSVP deadline, profile setup and public badges (S12).
  - **RSVP deadline (F13):** organizers set the deadline on the Info page (`events.rsvp_deadline`). An invitation closes at the deadline, or 48 h after it was sent if that's later. After that Yes is refused, and no reply counts as a no: `run_rsvp_jobs()` withdraws them. Reminders go out at 10:00 local on the deadline day and the two days before. The RSVP email shows the reply-by time. The buttons read "Yes, I'm coming" and "No, give my spot away", and organizers send the next RSVPs themselves (DECISION).
  - **Scheduler (F4, A5):** a Coolify task POSTs `/api/cron` every 5 minutes; it runs the RSVP jobs and drains the outbox. A second task runs retention daily. Neither had run in production before.
  - **Profile setup (F14):** the RSVP Yes now asks only for a password. The emergency contact, overnight stay, team status (which feeds the directory opt-in), allergies with severity and accessibility needs move to profile setup on `/me/profile`, where hackers land after Yes. A reminder goes out two days before the event to those who haven't finished. Allergies show on accepted meal scans. Organizers see the answers on the participant detail and in the participants CSV. The tombstone and retention delete them (§5.6).
  - **"You're in" email (§12):** adds the profile setup button and links to the Discord, the hacker package and the Google Group.
  - **Public badge profiles (§6.5):** reverses the v0.3 DECISION. There is no sign-in to view, and sharing is on by default; the backfill only covers people who never saw the choice.
  - **Sections:** §2, §3, §5.1, §5.2, §5.6, §6.5, F4, F13, F14, F15, §9, §10.2, §11, §12, §14, §15, §16, §17, §18.
  - **Tests:** new T-RSVP-08..12, T-CONC-08, T-ME-09..10, T-NFC-24; T-RSVP-05/06, T-NFC-12/14, T-SCAN-19, T-PRIV-01 and T-ADM-08 changed.
- **v0.8.1 (2026-10-20)** — The scanner takes one input at a time: a **Camera | NFC badges** switch (only where Web NFC exists). NFC mode releases the camera and keeps the badge reader on; on a real Android phone the running camera stopped NFC reads (§10.1, §10.5, A10). The saved camera is now a preference, not an exact requirement, which fixes a camera stuck as "unavailable" after Chrome changed its device id. The NFC hook no longer aborts a tap-started reader when auto-start settings change. New test T-NFC-23.
- **v0.4.1 (2026-10-19)** — Admin emails: `ADMIN_EMAILS` accounts are organizer on every event, granted at sign-in by `grant_admin_roles()` (F9 step 7, §3, §19). `/me` links staff to their events' Admin and Scanner pages; `/` redirects to `/me`. New tests T-AUTH-06, T-ME-02.
- **v0.2 (2026-09-24)** — Console provider saves QR images as `.mail/qr/<Event>-<First>.png` (T-MAIL-13/14); `pnpm seed` uses the same naming; optional `DEV_PUBLIC_HOST`; `apps-script/Setup.gs` (form setup, connect an existing Sheet, Applicant ID backfill).

---

## Appendix A — Apps Script (`apps-script/Code.gs`)

**Setup**
1. In the Sheet, open **Extensions → Apps Script** and paste this file.
2. Under **Project Settings → Script properties**, set `ENDPOINT`, `EVENT_SLUG` and `INGEST_SECRET`.
3. Under **Triggers**, add:
   - `onFormSubmitInstalled`: *From spreadsheet → On form submit* (assigns the Applicant ID and imports the row),
   - `onEditInstalled`: *From spreadsheet → On edit* (re-syncs edited rows).
4. Add the headers `Applicant ID` and `Sync Status`. A `Status` column is optional and ignored (v0.4).

```javascript
const SHEET_NAME = 'Form Responses 1';
const HEADERS = {
  id: 'Applicant ID', email: 'Email Address', first: 'First Name', last: 'Last Name',
  dietary: 'Dietary Restrictions', linkedin: 'LinkedIn URL', status: 'Status', sync: 'Sync Status',
};
// v0.4: Status is optional and ignored by Station (acceptance comes from the RSVP, SPEC F13).
const REQUIRED = ['id', 'email', 'first', 'sync'];

function prop_(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('Missing script property ' + k);
  return v;
}

function headerMap_(sheet) {
  const row = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const byName = {};
  row.forEach((h, i) => { byName[String(h).trim()] = i + 1; });
  const cols = {};
  Object.keys(HEADERS).forEach(k => { cols[k] = byName[HEADERS[k]] || 0; });
  REQUIRED.forEach(k => { if (!cols[k]) throw new Error('Missing header: ' + HEADERS[k]); });
  return cols;
}

function onFormSubmitInstalled(e) {
  const sheet = e.range.getSheet();
  const cols = headerMap_(sheet);
  const cell = sheet.getRange(e.range.getRow(), cols.id);
  if (!cell.getValue()) cell.setValue(Utilities.getUuid());
  syncRows_(sheet, cols, e.range.getRow(), e.range.getRow()); // v0.4: import new applicants right away
}

function onEditInstalled(e) {
  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_NAME) return;
  const cols = headerMap_(sheet);
  const r = e.range;
  if (r.getColumn() === cols.sync && r.getLastColumn() === cols.sync) return; // only Sync Status edited
  const first = Math.max(r.getRow(), 2);          // skip header row
  const last = r.getLastRow();
  if (last < first) return;
  syncRows_(sheet, cols, first, last);
}

function syncRows_(sheet, cols, first, last) {
  const values = sheet.getRange(first, 1, last - first + 1, sheet.getLastColumn()).getValues();
  const get = (v, k) => (cols[k] ? String(v[cols[k] - 1]).trim() : '');
  const rows = values.map(v => ({
    external_id: get(v, 'id'), email: get(v, 'email'), first_name: get(v, 'first'),
    last_name: get(v, 'last'), dietary_notes: get(v, 'dietary'),
    linkedin_url: get(v, 'linkedin'), status: get(v, 'status'),
  }));
  const body = JSON.stringify({ event_slug: prop_('EVENT_SLUG'), rows: rows });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = hex_(Utilities.computeHmacSha256Signature(ts + '.' + body, prop_('INGEST_SECRET'),
                                                         Utilities.Charset.UTF_8));
  let out;
  try {
    const res = UrlFetchApp.fetch(prop_('ENDPOINT'), {
      method: 'post', contentType: 'application/json; charset=utf-8', payload: body,
      headers: { 'X-Station-Timestamp': ts, 'X-Station-Signature': sig },
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    const stamp = new Date().toISOString();
    out = code === 200
      ? JSON.parse(res.getContentText()).results.map(x => [x.result + ' ' + stamp])
      : rows.map(() => ['ERROR HTTP ' + code + ' ' + stamp]);
  } catch (err) {
    out = rows.map(() => ['ERROR ' + String(err).slice(0, 80)]);
  }
  sheet.getRange(first, cols.sync, out.length, 1).setValues(out); // script edits don't re-fire onEdit
}

function hex_(bytes) {
  return bytes.map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}
```
