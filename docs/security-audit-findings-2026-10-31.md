# Security audit findings — 2026-10-31 (branch `jon/security-audit`)

MEDIUM and LOW findings only. Full audit incl. test-run results and the HIGH-severity item:
`docs/security-audit-2026-10-31.md`.

Verified by 4 parallel deep-read passes over all routes/libs/migrations plus targeted
re-verification. Test runs (local only): lint PASS, typecheck PASS, unit 165/165 PASS.

---

## MEDIUM

### M1 — Open redirect via control characters in the `next` param
- **Where:** `lib/auth/next-path.ts:2-5` (`safeNextPath`); sinks: `app/login/actions.ts:31`,
  `app/set-password/page.tsx:25,38`, `app/auth/confirm/page.tsx:19,24`,
  `app/onboarding/page.tsx:24,29`, `app/rsvp/rsvp-view.tsx:126`.
- **Bug:** only rejects empty / non-`/` / `//` / `/\`. `/\t//evil.com` passes, but WHATWG URL
  parsing strips `\t\n\r`, so `new URL('/\t//evil.com', origin)` → `https://evil.com/` (verified in Node).
- **Attack:** send victim `https://app/login?next=%09//evil.com`; after sign-in they are redirected
  to the attacker's site.
- **Impact:** post-authentication phishing.
- **Fix:** strip `\x00-\x20`, or resolve `new URL(raw, origin)` and require `url.origin === appOrigin`.
  Add regression tests with `\t`/`\n`/`\r` payloads.

### M2 — Rate-limit IP key is client-spoofable
- **Where:** `lib/pass/handlers.ts:42` (`ipKey` takes leftmost `x-forwarded-for`); used by
  `/api/pass` and `/api/rsvp` (600/min ceiling, `handlers.ts:48-52,62,72`).
- **Bug:** on platforms that append the real client IP, the leftmost entry is attacker-controlled;
  requests with no forwarding headers all share one `'unknown'` bucket.
- **Impact:** per-IP throttle on the token endpoints is bypassable (token space is 192-bit so
  guessing stays infeasible, but the intended backstop is gone); shared-bucket DoS.
- **Fix:** key on the rightmost platform-trusted hop or `x-real-ip` only.

### M3 — Role grants don't verify the account email
- **Where:** `supabase/migrations/20260924060144_staff_and_search.sql:5-19` (`consume_staff_invites`),
  `supabase/migrations/20261019162514_admin_emails.sql` (`grant_admin_roles`); called at sign-in in
  `lib/auth/onboarding.ts:26-27`.
- **Bug:** both match only `email = lower(btrim(...))`; no `email_confirmed_at` check exists anywhere
  under `supabase/`. If the project has "Confirm email" disabled, anyone registering an address in
  `staff_invites` becomes staff, and any address in `ADMIN_EMAILS` becomes organizer of **every** event.
- **Impact:** full organizer compromise, cross-event, from an unverified signup.
- **Fix:** require `email_confirmed_at is not null` in both RPCs; add a config assertion test.

### M4 — Account-existence enumeration via staff invites
- **Where:** `lib/admin/handlers.ts:510-514` — `invite_staff` result `ADDED` vs `INVITED` is returned
  verbatim (`json({ code: data })`); route has no rate limit.
- **Attack:** any organizer probes arbitrary emails to learn which have platform accounts.
- **Impact:** platform-wide account enumeration oracle (organizer-gated).
- **Fix:** uniform response for both outcomes + rate limit on the route.

### M5 — Unthrottled public badge-profile enumeration
- **Where:** `app/profile/[uid]/page.tsx:47-61` (public by design); UID format 4–10 byte hex
  (`lib/domain/badge.ts:3`); `profile_public` defaults true
  (`supabase/migrations/20261026172726_public_badges.sql:6,12-16`).
- **Attack:** enumerate sequential MIFARE UIDs (2^32 space for 4-byte) and harvest attendee names +
  LinkedIn/Discord/website. No email/health data exposed.
- **Impact:** mass harvesting of attendee identity/social links.
- **Fix:** per-IP rate limit on `/profile/*` (e.g. `rate_limit_hit` in proxy); consider minimum UID length.

---

## LOW

