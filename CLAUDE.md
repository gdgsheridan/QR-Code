# CLAUDE.md — Station

Station emails QR passes to accepted event applicants and scans them for door check-in, meals, sessions and custom checkpoints. It is a Next.js + Supabase app used by a student club.

**@SPEC.md is the source of truth for behaviour.** This file is the source of truth for *how you work*. If they conflict on behaviour, SPEC.md wins. Stop and tell me about the conflict.

## Stack
- Next.js (App Router) · TypeScript `strict` · pnpm
- Supabase (Postgres, Auth, Storage) with the local stack via Docker
- zod · sharp · qrcode
- Vitest (unit + integration) · Playwright (e2e)
- Email is behind `lib/email/provider.ts`. `EMAIL_PROVIDER=console` in test (always) and by default in dev; dev may opt in to `resend` in `.env.local`.

## Commands
| Task | Command |
|------|---------|
| Dev server | `pnpm dev` |
| Typecheck | `pnpm typecheck` (`tsc --noEmit`) |
| Lint | `pnpm lint` |
| Unit tests | `pnpm test:unit` |
| Integration tests (needs local Supabase) | `pnpm test:int` |
| E2E | `pnpm test:e2e` |
| Everything CI runs | `pnpm check` (typecheck + lint + unit + int) |
| Start/stop local DB | `supabase start` / `supabase stop` |
| Reset DB (re-run all migrations + seed) | `pnpm db:reset` (`supabase db reset`) |
| New migration | `supabase migration new <snake_case_name>` |
| Regenerate DB types | `pnpm db:types` (`supabase gen types typescript --local > lib/db/types.gen.ts`) |
| Seed demo event (50 fake participants, QR PNGs to `./.seed/`) | `pnpm seed` |
| Read dev emails | `./.mail/*.eml` (open in Apple Mail); QR images in `./.mail/qr/<Event>-<First>.png` |
| Delete dev emails + seed images | `pnpm clean:dev` |

Prefer running a single test file while iterating (`pnpm vitest run path/to/file.test.ts`). Run the full relevant suite before declaring done.

## Repo map
```
app/
  (staff)/scan/[slug]/        scanner UI
  (staff)/admin/[slug]/       organizer UI
  p/                          participant pass page (reads token from location.hash)
  api/scan/                   POST scan → record_scan()
  api/ingest/sheet/           HMAC-signed Sheet sync
  api/pass/, api/pass/photo/  pass page data, photo upload
  api/email/drain/            outbox drainer
  api/admin/...               organizer-only endpoints
lib/
  domain/     PURE functions only, no I/O (token parsing, scan-codes, search normalization, csv, status transitions)
  db/         server-only Supabase client, typed queries, generated types
  auth/       requireStaff(eventId, role?) and session helpers
  email/      provider interface, console + resend impls, templates
  scanner/    QrScanner interface + implementation, Web NFC reader (nfc.ts)
supabase/migrations/  SQL migrations (never edit applied ones)
apps-script/Code.gs   Google Sheet bridge (SPEC Appendix A)
tests/unit | tests/int | tests/e2e | tests/fixtures | tests/assets (QR .y4m videos, EXIF images)
```

## Non-negotiable invariants
Each one has tests. If a task seems to require breaking one, **stop and ask**.

- **I-1 No false green.** The scanner shows a green/admit state *only* when the server returned `ACCEPTED`. Timeouts, 5xx, offline and parse failures are amber, never green.
- **I-2 One scan-decision path.** Every scan goes through `record_scan()` in Postgres. Never read scan state in TypeScript and then write based on it.
- **I-3 Tokens are secrets.** Store only `sha256` hex. Never persist, log, or put a raw token in a URL path or query string. Only the URL fragment (`/p#token`) and POST bodies may carry it.
- **I-4 QR payload is exactly `${APP_ORIGIN}/p#${token}`.** No PII in QR codes, ever.
- **I-5 The browser never touches tables.** All data flows through route handlers and server actions using the service-role client from `lib/db/server.ts`. That file starts with `import 'server-only'`. Authorization via `requireStaff()` happens **before** any query.
- **I-6 Deny-all RLS.** Every new table enables RLS with no policies. Every view is `with (security_invoker = true)` and revoked from `anon` and `authenticated`. Every function revokes EXECUTE from `public, anon, authenticated` and grants it to `service_role`. SECURITY DEFINER functions `set search_path = public, pg_temp`.
- **I-7 Server time is authoritative.** Store `client_scanned_at` for diagnostics only.
- **I-8 `timestamptz` everywhere.** Display in `events.timezone` via `Intl.DateTimeFormat`. Never use the device timezone for event times.
- **I-9 Never hard-delete scans.** Void them. Voided scans are excluded from every rule and count.
- **I-10 A pass is committed before its email is sent.** The outbox drainer calls `issue_pass()` (own transaction) and only then calls the provider.
- **I-11 No PII in logs or `audit_log.detail`.** Log ids, codes and latencies only. No names, emails, tokens, dietary notes or photos.
- **I-12 Normalize at every entry point.** Use `normalizeEmail()` (trim + lowercase) and `toSearchText()` for names. Never inline these.
- **I-13 CSV only via `toCsv()`.** It includes the BOM, quoting and the formula-injection guard.
- **I-14 Sheet row identity is `Applicant ID`.** Never use a row number, and never use email as the key.
- **I-15 Result codes are defined once.** `ScanCode` lives in `lib/domain/scan-codes.ts`. Changing a code means changing the SQL, TS, UI table (SPEC §10.2) and tests together.

