# Sheridan Datathon Station

QR check-in for club events. Accepted applicants get a personal QR pass by email. Volunteers scan it at the door, at meals, at workshops and at any other checkpoint. Organizers watch live counts and export attendance.

- **How it's supposed to behave:** [SPEC.md](SPEC.md)
- **How to work on it with Claude Code:** [CLAUDE.md](CLAUDE.md)
- **Going live:** [docs/launch-checklist.md](docs/launch-checklist.md)

---

## Finding your way around

Everything is scoped to one **event**, identified by its slug in the URL (`demo`, `test-2026`, …).

| Page | Who | What it's for |
|------|-----|---------------|
| `/login` | Staff and participants | Sign in with your email and password. Use **Forgot or never set your password?** to set or reset it by email. First staff sign-in asks for a display name. |
| `/admin/<slug>` | Organizers | The event's control panel (tabs below). |
| `/scan/<slug>` | Organizers + volunteers | The scanner. Also reachable from the admin tabs ("Scanner ↗"). |
| `/p#<token>` | Participants | Their pass: name, event and QR code. They get this link in their email. |
| `/me` | Participants | My passes: upcoming events and links to open passes. |
| `/rsvp#<token>` | Applicants | Answer Yes or No to an RSVP invitation. |

**Switching events:** there's no event picker yet. Change the slug in the address bar, e.g. `/admin/demo` ↔ `/admin/test-2026`. After signing in you may land on the plain home page; type the `/admin/<slug>` or `/scan/<slug>` address from there.

