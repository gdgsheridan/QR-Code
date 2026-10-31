import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateToken, sha256hex } from '@/lib/domain/token';
import { emailKey } from '@/lib/pass/handlers';
import { createRsvpHandler, type RsvpDeps } from '@/lib/rsvp/handlers';
import { adminClient } from '../fixtures/admin-api';
import { requireEnv } from '../fixtures/db';
import { drainUntilIdle } from '@/lib/email/drain';
import { mockProvider, onlyEmailTo, rsvpTokenFromEmail, serviceClient } from '../fixtures/mail';
import { signInAs } from '../fixtures/staff';
import { createAccount, createStandardFixture, STAFF_PASSWORD, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
let org: string;
const admin = adminClient();
beforeAll(async () => {
  f = await createStandardFixture();
  org = await signInAs(f.staffEmail.org1);
});
afterAll(async () => {
  await f.close();
});

const anon = () =>
  createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'), { auth: { persistSession: false } });
const canSignIn = async (email: string, password: string) => !(await anon().auth.signInWithPassword({ email, password })).error;
const signIns: Array<{ email: string; password: string }> = [];
const drains: string[] = [];
const deps: RsvpDeps = {
  db: serviceClient(),
  scheduleDrain: () => drains.push('scheduled'),
  drain: async () => undefined,
  signIn: async (email, password) => {
    signIns.push({ email, password });
    return (await canSignIn(email, password)) ? { next: '/me' } : 'wrong';
  },
};
const handler = createRsvpHandler(deps);
let ip = 0;
const nextIp = () => `10.9.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`;
const request = (body: unknown, from = nextIp(), type = 'application/json') =>
  new Request('http://localhost/api/rsvp', { method: 'POST', headers: { 'content-type': type, 'x-forwarded-for': from }, body: JSON.stringify(body) });
const call = async (body: unknown, from = nextIp(), h = handler) => {
  const res = await h(request(body, from));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
// Fills a per-email limit bucket for this window and the next, so a window boundary can't reset it mid-test.
const fillBucket = (key: string) =>
  f.pool.query(
    `insert into rate_limits (key, window_start, hits)
     select $1, to_timestamp(floor(extract(epoch from now()) / 900) * 900) + make_interval(secs => 900 * g), 10 from generate_series(0, 1) g
     on conflict (key, window_start) do update set hits = 10`,
    [key],
  );

async function newApplicant(label: string): Promise<{ id: string; email: string }> {
  const email = `${label}-${f.slug}@example.test`;
  const { rows } = await f.pool.query<{ id: string }>(
    `insert into participants (event_id, email, first_name, search_text, status, source) values ($1, $2, 'Rae', 'rae', 'pending', 'sheet') returning id`,
    [f.e1.id, email],
  );
  return { id: rows[0]?.id ?? '', email };
}
// An RSVP link as if just emailed: the token's hash is stored on the participant.
async function rsvpToken(participantId: string): Promise<string> {
  const token = generateToken();
  await f.pool.query('update participants set rsvp_token_hash = $2 where id = $1', [participantId, sha256hex(token)]);
  return token;
}
// v0.6: Yes always carries the emergency contact (F13 step 4).
const CONTACT = { emergencyName: 'Sam Lee', emergencyPhone: '416 555 0100' };
// v0.7.2: Yes always carries a password (set on the first Yes, then their own).
const YES = { ...CONTACT, password: 'rae-event-password' };
const outbox = async (id: string) =>
  (await f.pool.query<{ kind: string; status: string }>('select kind, status from email_outbox where participant_id = $1 order by created_at', [id])).rows;
const statusOf = async (id: string) => (await f.pool.query<{ status: string }>('select status from participants where id = $1', [id])).rows[0]?.status;

describe('RSVP (SPEC F13, v0.4)', () => {
  it('T-RSVP-01: organizers queue RSVPs only for this event\'s undeleted, not-yet-accepted people; volunteers get 403', async () => {
    const fresh = await newApplicant('fresh');
    const gone = await newApplicant('gone');
    await f.pool.query('update participants set deleted_at = now() where id = $1', [gone.id]);
    const ids = [f.p.C, fresh.id, f.p.A, gone.id, f.p.X];

    const vol = await signInAs(f.staffEmail.vol1);
    expect((await admin.call('sendRsvps', vol, { slug: f.slug }, { body: { ids } })).status).toBe(403);
    expect((await admin.call('sendRsvps', org, { slug: f.slug }, { body: { ids: [], extra: 1 } })).status).toBe(400);

    const res = await admin.call('sendRsvps', org, { slug: f.slug }, { body: { ids } });
    expect(res.body).toEqual({ queued: 2 });
    expect(admin.scheduled.length).toBeGreaterThan(0);
    expect(await outbox(f.p.C)).toEqual([{ kind: 'rsvp', status: 'pending' }]);
    expect(await outbox(fresh.id)).toEqual([{ kind: 'rsvp', status: 'pending' }]);
    for (const id of [gone.id, f.p.X]) expect(await outbox(id)).toEqual([]);
    const { rows } = await f.pool.query<{ detail: unknown }>(`select detail from audit_log where action = 'rsvp.send' and event_id = $1`, [f.e1.id]);
    expect(rows.map((r) => r.detail)).toEqual([{ count: 2 }]);
  });

  it('T-RSVP-02: the drainer stores the RSVP hash before sending, links /rsvp#token, and cancels for the accepted or deleted', async () => {
    // What the database holds at the moment the provider is called (I-10 pattern).
    const atSend: string[] = [];
    const mail = mockProvider(async (m) => {
      const { rows } = await f.pool.query<{ h: string | null }>('select rsvp_token_hash as h from participants where email = $1', [m.to]);
      atSend.push(rows[0]?.h ?? '');
    });
    const drain = () =>
      drainUntilIdle({ db: serviceClient(), provider: mail.provider, appOrigin: 'http://localhost:3100', from: 'Station <p@localhost>', passSecret: requireEnv('PASS_TOKEN_SECRET') });
    const fresh = await newApplicant('drain');
    const late = await newApplicant('late');
    await f.pool.query(`insert into email_outbox (participant_id, kind) values ($1, 'rsvp'), ($2, 'rsvp')`, [fresh.id, late.id]);
    await f.pool.query(`update participants set status = 'accepted' where id = $1`, [late.id]);

    await drain();
    const sent = onlyEmailTo(mail.sent, fresh.email);
    const token = rsvpTokenFromEmail(sent);
    expect(sent.html).toContain(`/rsvp#${token}`);
    expect(sent.subject).toMatch(/^You're invited: /);
    expect(atSend.at(mail.sent.indexOf(sent))).toBe(sha256hex(token));
    expect(await outbox(fresh.id)).toEqual([{ kind: 'rsvp', status: 'sent' }]);
    expect(await outbox(late.id)).toEqual([{ kind: 'rsvp', status: 'cancelled' }]);
    expect(mail.sent.filter((m) => m.to === late.email)).toEqual([]);
  });

  it('T-RSVP-03: Yes accepts and queues one pass (repeat-safe); No withdraws and revokes; bad tokens and bodies are refused', async () => {
    const p = await newApplicant('yes');
    const token = await rsvpToken(p.id);

    const look = await call({ token });
    expect(look.status).toBe(200);
    expect(look.body).toMatchObject({ firstName: 'Rae', status: 'pending', hasAccount: false, event: { name: f.e1.name } });
    expect(JSON.stringify(look.body)).not.toContain('@');

    expect((await call({ token, going: true, ...YES })).body).toEqual({ code: 'GOING', signedIn: true, next: '/me' });
    expect((await call({ token, going: true, ...YES })).body).toEqual({ code: 'GOING', signedIn: true, next: '/me' });
    expect(await statusOf(p.id)).toBe('accepted');
    expect(await outbox(p.id)).toEqual([{ kind: 'pass_issued', status: 'pending' }]);
    expect(drains).toEqual(['scheduled', 'scheduled']);

    expect((await call({ token, going: false })).body).toEqual({ code: 'NOT_GOING', signedIn: false });
    expect(await statusOf(p.id)).toBe('withdrawn');
    expect(await outbox(p.id)).toEqual([{ kind: 'pass_issued', status: 'cancelled' }]);
    const { rows } = await f.pool.query<{ action: string }>(`select action from audit_log where subject_id = $1 order by id`, [p.id]);
    expect(rows.map((r) => r.action)).toEqual(['rsvp.yes', 'rsvp.no']);

    // Unknown token: the same 404 as /api/pass. Ended event: the link no longer works.
    expect(await call({ token: generateToken() })).toEqual({ status: 404, body: { state: 'not_found' } });
    const ended = await rsvpToken(f.p.X);
    await f.pool.query(`update events set starts_at = now() - interval '2 days', ends_at = now() - interval '1 day' where id = $1`, [f.e2.id]);
    expect((await call({ token: ended, going: true, ...YES })).status).toBe(404);
    expect((await call({ token, going: 'yes' })).status).toBe(400);
    expect((await call({ token, extra: 1 })).status).toBe(400);

    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await call({ token: generateToken() }, '10.200.0.1')).status);
    expect(statuses.at(-1)).toBe(429);
  });

  it('T-RSVP-03 (review): Yes again after an organizer revoked the pass, or No then Yes, queues no new pass', async () => {
    const p = await newApplicant('revoked');
    const token = await rsvpToken(p.id);
    await call({ token, going: true, ...YES });
    await f.pool.query(`update email_outbox set status = 'sent' where participant_id = $1`, [p.id]);
    await f.pool.query(`select issue_pass($1, $2)`, [p.id, sha256hex(generateToken())]);
    expect((await f.pool.query<{ r: string }>('select revoke_pass($1, $2, $3) as r', [f.e1.id, p.id, f.staff.org1])).rows[0]?.r).toBe('REVOKED');

    expect((await call({ token, going: true, ...YES })).body).toMatchObject({ code: 'GOING' });
    expect((await call({ token, going: false })).body).toMatchObject({ code: 'NOT_GOING' });
    expect((await call({ token, going: true, ...YES })).body).toMatchObject({ code: 'GOING' });
    const pending = (await outbox(p.id)).filter((o) => o.status === 'pending');
    expect(pending).toEqual([]);
  });

  it('T-RSVP-02 (review): an RSVP job cancelled after it was claimed does not rotate the token', async () => {
    const p = await newApplicant('raced');
    const old = await rsvpToken(p.id);
    const { rows } = await f.pool.query<{ id: string }>(
      `insert into email_outbox (participant_id, kind, status, locked_until) values ($1, 'rsvp', 'sending', now() + interval '2 minutes') returning id`,
      [p.id],
    );
    const job = rows[0]?.id;
    await call({ token: old, going: false }); // answers No with the previous link: cancels the job
    const fresh = sha256hex(generateToken());
    // v0.9: set_rsvp_token answers when the invitation closes, or null when it refuses.
    expect((await f.pool.query<{ ok: unknown }>('select set_rsvp_token($1, $2) as ok', [job, fresh])).rows[0]?.ok).toBeNull();
    expect((await f.pool.query<{ h: string }>('select rsvp_token_hash as h from participants where id = $1', [p.id])).rows[0]?.h).toBe(sha256hex(old));
  });

  it('T-RSVP-03 (review): No also unlinks their badge, like every other pass revocation (§6.5)', async () => {
    const p = await newApplicant('badge');
    const token = await rsvpToken(p.id);
    await call({ token, going: true, ...YES });
    await f.linkBadge(p.id);
    await call({ token, going: false });
    expect((await f.pool.query('select 1 from badges where participant_id = $1', [p.id])).rows).toEqual([]);
  });

  it('T-RSVP-03 (review): queueing an RSVP while that person answers never deadlocks', async () => {
    const people = await Promise.all(Array.from({ length: 20 }, (_, i) => newApplicant(`race${i}`)));
    const tokens = await Promise.all(people.map((p) => rsvpToken(p.id)));
    const results = await Promise.allSettled(
      people.flatMap((p, i) => [
        f.pool.query('select queue_rsvps($1, $2, $3)', [f.e1.id, [p.id], f.staff.org1]),
        f.pool.query('select rsvp_respond($1, true)', [sha256hex(tokens[i] ?? '')]),
      ]),
    );
    expect(results.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);
  });

  it('T-AUTH-05 (review): a signed-in user cannot switch their account to someone else\'s email on their own', async () => {
    const mine = `switcher-${f.slug}@example.test`;
    await createAccount(mine);
    const victim = await newApplicant('victim');
    const client = anon();
    expect((await client.auth.signInWithPassword({ email: mine, password: STAFF_PASSWORD })).error).toBeNull();
    await client.auth.updateUser({ email: victim.email });
    const { rows } = await f.pool.query<{ email: string }>('select email from auth.users where email in ($1, $2)', [mine, victim.email]);
    expect(rows).toEqual([{ email: mine }]);
  });

  it('T-RSVP-04: Yes always needs a password: without an account it creates one and signs in; with one it must be theirs and never changes', async () => {
    const weak = await newApplicant('weak');
    const weakToken = await rsvpToken(weak.id);
    expect(await call({ token: weakToken, going: true, ...CONTACT })).toEqual({ status: 400, body: { error: 'password_required' } });
    expect(await call({ token: weakToken, going: true, ...CONTACT, password: 'short' })).toEqual({ status: 400, body: { error: 'weak_password' } });
    expect(await statusOf(weak.id)).toBe('pending');
    expect((await f.pool.query('select 1 from auth.users where email = $1', [weak.email])).rows).toHaveLength(0);

    const p = await newApplicant('new');
    const token = await rsvpToken(p.id);
    expect((await call({ token, going: true, ...CONTACT, password: 'my-event-password' })).body).toEqual({ code: 'GOING', signedIn: true, next: '/me' });
    expect(signIns.at(-1)).toEqual({ email: p.email, password: 'my-event-password' });
    const { rows } = await f.pool.query<{ confirmed: boolean }>('select email_confirmed_at is not null as confirmed from auth.users where email = $1', [p.email]);
    expect(rows).toEqual([{ confirmed: true }]);
    expect((await call({ token })).body).toMatchObject({ status: 'accepted', hasAccount: true });

    // Already has an account: their own password is required, checked like a sign-in, and never changed.
    const existing = await newApplicant('existing');
    await createAccount(existing.email);
    const t2 = await rsvpToken(existing.id);
    expect((await call({ token: t2 })).body).toMatchObject({ hasAccount: true });
    expect(await call({ token: t2, going: true, ...CONTACT })).toEqual({ status: 400, body: { error: 'password_required' } });
    expect(await call({ token: t2, going: true, ...CONTACT, password: 'attacker-password' })).toEqual({ status: 400, body: { error: 'wrong_password' } });
    expect(await statusOf(existing.id)).toBe('pending');
    expect((await call({ token: t2, going: true, ...CONTACT, password: STAFF_PASSWORD })).body).toEqual({ code: 'GOING', signedIn: true, next: '/me' });
    expect(await canSignIn(existing.email, STAFF_PASSWORD)).toBe(true);
    expect(await canSignIn(existing.email, 'attacker-password')).toBe(false);

    // Its own per-email limit (§15: 10 per 15 min): past it, even the right password is refused. /login's
    // bucket doesn't count here, so nobody can block someone's Yes by burning their /login tries.
    const limited = await newApplicant('limited');
    await createAccount(limited.email);
    const t3 = await rsvpToken(limited.id);
    await fillBucket(emailKey('rsvp-signin', limited.email));
    const signInsBefore = signIns.length;
    expect(await call({ token: t3, going: true, ...CONTACT, password: STAFF_PASSWORD })).toEqual({ status: 400, body: { error: 'wrong_password' } });
    expect(signIns.length).toBe(signInsBefore); // the limit is checked before GoTrue is asked
    expect(await statusOf(limited.id)).toBe('pending');
    const blocked = await newApplicant('login-blocked');
    await createAccount(blocked.email);
    await fillBucket(emailKey('signin', blocked.email));
    expect((await call({ token: await rsvpToken(blocked.id), going: true, ...CONTACT, password: STAFF_PASSWORD })).body).toEqual({ code: 'GOING', signedIn: true, next: '/me' });
  });

  it('T-RSVP-04 (review): an account made since the lookup still needs its password; a sign-in failure is not a wrong password; JSON only', async () => {
    // The lookup saw no account, then one appeared before createUser (email_exists): its own password is needed.
    const raced = await newApplicant('raced-account');
    const racingFor = (email: string) => createRsvpHandler({
      ...deps,
      db: new Proxy(deps.db, {
        get(target, key) {
          if (key !== 'rpc') return Reflect.get(target, key);
          return async (name: string, args: unknown) => {
            const rpc = target.rpc.bind(target) as unknown as (n: string, a: unknown) => Promise<{ data: unknown; error: unknown }>;
            const res = await rpc(name, args);
            if (name !== 'rsvp_lookup' || !res.data) return res;
            await createAccount(email);
            return { ...res, data: { ...(res.data as object), hasAccount: false } };
          };
        },
      }),
    });
    expect(await call({ token: await rsvpToken(raced.id), going: true, ...CONTACT, password: 'attacker-password' }, nextIp(), racingFor(raced.email))).toEqual({
      status: 400,
      body: { error: 'wrong_password' },
    });
    expect(await statusOf(raced.id)).toBe('pending');
    // A real double tap (same person, same password) just goes through.
    const tapped = await newApplicant('double-tap');
    expect((await call({ token: await rsvpToken(tapped.id), going: true, ...CONTACT, password: STAFF_PASSWORD }, nextIp(), racingFor(tapped.email))).body).toEqual({
      code: 'GOING',
      signedIn: true,
      next: '/me',
    });

    // GoTrue itself failing (rate limit, 5xx) is an error, not "wrong password", and changes nothing.
    const flaky = await newApplicant('gotrue-down');
    await createAccount(flaky.email);
    const down = createRsvpHandler({ ...deps, signIn: async () => 'error' });
    await expect(down(request({ token: await rsvpToken(flaky.id), going: true, ...CONTACT, password: STAFF_PASSWORD }))).rejects.toThrow();
    expect(await statusOf(flaky.id)).toBe('pending');

    // Staff who still need a display name: the server passes /login's landing (onboarding) through.
    const staffer = await newApplicant('onboarding');
    await createAccount(staffer.email);
    const onboarding = createRsvpHandler({ ...deps, signIn: async () => ({ next: '/onboarding?next=%2Fme' }) });
    expect((await call({ token: await rsvpToken(staffer.id), going: true, ...CONTACT, password: STAFF_PASSWORD }, nextIp(), onboarding)).body).toEqual({
      code: 'GOING',
      signedIn: true,
      next: '/onboarding?next=%2Fme',
    });

    // A new account whose sign-in throws after its answer is recorded keeps the answer (signedIn: false).
    const late = await newApplicant('late-sign-in');
    const throwing = createRsvpHandler({
      ...deps,
      signIn: async () => {
        throw new Error('landing failed');
      },
    });
    expect((await call({ token: await rsvpToken(late.id), going: true, ...CONTACT, password: 'late-event-password' }, nextIp(), throwing)).body).toEqual({
      code: 'GOING',
      signedIn: false,
    });
    expect(await statusOf(late.id)).toBe('accepted');

    // A cross-site form can only send text/plain (or form) bodies: refused before anything happens.
    const csrf = await newApplicant('csrf');
    const res = await handler(request({ token: await rsvpToken(csrf.id), going: true, ...CONTACT, password: STAFF_PASSWORD }, nextIp(), 'text/plain'));
    expect({ status: res.status, body: await res.json() }).toEqual({ status: 400, body: { error: 'invalid_body' } });
    expect(await statusOf(csrf.id)).toBe('pending');
  });

  it('T-RSVP-06: Yes needs only a password (v0.9: the profile is set up after); fields it does carry are checked before anything changes', async () => {
    const p = await newApplicant('form');
    const token = await rsvpToken(p.id);
    const bad: Array<[Record<string, unknown>, string]> = [
      [{ emergencyName: 'Sam Lee' }, 'emergencyPhone'],
      [{ ...CONTACT, emergencyPhone: 'call me' }, 'emergencyPhone'],
      [{ linkedin: 'linkedin.com/company/x' }, 'linkedin'],
      [{ dietaryNotes: 'd'.repeat(501) }, 'dietaryNotes'],
    ];
    for (const [form, field] of bad) {
      expect(await call({ token, going: true, password: 'my-event-password', ...form })).toEqual({ status: 400, body: { error: 'invalid_profile', field } });
    }
    expect((await call({ token, going: true, emergencyName: 1 })).status).toBe(400);
    expect(await statusOf(p.id)).toBe('pending');
    expect((await f.pool.query('select 1 from auth.users where email = $1', [p.email])).rows).toHaveLength(0);
    expect((await call({ token, going: false })).body).toMatchObject({ code: 'NOT_GOING' }); // No needs no form
    expect((await call({ token, going: true, password: 'my-event-password' })).body).toMatchObject({ code: 'GOING' });
    expect((await f.pool.query('select emergency_name from participants where id = $1', [p.id])).rows).toEqual([{ emergency_name: null }]);
  });

  it('T-RSVP-07: Yes stores the emergency contact and networking profile with the answer; the lookup prefills only dietary notes and LinkedIn', async () => {
    const p = await newApplicant('full');
    await f.pool.query(`update participants set dietary_notes = 'Vegetarian', linkedin_url = 'https://www.linkedin.com/in/from-sheet' where id = $1`, [p.id]);
    const token = await rsvpToken(p.id);
    const look = await call({ token });
    // v0.9: sharing is on by default.
    expect(look.body).toMatchObject({ profile: { dietaryNotes: 'Vegetarian', linkedinUrl: 'https://www.linkedin.com/in/from-sheet', profilePublic: true } });
    expect(JSON.stringify(look.body)).not.toMatch(/@|emergency/i);

    const yes = { ...YES, emergencyRelation: 'Sister', dietaryNotes: 'Vegetarian', linkedin: 'linkedin.com/in/rae-r', profilePublic: true };
    expect((await call({ token, going: true, ...yes })).body).toEqual({ code: 'GOING', signedIn: true, next: '/me' });
    const row = async () =>
      (
        await f.pool.query(
          `select status, emergency_name, emergency_phone, emergency_relation, dietary_notes, dietary_set_at is not null as own_dietary,
                  linkedin_url, linkedin_set_at is not null as own_linkedin, profile_public
             from participants where id = $1`,
          [p.id],
        )
      ).rows[0];
    const saved = {
      status: 'accepted', emergency_name: 'Sam Lee', emergency_phone: '416 555 0100', emergency_relation: 'Sister',
      dietary_notes: 'Vegetarian', own_dietary: false, // unchanged from the Sheet: the Sheet keeps it
      linkedin_url: 'https://www.linkedin.com/in/rae-r', own_linkedin: true, profile_public: true,
    };
    expect(await row()).toEqual(saved);
    // Never the contact. Exact values: a bare /555/ also matched random slugs and timestamps (~1% of runs).
    expect(JSON.stringify((await call({ token })).body)).not.toMatch(/Sam Lee|416 555 0100|Sister/);

    // An answer without the form (SQL) leaves the profile as it is; so does No.
    await f.pool.query('select rsvp_respond($1, true)', [sha256hex(token)]);
    expect(await row()).toEqual(saved);
    await call({ token, going: false, ...YES, emergencyName: 'Someone Else' });
    expect(await row()).toEqual({ ...saved, status: 'withdrawn' });
  });
});