## Workflow for every task
1. **Locate.** Name the slice (SPEC §18), the SPEC sections involved, and the test IDs you will satisfy.
2. **Plan** (plan mode). The plan must list:
   - files to create or modify,
   - migrations,
   - test IDs, with any new tests you'll add,
   - risks and open questions.
   Wait for approval. Keep plans short; if a plan is getting long, the task should be split.
3. **Tests first** for anything in `lib/domain`, SQL functions, concurrency, auth and security. Write the failing test, run it, and confirm it fails **for the expected reason**.
4. **Implement** the smallest change that passes. No speculative abstractions, and no features outside the current slice.
5. **Verify.** Run `pnpm typecheck && pnpm lint`, the relevant tests, and `pnpm test:int` if you touched SQL or route handlers. Run e2e if you touched UI. Paste the actual summary lines, not "tests pass".
6. **Self-review** against the checklist below.
7. **Report**, in this order:
   - what changed (files),
   - which test IDs now pass,
   - anything you deviated from in the SPEC and why,
   - follow-ups you noticed but did not do.
   Do not edit SPEC.md unless I approve the change. Proposed spec changes go in the report.

Commit after each green step with a message like `S1: record_scan capacity lock (T-SCAN-11, T-CONC-06)`. Never commit with failing tests. Never push or deploy.

## Definition of done
- [ ] All listed test IDs exist, reference their ID in the test name, and pass.
- [ ] `pnpm check` is green.
- [ ] No new `any`, `@ts-ignore`, `eslint-disable`, or `.only`/`.skip` in tests.
- [ ] If a migration changed: `pnpm db:reset` succeeds from scratch, and `pnpm db:types` has been run and committed.
- [ ] New env vars are added to `.env.example` and SPEC §19 (flag the SPEC edit in your report).
- [ ] Invariants I-1..I-15 still hold. Say which ones were relevant.

## Database rules
- **Never edit a migration that has been applied.** Create a new one.
- Put constraints in the database: uniqueness, FKs, checks. TypeScript validation is for friendly errors, not integrity.
- **Any destructive change** (drop, type narrowing, data backfill) needs explicit approval first.
- Every new table goes through this checklist:
  - [ ] RLS enabled
  - [ ] Appears in T-SEC-01/02 automatically (they enumerate `pg_tables`, so do not hardcode table lists)
  - [ ] FKs and indexes for every lookup path
- Every new function goes through this checklist:
  - [ ] Grants per I-6
  - [ ] Added to T-SEC-08 coverage
- Call SQL functions through `supabase.rpc()` from server code only.

## Testing rules
- Test names start with the spec ID: `it('T-SCAN-11: already-scanned beats capacity', …)`.
- **Integration tests hit real Postgres** (local Supabase). Never mock the database. Mock only:
  - the email provider,
  - the clock (`vi.useFakeTimers` or an injected `now()`),
  - the camera (Playwright fake device),
  - Web NFC (a fake `window.NDEFReader` installed with `addInitScript`),
  - Google APIs.
- **Isolation.** Each test file creates its own event through `tests/fixtures/standard.ts` with a unique slug. Never depend on another file's data or on execution order.
- **Concurrency tests use genuinely parallel connections.** Use a `pg.Pool` sized ≥ N plus `Promise.all`, calling `select record_scan(...)` directly. Sequential `await`s in a loop do not test concurrency. The retry race in T-CONC-02 only shows up about 5% of the time, so the nightly loop (T-CONC-07) matters.
- **Never weaken, delete or `.skip` a failing test to get green.** If you believe a test is wrong, stop and explain why, quoting the SPEC line.
- **A flaky test is a bug**, usually a race in the code. Don't add retries or longer timeouts to hide it.
- For every bug fixed: first add a test that reproduces it, then fix it.
- Scanner e2e uses the Chromium flags `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-video-capture=tests/assets/<name>.y4m`. Generate `.y4m` files with `pnpm gen:qr-video <token>` (script uses ffmpeg). Use route interception to stub `ScanCode` responses for UI-state tests.

