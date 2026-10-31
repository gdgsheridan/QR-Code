import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sha256hex } from '@/lib/domain/token';
import { drainOutbox, drainUntilIdle, type DrainOptions } from '@/lib/email/drain';
import { ProviderError, type EmailProvider } from '@/lib/email/provider';
import { requireEnv } from '../fixtures/db';
import { mockProvider, onlyEmailTo, sentTo, serviceClient, tokenFromEmail } from '../fixtures/mail';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
beforeEach(async () => {
  f = await createStandardFixture({ poolSize: 6 });
});
afterEach(async () => {
  await f.close();
});

const db = serviceClient();
// Until idle: rows other files left due would otherwise crowd this test's row out of a 20-row batch.
const drain = (provider: EmailProvider, extra: Partial<DrainOptions> = {}) =>
  drainUntilIdle({ db, provider, appOrigin: 'http://localhost:3100', from: 'Station <passes@localhost>', passSecret: requireEnv('PASS_TOKEN_SECRET'), ...extra });

async function enqueue(participantId: string, kind = 'pass_issued'): Promise<string> {
  const { rows } = await f.pool.query<{ id: string }>(
    'insert into email_outbox (participant_id, kind) values ($1, $2) returning id',
    [participantId, kind],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('enqueue failed');
  return id;
}

async function outboxRow(id: string) {
  const { rows } = await f.pool.query<{
    status: string;
    attempts: number;
    wait_s: number;
    last_error: string | null;
    provider_message_id: string | null;
    sent: boolean;
  }>(
    `select status, attempts, extract(epoch from next_attempt_at - now())::float as wait_s, last_error,
            provider_message_id, sent_at is not null as sent
       from email_outbox where id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error('no outbox row');
  return row;
}

async function emailOf(participantId: string): Promise<string> {
  const { rows } = await f.pool.query<{ email: string }>('select email from participants where id = $1', [participantId]);
  return rows[0]?.email ?? '';
}

const makeDue = (id: string) => f.pool.query('update email_outbox set next_attempt_at = now() where id = $1', [id]);

describe('outbox drain (SPEC F4)', () => {
  it('T-MAIL-01: two concurrent drainers over 50 pending rows send each exactly once', async () => {
    const people = await Promise.all(Array.from({ length: 50 }, () => f.addParticipant(f.e1.id, { withPass: false })));
    const ids = await Promise.all(people.map((p) => enqueue(p.id)));
    const { provider, sent } = mockProvider(() => new Promise((r) => setTimeout(r, 5)));
    const opts = { db, provider, appOrigin: 'http://localhost:3100', from: 'Station <passes@localhost>', passSecret: requireEnv('PASS_TOKEN_SECRET') };
    const loop = async () => {
      for (;;) {
        const r = await drainOutbox(opts);
        if (r.claimed === 0) return;
      }
    };
    await Promise.all([loop(), loop()]);
    const mine = new Set(people.map((p) => p.id));
    const { rows } = await f.pool.query<{ email: string; id: string }>('select id, email from participants where id = any($1)', [
      [...mine],
    ]);
    const emails = new Set(rows.map((r) => r.email));
    const toMine = sent.filter((m) => emails.has(m.to));
    expect(toMine).toHaveLength(50);
    expect(new Set(toMine.map((m) => m.to)).size).toBe(50);
    for (const id of ids) expect((await outboxRow(id)).status).toBe('sent');
  });

  it('T-MAIL-02: at provider-call time, the emailed token is already an active committed pass', async () => {
    const person = await f.addParticipant(f.e1.id, { withPass: false });
    await enqueue(person.id);
    const observed: Array<string | null | undefined> = [];
    const address = await emailOf(person.id);
    const { provider } = mockProvider(async (m) => {
      if (m.to !== address) return;
      // A separate connection: only committed data is visible here.
      const { rows } = await f.pool.query<{ revoked_at: string | null }>('select revoked_at from passes where token_hash = $1', [
        sha256hex(tokenFromEmail(m)),
      ]);
      observed.push(rows.length === 1 ? rows[0]?.revoked_at : 'missing');
    });
    await drain(provider);
    expect(observed).toEqual([null]);
  });

  it('T-MAIL-03: provider 500 every time → attempts 1..5 with 1m/5m/25m/2h backoff, then failed; no email in last_error', async () => {
    const person = await f.addParticipant(f.e1.id, { withPass: false });
    const id = await enqueue(person.id);
    const { provider } = mockProvider((m) => {
      throw new ProviderError(`upstream rejected ${m.to}`, 500);
    });
    const expectedWait = [60, 300, 1500, 7200];
    for (let attempt = 1; attempt <= 5; attempt++) {
      await makeDue(id);
      await drain(provider);
      const row = await outboxRow(id);
      expect(row.attempts).toBe(attempt);
      expect(row.last_error).toMatch(/^HTTP 500/);
      expect(row.last_error).not.toMatch(/@/);
      if (attempt < 5) {
        expect(row.status).toBe('pending');
        expect(row.wait_s).toBeGreaterThan((expectedWait[attempt - 1] ?? 0) - 5);
        expect(row.wait_s).toBeLessThan((expectedWait[attempt - 1] ?? 0) + 5);
      } else {
        expect(row.status).toBe('failed');
      }
    }
  });

  it('T-MAIL-04: provider 429 with Retry-After: 120 → next_attempt_at ≈ now + 120 s', async () => {
    const person = await f.addParticipant(f.e1.id, { withPass: false });
    const id = await enqueue(person.id);
    const { provider } = mockProvider(() => {
      throw new ProviderError('rate limited', 429, 120);
    });
    await drain(provider);
    const row = await outboxRow(id);
    expect(row.status).toBe('pending');
    expect(row.wait_s).toBeGreaterThan(115);
    expect(row.wait_s).toBeLessThan(125);
  });

  it('T-MAIL-05: a claimed row whose drainer crashed is reclaimable once locked_until passes', async () => {
    const person = await f.addParticipant(f.e1.id, { withPass: false });
    const id = await enqueue(person.id);
    await f.pool.query('select * from claim_outbox(20)'); // "crashes": never finishes
    expect((await outboxRow(id)).status).toBe('sending');

    const address = await emailOf(person.id);
    const { provider, sent } = mockProvider();
    await drain(provider);
    expect(sentTo(sent, address)).toHaveLength(0);

    await f.pool.query(`update email_outbox set locked_until = now() - interval '1 second' where id = $1`, [id]);
    await drain(provider);
    const row = await outboxRow(id);
    expect(row).toMatchObject({ status: 'sent', attempts: 2, sent: true });
    expect(sentTo(sent, address)).toHaveLength(1);
  });

  it('T-MAIL-06: participant withdrawn between enqueue and drain → cancelled, no pass, no send', async () => {
    const person = await f.addParticipant(f.e1.id, { withPass: false });
    const id = await enqueue(person.id);
    await f.pool.query(`update participants set status = 'withdrawn' where id = $1`, [person.id]);
    const address = await emailOf(person.id);
    const { provider, sent } = mockProvider();
    await drain(provider);
    expect((await outboxRow(id)).status).toBe('cancelled');
    expect(sentTo(sent, address)).toHaveLength(0);
    const { rows } = await f.pool.query('select 1 from passes where participant_id = $1', [person.id]);
    expect(rows).toHaveLength(0);
  });

  it('T-MAIL-11: organizer resend → new pass active; old token REVOKED with reissued: true', async () => {
    await enqueue(f.p.A, 'pass_reissued');
    const { provider, sent } = mockProvider();
    await drain(provider);
    const fresh = tokenFromEmail(onlyEmailTo(sent, await emailOf(f.p.A)));
    const old = await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: f.token.A });
    expect(old).toMatchObject({ code: 'REVOKED', reissued: true, revokeReason: 'rotated' });
    expect((await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: fresh })).code).toBe('ACCEPTED');
  });
});