**"Organizer access only"** means you're signed in with an account that isn't an organizer of *that* event, for example the volunteer account, or `you@example.com` (organizer of `test-2026`, not `demo`). See [Troubleshooting](#troubleshooting).

### Admin tabs (`/admin/<slug>`)

| Tab | Use it to |
|-----|-----------|
| **Dashboard** | See live check-ins, meals served, session attendance, the arrival chart and email status (pending/failed). It warns you if the event starts soon and the Door is still closed. |
| **Participants** | Search people. Resend a pass (their old QR stops working), revoke a pass, add a walk-in, mark someone as test data, delete someone, view or void their scans. |
| **Checkpoints** | Add the Door, meals, workshops and custom stations (raffle, swag). **Open** a checkpoint before scanning there; new ones start closed. Set capacity and whether a door check-in is required. |
| **Staff** | Invite volunteers and organizers by email; remove them. Removal takes effect on their very next scan. |
| **Sync** | "Sync now": compare the Google Sheet with the app, preview the changes, then apply. Needs the Google service account (see the launch checklist). |
| **Export** | Download CSVs of participants, scans and per-checkpoint totals. |

### The scanner (`/scan/<slug>`)

1. Pick the checkpoint. The coloured banner at the top always shows where you are; switching asks you to confirm.
2. Point the camera at a pass. Results:
   - 🟢 **Green (ADMIT / SERVE / RECORDED):** let them through. It clears by itself.
   - 🟠 **Amber:** needs action, e.g. *old code* (ask for their newest email), *not checked in yet* (send them to the Door), *checkpoint closed*, *no result* (network hiccup: rescan, don't admit yet). Tap to dismiss.
   - 🔴 **Red:** stop, e.g. *already scanned* (with who and when; escalate to an organizer), *pass cancelled*, *not accepted*, *wrong event*, *full*, *unknown code*. Tap to dismiss.
3. **Manual search:** for a broken screen or a lost email. Search by name (accents optional: `zoe` finds Zoë) and record the scan.
4. **Undo:** you can void your own scan for 2 minutes; give a reason. Organizers can void any scan from the Participants tab.
5. **OFFLINE banner:** no connection, so scanning is disabled. Use the printed roster (see the launch checklist) until it's back.

### How a pass gets to someone

Google Form → Google Sheet imports applicants as pending → an organizer selects them on the Participants page and sends an RSVP → each applicant answers Yes or No at `/rsvp#<token>`. Yes accepts them, signs them in after password setup if needed, and emails their QR pass; No withdraws them and revokes any pass. Applicants can change their answer until the event ends.

The Sheet's `Status` column is ignored and optional; it can be kept for notes. The Participants list shows **RSVP sent** for pending people who have been emailed.

---

## Running it locally

**Prerequisites:** Node 22, pnpm 10, Docker Desktop (running), the Supabase CLI, and `cloudflared` (`brew install cloudflared`) for the Google Sheet connection.

### First time only

```bash
pnpm install
supabase start

# Create .env.local with the local keys and two fresh secrets (overwrites an existing .env.local)
eval "$(supabase status -o env | grep -E '^(ANON_KEY|SERVICE_ROLE_KEY)=')"
cat > .env.local <<ENV
NEXT_PUBLIC_APP_ORIGIN=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
SHEET_INGEST_SECRET=$(openssl rand -hex 32)
DRAIN_SECRET=$(openssl rand -hex 32)
PASS_TOKEN_SECRET=$(openssl rand -hex 32)
EMAIL_PROVIDER=console
ENV
```

Check that both keys are filled in (each line should continue with `eyJ…`):

```bash
grep -E '^(NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)=.+' .env.local | cut -c1-45
```

### Every session

Use three terminal tabs.

**Tab 1: the app.**
```bash
open -a Docker                     # wait until Docker says it's running
supabase start
pnpm dev                           # http://localhost:3000, leave it running
```

**Tab 2: the tunnel** (only needed for the Google Sheet; see [Letting Google reach your laptop](#letting-google-reach-your-laptop)).
```bash
cloudflared tunnel --url http://localhost:3000     # leave it running
```

**Tab 3: commands.** A clean slate, when you want one:
```bash
pnpm clean:dev                     # delete .mail/ and .seed/
pnpm db:reset                      # empty database: deletes ALL events, people and sign-ins
pnpm seed                          # "demo" event: 50 accepted people, Door/Lunch/Workshop/Raffle open
```

`pnpm db:reset` deletes the `demo` event too. **Always run `pnpm seed` straight after it**, or the Sheet gets `ERROR HTTP 404` and every earlier QR image scans as an unknown code. You'll also need to sign in again.

To create an extra event with you as its organizer:
```bash
pnpm event:create --slug test-2026 --name "Test Event" --venue "Home" \
  --starts 2026-10-01T09:00 --ends 2026-10-01T18:00 --organizer you@example.com
```
Its Door checkpoint starts **closed**. Open it on the Checkpoints tab before scanning.

When you're done, press Ctrl+C in tabs 1 and 2, then run `supabase stop`.

### Signing in locally

Supabase Auth emails for setting or resetting passwords go to **Mailpit** at `http://127.0.0.1:54324` locally. Anyone can open the link in any browser window; it opens a page with **Continue**, then **Set your password**.

1. Go to `localhost:3000/login` and enter your email and password, or choose **Forgot or never set your password?**.
2. Open Mailpit, at `http://127.0.0.1:54324`, and click the link in the newest email. Continue, then set your password.

Accounts you can use:
- `organizer@example.test` and `volunteer@example.test`, seeded for `demo`. Choose **Forgot or never set your password?** for either address, then open the Mailpit link and set a password;
- the `--organizer` email you gave `event:create`, for that event.

Unknown email addresses get no email and the same on-screen message. A participant who is accepted another way or a walk-in can also use **Forgot or never set your password?** to get an account.

### Where passes end up locally

With `EMAIL_PROVIDER=console`, nothing is really emailed:

| What | Where |
|------|-------|
| The full pass email | `.mail/*.eml`. Double-click to open it in Apple Mail. |
| **The QR image alone** | **`.mail/qr/<Event>-<First>.png`**, e.g. `Demo-Hack-Day-Ada.png` |
| QR images for the seeded demo people | `.seed/Demo-Hack-Day-<First>.png` |

Folders starting with a dot are hidden in Finder. Open them from the terminal with `open .mail/qr` or `open .seed`.

Files are never overwritten. A second person with the same first name, or a resent pass, gets `-2`, `-3`, and so on. **The highest number is the newest code**; after a resend, the older file is how you test the "old code" screen. Images left over from before a `pnpm db:reset` belong to deleted people and scan as unknown codes; `pnpm clean:dev` clears them.

### Scanning locally

Use your **laptop's webcam** as the scanner (`localhost:3000/scan/<slug>`) and show the QR images from your phone (AirDrop them over). Phones can't sign in to the local app: the login page and scanner talk to Supabase at `127.0.0.1`, which on a phone means the phone itself.

---

## Connecting a Google Form

The Sheet talks to the app through `apps-script/Code.gs`. `apps-script/Setup.gs` automates the setup. In the Sheet, open **Extensions → Apps Script**, paste in both files, fill in `CONFIG` at the top of `Setup.gs`, then run one of:

| Function | When |
|----------|------|
| `setupTestForm` | Starting fresh: run it from a new, empty Google Sheet. It creates a form with the right questions, links it, adds the extra columns (including a Status dropdown, which Station ignores), saves the settings, and installs both triggers. The execution log prints the form link. |
| `connectExistingSheet` | You already have a form and Sheet: saves the settings and installs the triggers. |
| `updateEndpoint` | **After any `CONFIG` edit:** a new tunnel URL, a different event slug, a new secret. |
| `showEndpoint` | Shows the address and event slug the Sheet will actually use. |
| `backfillApplicantIds` | Your Sheet has responses from before the script was installed. Run once. |

> **The rule that causes most problems:** `Code.gs` never reads `CONFIG`. It reads the settings **saved** by `setupTestForm`, `connectExistingSheet` or `updateEndpoint`. Editing and saving `CONFIG` alone changes nothing. After every edit, run `updateEndpoint`, then `showEndpoint` to confirm.

**Keep your real values out of the repo.** The committed `Setup.gs` has placeholders on purpose. Your tunnel URL and `INGEST_SECRET` belong only in the Apps Script editor.

For a Sheet to connect:

1. **The form is linked to the Sheet,** and the responses tab is named `Form Responses 1` (or change `SHEET_NAME` in `Code.gs`).
2. **Row-1 headers match `HEADERS` in `Code.gs` exactly:**
   - Required: `Email Address`, `First Name`, `Applicant ID`, `Sync Status`.
   - Optional: `Last Name`, `Dietary Restrictions`, `LinkedIn URL`.

   If your questions are worded differently, edit the values in `HEADERS` rather than renaming columns. Google's built-in "Collect email addresses" setting already produces `Email Address`.
3. **Status** is ignored and optional; organizers may keep it for notes.
4. **Settings:**
   - `ENDPOINT`: app URL + `/api/ingest/sheet`
   - `EVENT_SLUG`: an event that exists **right now** (after a reset, only `demo`, and only once you've re-seeded)
   - `INGEST_SECRET`: the same value as `SHEET_INGEST_SECRET` in `.env.local`
5. **Exactly one pair of triggers** (On form submit, On edit). Check at [script.google.com/home/triggers](https://script.google.com/home/triggers). Leftover triggers from an older script keep calling old addresses; delete them.
6. **One event per Sheet.**

The script syncs each new form submission and edits to any data column except `Sync Status`. Re-paste the updated `apps-script/Code.gs` into the Sheet's Apps Script editor. To sync a row again, edit any cell in it or use **Sync now**.

A college Google Workspace account may block Apps Script from contacting outside servers (every sync shows `ERROR`). If so, use the club's personal Google account.

---

## Letting Google reach your laptop

Google's servers need a public HTTPS address to reach the app on your laptop. A **Cloudflare quick tunnel** provides one, free, with no account.

1. **Start the tunnel** in its own terminal tab and **leave it running**:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
   It prints an address like `https://defend-excessive-tower-lil.trycloudflare.com`.
2. **Check that it reaches your app** (with `pnpm dev` running):
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<your-tunnel>.trycloudflare.com/api/ingest/sheet -H "Content-Type: application/json" -d '{}'
   ```
   `401` is correct: the route is reachable and refuses unsigned requests. `502` means `pnpm dev` isn't running.
3. **Point the Sheet at it.** Set `CONFIG.ENDPOINT` to `https://<your-tunnel>.trycloudflare.com/api/ingest/sheet`, run **`updateEndpoint`**, then **`showEndpoint`** to confirm.
4. **Optional:** to open pass pages on your phone through the tunnel, set this in `.env.local` and restart `pnpm dev`:
   ```bash
   DEV_PUBLIC_HOST=<your-tunnel>.trycloudflare.com
   ```
   Then replace `http://localhost:3000` with the tunnel address in a pass link.

**The address changes every time `cloudflared` restarts,** including after a reboot. When it does, repeat steps 2–4. For a demo, start it once beforehand and leave it running.

Keep `NEXT_PUBLIC_APP_ORIGIN=http://localhost:3000`. QR codes then match the laptop scanner; the tunnel is only for the Sheet and for viewing pass pages on your phone.

**Why not something permanent?**
- **Tailscale Funnel** gives a fixed URL and worked from a browser, but Google Apps Script refused it with `Address unavailable`.
- **ngrok's free static domain** is stable but shows a warning page to browsers.
- **The permanent fix is either of these.** Once the club owns a domain (we'll need one for Resend anyway), we could use a named Cloudflare tunnel on something like `dev.yourclub.ca`. Or, deploy to Vercel ([docs/launch-checklist.md](docs/launch-checklist.md)): the Sheet then points at a fixed Vercel address and no tunnel is needed.

---

## Troubleshooting

### `Sync Status` in the Sheet

| It says | Meaning | Fix |
|---------|---------|-----|
| `CREATED …` | New pending applicant imported | — |
| `UPDATED …` | Applicant details updated | — |
| `UNCHANGED …` | Applicant details have not changed | — |
| `PASS_QUEUED …` | An accepted person's email changed; their pass is being re-sent | — |
| `ERROR HTTP 502` | The tunnel is up but the app isn't answering | Start `pnpm dev` |
| `ERROR HTTP 401` | Secret mismatch, or your Mac's clock is off by more than 5 minutes | Compare `INGEST_SECRET` with `grep SHEET_INGEST_SECRET .env.local`; run `updateEndpoint` |
| `ERROR HTTP 404` | `EVENT_SLUG` names an event that doesn't exist | Run `showEndpoint`; then either `pnpm seed`, or fix `CONFIG` and run `updateEndpoint` |
| `ERROR … DNS error: …trycloudflare.com` | The Sheet uses an old tunnel address | New address into `CONFIG`, run `updateEndpoint` |
| `ERROR … Address unavailable` | Google can't reach that address (seen with Tailscale Funnel) | Use a Cloudflare tunnel |
| `INVALID:external_id` | The row has no Applicant ID | Run `backfillApplicantIds` |
| `INVALID:<field>` | That cell is missing or malformed | Fix the cell, edit the row or use **Sync now** |
| No change at all | The trigger didn't run | Apps Script → **Executions**; check [your triggers](https://script.google.com/home/triggers) |

`ERROR` results end with a timestamp (UTC), so you can tell a fresh error from an old one.

### In the app

| Problem | Fix |
|---------|-----|
| "Organizer access only" | Sign in again as the right account. Invites are picked up at every sign-in. If it persists, grant the role in Studio (`http://127.0.0.1:54323`), SQL editor, with the query below. |
| No `.mail/qr` folder after someone answers Yes to an RSVP | Check that the RSVP was accepted and the pass email was sent. If `.mail/` has `.eml` files but no `qr/` folder, restart `pnpm dev`. |
| Every scan says "Not a Datathon code" | `NEXT_PUBLIC_APP_ORIGIN` must be exactly `http://localhost:3000` with no trailing slash, and you must scan from `localhost:3000`. Restart `pnpm dev` after changing it. |
| Every scan says "Unknown code" | The QR image is from before the last `pnpm db:reset`. Use fresh images. |
| "Checkpoint closed" | Open it on the Checkpoints tab. |
| `SUPABASE_SERVICE_ROLE_KEY is not set` | `.env.local` is missing its keys. Redo "First time only". |

Query to grant the organizer role:

```sql
insert into event_staff (event_id, user_id, role)
select e.id, u.id, 'organizer' from events e, auth.users u
where e.slug = 'demo' and u.email = 'organizer@example.test'
on conflict (event_id, user_id) do update set role = 'organizer';
```

---

## Tests

| Command | Runs |
|---------|------|
| `pnpm check` | Typecheck, lint, unit tests, integration tests (needs `supabase start`) |
| `pnpm test:unit` | Fast, no database |
| `pnpm test:int` | Against the local database |
| `pnpm test:e2e` | Playwright browser tests |

Test names start with the SPEC ID they cover (e.g. `T-SCAN-11`), so you can look up what each one is supposed to prove.