## Coding conventions
- TypeScript `strict`, `noUncheckedIndexedAccess`. No `any`; use `unknown` and narrow it.
- zod schemas at every boundary: request bodies (`.strict()`), Sheet rows, env (`lib/env.ts` parses `process.env` once at startup and fails loudly).
- Route handlers stay thin: parse → authorize → call one domain or db function → map to response. No business logic in route files.
- `lib/domain/*` is pure: no `fetch`, no DB, no `Date.now()` (take `now` as a parameter). This is where most unit tests live.
- Errors: domain outcomes are values (a `code`), not exceptions. Throw only for truly unexpected failures, and let the route wrapper map them to 500 with a request id.
- Dependencies: justify every new package in your plan (what it does, why not a few lines of our own code, maintenance status). Never add one silently.
- Accessibility is part of "done" for UI: status never conveyed by color alone, tap targets ≥ 44 px, visible focus.

## Scanner UI rules (see SPEC §10)
- The checkpoint banner is always visible. Switching checkpoints requires confirmation.
- Pause decoding while a result is displayed. Ignore identical decodes within 3 s.
- Retries reuse the same `clientScanId`. A new physical scan gets a new one.
- Only green auto-dismisses. Everything else requires a tap.
- `<video playsinline muted>`. Do not rely on `navigator.vibrate` or torch (not available on iOS Safari).
- `localStorage` is allowed only for scanner preferences (checkpoint, camera id). Never for participant data.

## Security review checklist (run on every change touching routes, SQL or auth)
- [ ] Is authorization checked server-side before the first query? Is the role correct (volunteer vs organizer)?
- [ ] Can a volunteer on event B affect event A through this path?
- [ ] Does any response leak another event's participant data, or full emails to volunteers?
- [ ] Could a token, email or name reach a log, an error message, a URL or `audit_log`?
- [ ] Is user input rendered anywhere without escaping (email HTML, CSV, admin tables)?
- [ ] Is anything rate-limited in memory? That's wrong on serverless; use the `rate_limits` table.
- [ ] Is the service-role key reachable from a client bundle?

## Things you must not do
- Do not run anything against a remote or production Supabase project (`supabase db push`, `supabase link`, remote SQL). Local only.
- Do not `git push`, deploy, or change CI secrets.
- Do not call a real email provider from tests. In dev, only when `.env.local` sets `EMAIL_PROVIDER=resend` on purpose, and only to addresses you control (never the seed's `@example.test` people: bounces hurt the sending domain).
- Do not scrape LinkedIn or fetch LinkedIn URLs. `linkedin_url` is stored text only.
- Do not add offline scanning, Wallet passes, or anything in SPEC §1 non-goals.
- Do not "simplify" `record_scan()` step order, remove the capacity lock, or drop the replay checks. Each exists because of a specific race (see SPEC §8 and T-CONC-02/06).

## Stop and ask when
- The SPEC is ambiguous, contradicts itself, or contradicts reality (e.g. a library or API behaves differently than an assumption in SPEC §17 says). Report what you found and link the docs.
- A change would break an invariant, alter a result code, or change a DECISION in the SPEC.
- You believe a test is wrong.
- A task needs a destructive migration, a new external service, or a new secret.
- You've tried two approaches and neither works. Explain both rather than trying a third blindly.

## Gotchas (learned the hard way — read before touching these areas)
- **Postgres grants EXECUTE on new functions to PUBLIC by default.** The `revoke` in I-6 is not optional.
- **Views bypass RLS by default** (they run as their owner). Hence `security_invoker = true`.
- **`ON CONFLICT` with a partial unique index** must repeat the index predicate: `on conflict (participant_id, checkpoint_id) where voided_at is null`.
- **Retry races:** a retry of the same `clientScanId` can arrive *before* the original commits, miss the step-1 replay check, and then find the committed row at step 10. Step 10 must compare `client_scan_id` before answering `ALREADY_SCANNED`.
- **Door checkpoints must be created with `requires_checkin = false`.** The column defaults to `true`, and a check constraint rejects doors with `true`.
- **HMAC over the raw body:** read `await req.text()` first, verify, then `JSON.parse`. Re-serialized JSON will not match. Use `timingSafeEqual` on equal-length buffers.
- **Apps Script `onEdit` does not fire for edits made by scripts or the API**, so writing `Sync Status` won't loop. A multi-cell paste arrives as one event covering the whole range.
- **`getUserMedia` requires HTTPS** (localhost excepted). To test on a real phone, use a Vercel preview URL or an HTTPS tunnel, not your LAN IP.
- **Transparent QR PNG + dark-mode email = unscannable.** Always use an opaque white background.
- **Gmail clips HTML emails over ~102 KB.** Keep templates lean and QR images reasonably sized.
- **Email click tracking rewrites links.** It must be off (SPEC §12).
- **DST:** 2026-11-01 01:00–02:00 happens twice in Toronto. Bucket in UTC, label in local time.
- **Serverless has no shared memory.** Rate limits, locks and queues live in Postgres.
- **`sharp` strips metadata by default**, but you must call `.rotate()` to apply EXIF orientation *before* it's stripped. Otherwise photos come out sideways.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
