import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthApiError } from '@supabase/supabase-js';
import { adminClient, obj } from '../fixtures/admin-api';
import { onlyEmailTo, sentTo, serviceClient } from '../fixtures/mail';
import { signInAs } from '../fixtures/staff';
import { createAccount, createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
let org: string;
const c = adminClient();
beforeAll(async () => {
  f = await createStandardFixture();
  org = await signInAs(f.staffEmail.org1);
});
afterAll(async () => {
  await f.close();
});

describe('staff admin (SPEC F9)', () => {
  it('F9: inviting an existing user adds them directly; a new email becomes a pending invite (normalized)', async () => {
    const existing = await c.call('inviteStaff', org, { slug: f.slug }, { body: { email: f.staffEmail.vol3.toUpperCase(), role: 'volunteer' } });
    expect(existing.body).toEqual({ code: 'INVITED', emailed: true });
    const fresh = await c.call('inviteStaff', org, { slug: f.slug }, { body: { email: ` New+${f.slug}@Example.TEST `, role: 'organizer' } });
    // T-AUTH-03 (I): a new address also gets an email from the auth server to set a password.
    expect(fresh.body).toEqual({ code: 'INVITED', emailed: true });
    const { rows: accounts } = await f.pool.query('select 1 from auth.users where email = $1', [`new+${f.slug}@example.test`]);
    expect(accounts).toHaveLength(1);
    const list = await c.call('listStaff', org, { slug: f.slug });
    const staff = obj(list.body).staff as Array<{ userId: string; role: string; displayName: string | null }>;
    expect(staff.find((s) => s.userId === f.staff.vol3)).toMatchObject({ role: 'volunteer', displayName: 'Vol Three' });
    expect(obj(list.body).invites).toEqual([{ email: `new+${f.slug}@example.test`, role: 'organizer' }]);
    expect((await c.call('inviteStaff', org, { slug: f.slug }, { body: { email: 'nope', role: 'volunteer' } })).status).toBe(400);
    const cancelled = await c.call('cancelInvite', org, { slug: f.slug, email: `new+${f.slug}@example.test` }, { method: 'DELETE' });
    expect(cancelled.status).toBe(200);
  });

  it('F9 (v0.4): re-inviting an invited-but-not-signed-in address as volunteer drops the old organizer invite', async () => {
    const email = `twice-${f.slug}@example.test`;
    expect((await c.call('inviteStaff', org, { slug: f.slug }, { body: { email, role: 'organizer' } })).body).toMatchObject({ code: 'INVITED' });
    // The invite email made an account (no password yet), so the second invite adds them directly.
    expect((await c.call('inviteStaff', org, { slug: f.slug }, { body: { email, role: 'volunteer' } })).body).toEqual({ code: 'INVITED', emailed: true });
    const { rows: invites } = await f.pool.query('select role from staff_invites where event_id = $1 and email = $2', [f.e1.id, email]);
    expect(invites).toEqual([]);
    const { rows: users } = await f.pool.query<{ id: string }>('select id from auth.users where email = $1', [email]);
    // M3: consuming needs a confirmed email; the invite link confirms it in the real flow.
    await f.pool.query('update auth.users set email_confirmed_at = now() where id = $1', [users[0]?.id]);
    await f.pool.query('select consume_staff_invites($1, $2)', [users[0]?.id, email]);
    const { rows } = await f.pool.query('select role from event_staff where event_id = $1 and user_id = $2', [f.e1.id, users[0]?.id]);
    expect(rows).toEqual([{ role: 'volunteer' }]);
  });

  it('T-AUTH-03 (I): adding an existing account (a hacker who said Yes) emails them a Sign in link through the outbox', async () => {
    const { rows } = await f.pool.query<{ email: string }>('select email from participants where id = $1', [f.p.A]);
    const email = rows[0]?.email ?? '';
    const userId = await createAccount(email); // what an RSVP Yes does (F13)
    const scheduled = c.scheduled.length;
    expect((await c.call('inviteStaff', org, { slug: f.slug }, { body: { email, role: 'volunteer' } })).body).toEqual({ code: 'INVITED', emailed: true });
    // Queued, then drained after the response, never sent inside the request.
    expect(c.scheduled.length).toBe(scheduled + 1);
    expect(sentTo(c.mail.sent, email)).toHaveLength(0);
    await c.drain();
    const mail = onlyEmailTo(c.mail.sent, email);
    expect(mail.subject).toBe(`You’re now a volunteer for ${f.e1.name}`);
    expect(mail.text).toContain(`http://localhost:3100/login?next=/scan/${f.slug}`);
    expect(mail.html).toContain(`href="http://localhost:3100/login?next=/scan/${f.slug}"`);
    const { rows: queued } = await f.pool.query('select kind, status, participant_id, event_id from email_outbox where user_id = $1', [userId]);
    expect(queued).toEqual([{ kind: 'staff_added', status: 'sent', participant_id: null, event_id: f.e1.id }]);

    // Made an organizer: the link opens the admin pages.
    await c.call('inviteStaff', org, { slug: f.slug }, { body: { email, role: 'organizer' } });
    await c.drain();
    expect(sentTo(c.mail.sent, email).at(-1)?.text).toContain(`http://localhost:3100/login?next=/admin/${f.slug}`);
    // I-11: the audit row has the role and the result, never the address.
    const { rows: audit } = await f.pool.query<{ detail: unknown }>(
      `select detail from audit_log where action = 'staff.invite' and subject_id = $1 order by id`,
      [userId],
    );
    expect(audit.map((a) => a.detail)).toEqual([{ role: 'volunteer', result: 'ADDED' }, { role: 'organizer', result: 'ADDED' }]);
    // Leaves org1 the only organizer again, for the last-organizer test below.
    expect((await c.call('removeStaff', org, { slug: f.slug, userId }, { method: 'DELETE' })).body).toEqual({ code: 'REMOVED' });
  });

  it('T-AUTH-03 (I): one staff email waits per person and event; removing them before it goes out cancels it', async () => {
    const email = `late-${f.slug}@example.test`;
    const userId = await createAccount(email);
    await c.call('inviteStaff', org, { slug: f.slug }, { body: { email, role: 'volunteer' } });
    await c.call('inviteStaff', org, { slug: f.slug }, { body: { email, role: 'organizer' } });
    const { rows } = await f.pool.query('select status from email_outbox where user_id = $1', [userId]);
    expect(rows).toEqual([{ status: 'pending' }]);
    expect((await c.call('removeStaff', org, { slug: f.slug, userId }, { method: 'DELETE' })).body).toEqual({ code: 'REMOVED' });
    await c.drain();
    expect(sentTo(c.mail.sent, email)).toHaveLength(0);
    expect((await f.pool.query('select status from email_outbox where user_id = $1', [userId])).rows).toEqual([{ status: 'cancelled' }]);
    // The database keeps each kind's recipient straight.
    await expect(f.pool.query(`insert into email_outbox (kind, event_id) values ('staff_added', $1)`, [f.e1.id])).rejects.toThrow(/check/);
    await expect(f.pool.query(`insert into email_outbox (kind, user_id, event_id) values ('pass_issued', $1, $2)`, [userId, f.e1.id])).rejects.toThrow(/check/);
  });

  it('T-AUTH-03 (I): when the auth server can’t send the invite, the answer says so (emailed: false)', async () => {
    const failing = serviceClient();
    failing.auth.admin.inviteUserByEmail = () => Promise.resolve({ data: { user: null }, error: new AuthApiError('Email rate limit exceeded', 429, 'over_email_send_rate_limit') });
    const fc = adminClient({ db: failing });
    const r = await fc.call('inviteStaff', org, { slug: f.slug }, { body: { email: `ratelimited-${f.slug}@example.test`, role: 'volunteer' } });
    expect(r.body).toEqual({ code: 'INVITED', emailed: false });
  });

  it('F9: removing a volunteer takes effect on their next scan; the last organizer cannot be removed', async () => {
    expect((await c.call('removeStaff', org, { slug: f.slug, userId: f.staff.vol2 }, { method: 'DELETE' })).body).toEqual({ code: 'REMOVED' });
    expect((await f.scan({ cp: f.cp.D, staff: f.staff.vol2, token: f.token.A })).code).toBe('FORBIDDEN');
    const last = await c.call('removeStaff', org, { slug: f.slug, userId: f.staff.org1 }, { method: 'DELETE' });
    expect(last.status).toBe(409);
    expect(last.body).toEqual({ code: 'LAST_ORGANIZER' });
  });
});
