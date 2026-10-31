# Security audit — 2026-10-31 (branch `jon/security-audit`)

Scope: full repo review of the Next.js 16 + Supabase app (`station`), all API routes, auth
flows, DB migrations/RLS, email pipeline, Apps Script webhook, config, CI, Docker, dependencies.
Method: 4 parallel deep-read passes over every route/lib/migration + targeted re-verification of
top findings + local test runs.

## Test runs performed (local only, prod untouched)

| Check | Result |
|---|---|
| `pnpm lint` (eslint --max-warnings 0) | PASS |
| `pnpm typecheck` (tsc --noEmit, after `next typegen`) | PASS |
| `pnpm test:unit` | PASS — 39 files, 165 tests |
| `pnpm test:int` / `test:e2e` | NOT RUN — require local Supabase stack (ports 54321/54322, enforced by `tests/fixtures/db.ts:8-10`); Docker engine not running and prod was deliberately not used |

Email paths were exercised only via the `console` provider (`.env.test` sets `EMAIL_PROVIDER=console`).
No Resend sends were made; no production credentials were used by any test.

## Findings

### HIGH

1. **Live production credentials in plaintext `.env` in the working tree.** `.env` (untracked,
   absent from git history — verified) contains the prod Supabase **service-role JWT** and a live
   **Resend API key**, plus the prod project ref. The service-role key bypasses RLS, so anyone who
   exfiltrates the working dir (IDE sync, zip/backup, mis-scoped build context) gets full DB
   read/write and can send mail as the project's domain. `.gitignore`/`.dockerignore` cover the
   common paths, but the file itself should not exist in this form.
   **Action:** rotate both keys now; keep prod secrets only in Vercel/secret manager, locally in
   `.env.local`.

### MEDIUM

2. **Open redirect via control characters in the `next` param.** `safeNextPath`
   (`lib/auth/next-path.ts:2-5`) rejects only empty / non-`/` / `//` / `/\`. A value like
   `/\t//evil.com` passes, but WHATWG URL parsing strips `\t\n\r`, so `new URL('/\t//evil.com', origin)`
   → `https://evil.com/` (verified with Node). Sinks: post-auth `redirect()` in
   `app/login/actions.ts:31`, `app/set-password/page.tsx:25,38`, `app/auth/confirm/page.tsx:19,24`,
   `app/onboarding/page.tsx:24,29`, and `router.push(next)` in `app/rsvp/rsvp-view.tsx:126`.
   Attack: `https://app/login?next=%09//evil.com` → victim lands on attacker site after sign-in.
   **Fix:** strip `\x00-\x20` or resolve via `new URL(raw, origin)` and require `url.origin === appOrigin`.

3. **Rate-limit IP key is client-spoofable.** `ipKey` (`lib/pass/handlers.ts:42`) takes the
   **leftmost** `x-forwarded-for` entry; on platforms that append the real IP, the leftmost is
   attacker-controlled. This is the only per-IP throttle on `/api/pass`, `/api/rsvp` (600/min
   ceiling), and removing it also collapses all header-less requests into one shared `unknown`
   bucket (DoS). Token space is 192-bit so guessing stays infeasible, but the backstop is bypassable.
   **Fix:** use the rightmost platform-trusted hop (or `x-real-ip` only).

4. **Staff/admin role grant does not verify the email.** `consume_staff_invites`
   (`supabase/migrations/20260924060144_staff_and_search.sql:5-19`) and `grant_admin_roles`
   match only `email = lower(btrim(...))` — no `email_confirmed_at` check anywhere in `supabase/`.
   Called at every sign-in (`lib/auth/onboarding.ts:26-27`). If the Supabase project has "Confirm
   email" off, anyone registering an address present in `staff_invites` (or `ADMIN_EMAILS` →
   organizer on **every** event) gets roles immediately. **Fix:** require `email_confirmed_at` in
   both RPCs (or enforce in project config and add a test asserting it).

5. **Account-existence enumeration via staff invites.** `POST /api/admin/[slug]/staff/invites`
   returns `ADDED` vs `INVITED` (`lib/admin/handlers.ts:510-514`), revealing whether any email has a
   platform account; no rate limit on the route. **Fix:** return one uniform response; add rate limit.

### LOW

6. `DRAIN_SECRET` doubles as Vercel `CRON_SECRET` and guards `/api/cron`, `/api/retention`,
   `/api/email/drain` (`app/api/cron/route.ts:15,30`). One leak compromises scheduler + PII-deletion
   job + mail drain. Give each endpoint its own secret.
7. Ingest HMAC has a 5-min replay window, no nonce (`lib/domain/hmac.ts:4,18-19`). Impact limited
   (idempotent upserts); add a jti/store-seen set if the threat model requires.
8. No rate limit on `POST /api/scans/[id]/void` — scan-UUID oracle (NOT_FOUND vs FORBIDDEN) for any
   signed-in user (`lib/scan/handlers.ts:300-315`).
9. Scan rate-limit check-then-act race (`lib/scan/handlers.ts:100-104` vs insert at :133) — bursts can
   exceed 120/min briefly.