| # | Finding | Where | Impact / fix |
|---|---|---|---|
| L1 | `DRAIN_SECRET` shared by `/api/cron`, `/api/retention`, `/api/email/drain` (also Vercel `CRON_SECRET`) | `app/api/cron/route.ts:15,30`, `app/api/retention/route.ts:9`, `app/api/email/drain/route.ts:12` | One leak hits scheduler + PII-deletion + mail drain. Give each endpoint its own secret. |
| L2 | Ingest HMAC replay window 300 s, no nonce | `lib/domain/hmac.ts:4,18-19`, `lib/ingest/handler.ts:41-49` | Captured webhook replayable 5 min; impact limited (idempotent upserts). Add jti seen-set if needed. |
| L3 | No rate limit on `POST /api/scans/[id]/void` | `lib/scan/handlers.ts:300-315` | Scan-UUID oracle (NOT_FOUND vs FORBIDDEN) for any signed-in user. Add throttle. |
| L4 | Scan rate-limit check-then-act race (count before insert) | `lib/scan/handlers.ts:100-104` vs `:133` | Concurrent bursts can exceed 120/min briefly. Move check after insert or use atomic RPC. |
| L5 | `clientScannedAt` is client-controlled | `lib/scan/schema.ts:14` → stored as `client_scanned_at` | Staff can backdate scan times. Clamp to server time ± skew. |
| L6 | RSVP "No" needs only the emailed token (no password); revokes pass, deletes badge | `lib/rsvp/handlers.ts:89-99`, `supabase/migrations/20261026170439_rsvp_deadline.sql:83-92` | Link leak = victim loses spot/pass (griefing). Consider requiring confirm for destructive answer. |
| L7 | Anyone scanning the pass QR can toggle `profile_public` | `lib/pass/handlers.ts:101-124` (`PATCH /api/pass`) | By design (§6.5) but token is a scannable bearer capability. Note in threat model. |
| L8 | No per-IP limit on `signIn` / `sendPasswordLink` | `app/login/actions.ts:28,41` | Distributed credential stuffing / reset-email flooding (per-email caps only). Add IP ceiling. |
| L9 | Logout CSRF — POST signout has no Origin check | `app/auth/signout/route.ts:5-7` | Forced logout only. Add `Origin`/`Sec-Fetch-Site` check. |
| L10 | CSP `script-src 'unsafe-inline'`, no nonce, no `trusted-types`; `style-src 'unsafe-inline'` | `lib/domain/security-headers.ts:11-12` | Any future DOM-XSS executes unimpeded. Move to nonce-based CSP; add `trusted-types`. |
| L11 | HSTS without `preload`; no COOP/COEP/CORP | `lib/domain/security-headers.ts:34` | Minor hardening gaps (tab-nabbing etc.). |
| L12 | `Content-Disposition` built from raw `params.kind` | `lib/admin/handlers.ts:126-134` | Filename confusion only (CRLF impossible via fetch Headers). Sanitize anyway. |
| L13 | No CSRF tokens on state-changing admin routes; relies on strict-JSON + Lax-default cookies | `lib/admin/handlers.ts:38-44`, `proxy.ts:9-19` | Practical CSRF is blocked, but require `content-type: application/json` (as `/api/rsvp` does) and set explicit `sameSite`. |
| L14 | Organizer can sync any Google Sheet ID readable by the shared service account | `lib/admin/handlers.ts:581-582`, `lib/sheets/google.ts` | Cross-tenant sheet read if ID leaks + SA has broad Drive scope. Scope the service account. |
| L15 | `.env.test` committed with local-stack demo JWTs | `.env.test:9-10` | Public demo keys, safe; just never point them at a remote project (file already warns). |
| L16 | Dockerfile: floating `node:24-bookworm-slim`, no non-root `USER`, devDeps in image | `Dockerfile:2,7-9` | Pin digest, add `USER node`, multi-stage. `.dockerignore` correctly excludes `.env*`. |
| L17 | No `pnpm audit` / Dependabot in CI | `.github/workflows/ci.yml`, `nightly.yml` | Pins currently ≥ patched releases (next 16.4.3, sharp 0.35.5, zod 4.6.7), but nothing enforces. Add audit step. |
| L18 | `sharp` in `dependencies` though only tests import it | `package.json:45` | Shrink prod image; move to devDependencies. No untrusted image is processed server-side (`lib/qr/render.ts` uses pure-JS `qrcode`). |

## Architecture note (not a bug today)
Service-role key for all server code (`lib/db/server.ts:10-15`); compensated by deny-all RLS + every
RPC `SECURITY DEFINER`, `service_role`-only, `search_path` pinned — verified across all migrations.
Any future handler missing `requireStaffBySlug` = full DB access. Keep the invariant (consider a
lint/test that every route file starts with a guard).

## Verified solid
Timing-safe secret compares; HMAC over raw body; hash-only token storage; tokens in URL fragments +
`Referrer-Policy: same-origin`; per-slug organizer guards with eventId from the membership row (no
IDOR found); zero XSS sinks; email templates fully escaped; Resend via JSON body; CSV formula
injection neutralized; search input stripped to alphanumerics; uniform login/reset responses;
RSVP-Yes requires the account's password; env errors never log values; client-bundle secret scan in
CI; no secrets in git history.
