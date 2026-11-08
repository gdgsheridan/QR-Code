import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, obj } from '../fixtures/admin-api';
import { signInAs } from '../fixtures/staff';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

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

describe('checkpoints admin (SPEC §11)', () => {
  it('T-ADM-02: open → scan → close → scan: the toggle applies on the very next scan; toggles are audited', async () => {
    const patch = (isOpen: boolean) => c.call('updateCheckpoint', org, { slug: f.slug, id: f.cp.R }, { method: 'PATCH', body: { isOpen } });
    expect((await patch(true)).status).toBe(200);
    expect((await f.scan({ cp: f.cp.R, staff: f.staff.vol1, token: f.token.A })).code).toBe('ACCEPTED');
    expect((await patch(false)).status).toBe(200);
    expect((await f.scan({ cp: f.cp.R, staff: f.staff.vol1, token: f.token.B })).code).toBe('CHECKPOINT_CLOSED');
    const { rows } = await f.pool.query<{ action: string }>(
      `select action from audit_log where subject_id = $1 and action like 'checkpoint.%' order by id`,
      [f.cp.R],
    );
    expect(rows.map((r) => r.action)).toEqual(['checkpoint.open', 'checkpoint.close']);
  });

  it('§11: create a checkpoint; a door is always requires_checkin=false; a second door is 409; bad input 400', async () => {
    const made = await c.call('createCheckpoint', org, { slug: f.slug }, { body: { name: 'Dinner Sat', kind: 'meal', capacity: 80 } });
    expect(made.status).toBe(201);
    expect(obj(made.body).checkpoint).toMatchObject({ name: 'Dinner Sat', kind: 'meal', requiresCheckin: true, isOpen: false, capacity: 80 });
    const door = await c.call('createCheckpoint', org, { slug: f.slug }, { body: { name: 'Side door', kind: 'door' } });
    expect(door.status).toBe(409);
    expect((await c.call('createCheckpoint', org, { slug: f.slug }, { body: { name: '', kind: 'meal' } })).status).toBe(400);
    const list = await c.call('listCheckpoints', org, { slug: f.slug });
    expect((obj(list.body).checkpoints as unknown[]).length).toBe(5);
  });

  it('T-ADM-04: deleting a checkpoint that has scans is blocked with a message; an unused one can be deleted', async () => {
    await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: f.token.N });
    const blocked = await c.call('deleteCheckpoint', org, { slug: f.slug, id: f.cp.D }, { method: 'DELETE' });
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({ error: 'HAS_SCANS' });
    const made = await c.call('createCheckpoint', org, { slug: f.slug }, { body: { name: 'Temp', kind: 'custom' } });
    const id = String(obj(obj(made.body).checkpoint).id);
    // A NOT_FOUND attempt logged at the checkpoint must not block deleting it.
    await f.scan({ cp: id, staff: f.staff.vol1, token: 'x'.repeat(32) });
    await f.pool.query(`insert into scan_attempts (event_id, checkpoint_id, staff_user_id, result_code) values ($1, $2, $3, 'NOT_FOUND')`, [
      f.e1.id,
      id,
      f.staff.vol1,
    ]);
    expect((await c.call('deleteCheckpoint', org, { slug: f.slug, id }, { method: 'DELETE' })).status).toBe(200);
  });

  it('T-ADM-04 (v0.12): a checkpoint whose scans were all removed can be deleted, its removed scans with it; one live scan still blocks it', async () => {
    const del = (id: string) => c.call('deleteCheckpoint', org, { slug: f.slug, id }, { method: 'DELETE' });
    const made = await c.call('createCheckpoint', org, { slug: f.slug }, { body: { name: 'Test desk', kind: 'custom', requiresCheckin: false } });
    const id = String(obj(obj(made.body).checkpoint).id);
    await c.call('updateCheckpoint', org, { slug: f.slug, id }, { method: 'PATCH', body: { isOpen: true } });
    const first = await f.scan({ cp: id, staff: f.staff.vol1, token: f.token.A });
    const second = await f.scan({ cp: id, staff: f.staff.vol1, token: f.token.B });
    expect([first.code, second.code]).toEqual(['ACCEPTED', 'ACCEPTED']);
    expect((await f.voidScan(String(first.scanId), f.staff.vol1)).code).toBe('VOIDED');
    expect((await del(id)).status).toBe(409); // B's scan is still live
    expect((await f.voidScan(String(second.scanId), f.staff.vol1)).code).toBe('VOIDED');
    expect((await del(id)).status).toBe(200);
    const left = await f.pool.query('select 1 from scans where checkpoint_id = $1', [id]);
    expect(left.rowCount).toBe(0);
    const audit = await f.pool.query<{ detail: unknown }>(`select detail from audit_log where action = 'checkpoint.delete' and subject_id = $1`, [id]);
    expect(audit.rows.map((r) => r.detail)).toEqual([{ removedScans: 2 }]);
  });

  it('I-5: a checkpoint of another event cannot be changed through this event (404)', async () => {
    const res = await c.call('updateCheckpoint', org, { slug: f.slug, id: f.cp.D2 }, { method: 'PATCH', body: { isOpen: false } });
    expect(res.status).toBe(404);
    const { rows } = await f.pool.query<{ is_open: boolean }>('select is_open from checkpoints where id = $1', [f.cp.D2]);
    expect(rows[0]?.is_open).toBe(true);
  });
});