10. `clientScannedAt` is client-controlled (`lib/scan/schema.ts:14`) — staff can backdate scans.
11. RSVP "No" requires only the emailed token, no password — revokes pass/deletes badge
    (`lib/rsvp/handlers.ts:89-99`, migration `20261026170439_rsvp_deadline.sql:83-92`). Griefing vector
    if the link leaks.
12. `PATCH /api/pass` lets anyone holding/scanning the pass QR toggle `profile_public`
    (`lib/pass/handlers.ts:101-124`) — by design, but it's a scannable bearer capability.
13. Unthrottled public badge-profile enumeration: `/profile/[uid]` has no rate limit; UIDs are
    4–10 byte hex (`lib/domain/badge.ts:3`) and `profile_public` defaults true. Names + social links
    harvestable. Add per-IP limiting on `/profile/*`.
14. No per-IP limit on `signIn`/`sendPasswordLink` (`app/login/actions.ts:28,41`) — per-email only;
    distributed stuffing / reset-email flooding possible.
15. Logout CSRF: `app/auth/signout/route.ts` POST has no Origin check.
16. CSP `script-src 'unsafe-inline'`, no nonce, no `trusted-types` (`lib/domain/security-headers.ts:11`);
    HSTS without `preload`; no COOP/COEP/CORP; `style-src 'unsafe-inline'`.
17. `Content-Disposition` built from raw `params.kind` (`lib/admin/handlers.ts:126-134`) — filename
    confusion only (CRLF impossible), sanitize anyway.
18. No CSRF tokens on state-changing admin routes — relies on strict-JSON bodies + Lax-default cookies;
    require `content-type: application/json` (as `/api/rsvp` already does) and/or explicit
    `sameSite` on cookies.
19. Organizer can attach/sync any Google Sheet ID readable by the shared service account
    (`lib/admin/handlers.ts:581-582`) — consider scoping the service account.
20. `.env.test` is committed with local-stack demo JWTs (safe, public keys — keep out of deployments).
21. Dockerfile: floating `node:24-bookworm-slim` tag, no non-root user, devDeps in final image.
22. No `pnpm audit`/Dependabot in CI. Current pins check out against 2026-10 advisories
    (next 16.4.3, sharp 0.35.5, zod 4.6.7 all ≥ patched), but nothing enforces it.
23. `sharp` in `dependencies` though only used by tests — move to devDependencies.

### Architecture note (not a bug today)

Service-role key is used for all server code (`lib/db/server.ts:10-15`); safety rests on deny-all
RLS (no policies, all table grants revoked from anon/authenticated, every RPC `SECURITY DEFINER`
+ `service_role`-only). Verified consistent across all migrations. Any future handler that forgets
`requireStaffBySlug` = full DB access. Keep the invariant; consider a lint rule/test that every
route file starts with a guard.

## Verified solid (no action needed)

- Timing-safe secret compares (`lib/auth/secret.ts`), HMAC over raw body with skew limit + pinned-length
  `timingSafeEqual` (`lib/domain/hmac.ts`), hash-only token storage, tokens only in URL fragments +
  `Referrer-Policy: same-origin`.
- Every admin route: session verified server-side via `getUser()` + organizer-of-slug guard, `eventId`
  taken from the membership row (not the URL), all queries event-scoped; cross-event IDs → 403/404.
  No IDOR found anywhere.
- No XSS sinks (`dangerouslySetInnerHTML`/`innerHTML`: zero matches); all email templates escape user
  data; Resend called via JSON body (no header injection); CSV exports neutralize formula injection
  (`lib/domain/csv.ts:6-11`); search input stripped to alphanumerics (no LIKE-wildcard/SQL injection).
- Login/reset responses uniform (no enumeration); RSVP-Yes on existing account requires that
  account's password; `/api/rsvp` requires JSON content-type (CSRF-safe, matters because it sets a
  session cookie).
- Env parsing never logs secret values (`lib/env.ts:45-47`); 500s carry only a request id
  (`lib/http/route.ts:7-16`); `scripts/check-bundle.mjs` scans client bundles for secret values in CI.
- No secrets in git history (`.env` never committed); `.mcp.json` exposes only the project ref.
- next.config: no rewrites/redirects (vercel.json redirect is host-pinned), no image remotePatterns,
  `poweredByHeader: false`, `allowedDevOrigins` dev-only; security headers applied to `/api/*` too.

## Recommended next steps

1. Rotate the Resend key + Supabase service-role key found in `.env`; delete that file from the
   working tree after moving values to a secret manager.
2. Fix `safeNextPath` (finding 2) — one-line fix + regression test with `\t`/`\n` cases.
3. Fix `ipKey` to use the trusted hop (finding 3).
4. Add `email_confirmed_at` enforcement in `consume_staff_invites`/`grant_admin_roles` (finding 4).
5. Run int + e2e suites against a **fresh** Supabase project (schema-only migrations + `scripts/seed.ts`),
   or a local `supabase start` — never against prod.
