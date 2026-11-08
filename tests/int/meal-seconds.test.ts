import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, obj } from '../fixtures/admin-api';
import { scanApi } from '../fixtures/scan-api';
import { signInAs } from '../fixtures/staff';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// SPEC §8 step 10 and §11 Checkpoints (v0.12, owner's request): a meal in seconds mode serves a hacker again.
let f: StandardFixture;
let org: string;
let vol1: string;
const c = adminClient();
const api = scanApi();
beforeAll(async () => {
  f = await createStandardFixture();
  [org, vol1] = await Promise.all([signInAs(f.staffEmail.org1), signInAs(f.staffEmail.vol1)]);
});
afterAll(async () => {
  await f.close();
});

describe('meal seconds mode (SPEC §8 step 10, v0.12)', () => {
  it('T-SCAN-32: a served hacker is served again at a meal in seconds mode, with nothing new written; the other rules still apply; meals only', async () => {
    const patch = (cp: string, body: Record<string, unknown>) => c.call('updateCheckpoint', org, { slug: f.slug, id: cp }, { method: 'PATCH', body });
    const A = (extra: { clientScanId?: string } = {}) => f.scan({ cp: f.cp.L, staff: f.staff.vol1, participantId: f.p.A, ...extra });
    await f.checkIn(f.p.A);
    const first = await A();
    expect(first.code).toBe('ACCEPTED');
    expect((await A()).code).toBe('ALREADY_SCANNED');

    const on = await patch(f.cp.L, { secondsMode: true });
    expect(on.status).toBe(200);
    expect(obj(obj(on.body).checkpoint).secondsMode).toBe(true);
    expect(await A()).toMatchObject({ code: 'ACCEPTED', replayed: false, seconds: true, scanId: first.scanId });
    const retry = randomUUID(); // a retried seconds tap answers the same, and still writes nothing
    expect((await A({ clientScanId: retry })).seconds).toBe(true);
    expect((await A({ clientScanId: retry })).seconds).toBe(true);
    const live = await f.pool.query('select 1 from scans where participant_id = $1 and checkpoint_id = $2', [f.p.A, f.cp.L]);
    expect(live.rowCount).toBe(1);

    const viaApi = await api.scan(vol1, { checkpointId: f.cp.L, method: 'qr', token: f.token.A });
    expect(viaApi.status).toBe(200);
    expect(viaApi.body).toMatchObject({ code: 'ACCEPTED', seconds: true });

    await f.checkIn(f.p.B); // not served yet: an ordinary first serving
    const b = await f.scan({ cp: f.cp.L, staff: f.staff.vol1, participantId: f.p.B });
    expect(b.code).toBe('ACCEPTED');
    expect(b.seconds).toBeUndefined();
    expect((await f.scan({ cp: f.cp.L, staff: f.staff.vol1, participantId: f.p.C })).code).toBe('NOT_ACCEPTED');
    await patch(f.cp.L, { isOpen: false });
    expect((await A()).code).toBe('CHECKPOINT_CLOSED');
    await patch(f.cp.L, { isOpen: true });

    await patch(f.cp.L, { secondsMode: false });
    expect((await A()).code).toBe('ALREADY_SCANNED');
    expect((await patch(f.cp.R, { secondsMode: true })).status).toBe(400); // meals only
    await expect(f.pool.query('update checkpoints set seconds_mode = true where id = $1', [f.cp.D])).rejects.toThrow(/check/);
  });
});
