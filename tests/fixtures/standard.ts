import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type pg from 'pg';
import { generateToken, sha256hex } from '@/lib/domain/token';
import type { ScanCode, VoidCode } from '@/lib/domain/scan-codes';
import { createPool, requireEnv } from './db';

// SPEC §14 standard fixture. Every call creates a fresh pair of events under a unique slug,
// so test files never share data. Rows are left behind; `pnpm db:reset` clears them.

export const STAFF_PASSWORD = 'fixture-password-123';

export interface ScanResult {
  code: ScanCode;
  replayed?: boolean;
  voided?: boolean;
  scanId?: string;
  participant?: {
    id: string;
    displayName: string;
    status: string;
    dietaryNotes?: string | null;
    allergies?: string | null;
    allergySeverity?: string | null;
  };
  previous?: { scannedAt: string; scannedByName: string | null; scannedByMe: boolean };
  reissued?: boolean;
  revokeReason?: string;
  otherEvent?: string;
  capacity?: number;
  /** SESSION_COOLDOWN: when the next workshop check-in opens, and the event's cooldown. */
  availableAt?: string;
  cooldownMinutes?: number;
  /** v0.12: ACCEPTED again at a meal in seconds mode (nothing new written). */
  seconds?: boolean;
}

export interface VoidResult {
  code: VoidCode;
}

export interface ScanArgs {
  cp: string;
  staff: string;
  token?: string;
  participantId?: string;
  clientScanId?: string;
  clientScannedAt?: string | null;
  db?: pg.Pool | pg.PoolClient;
}

type Who = 'A' | 'B' | 'C' | 'Rv' | 'Wd' | 'T' | 'X' | 'N';
type Staff = 'org1' | 'vol1' | 'vol2' | 'vol3';

export interface StandardFixture {
  slug: string;
  e1: { id: string; name: string };
  e2: { id: string; name: string };
  cp: { D: string; L: string; W: string; R: string; D2: string };
  p: Record<Who, string>;
  /** Active raw tokens (C has none). */
  token: Record<Exclude<Who, 'C'>, string>;
  /** Rv's first token, revoked with reason 'rotated'. */
  rvOldToken: string;
  staff: Record<Staff, string>;
  staffEmail: Record<Staff, string>;
  pool: pg.Pool;
  scan(args: ScanArgs): Promise<ScanResult>;
  issuePass(participantId: string, db?: pg.Pool | pg.PoolClient): Promise<{ passId: string; token: string }>;
  voidScan(scanId: string, staff: string, reason?: string): Promise<VoidResult>;
  addParticipant(eventId: string, opts?: { status?: string; withPass?: boolean }): Promise<{ id: string; token?: string }>;
  checkIn(participantId: string, token?: string): Promise<void>;
  /** link_badge() in the participant's own event (SPEC §6.5); a random UID unless given. */
  linkBadge(participantId: string, opts?: LinkBadgeOpts): Promise<{ uid: string; code: string }>;
  /** record_badge_scan() (SPEC §8, NFC). */
  badgeScan(args: { cp: string; staff: string; uid: string; clientScanId?: string; db?: pg.Pool | pg.PoolClient }): Promise<ScanResult>;
  close(): Promise<void>;
}

export interface LinkBadgeOpts {
  uid?: string;
  actor?: string;
  move?: boolean;
  db?: pg.Pool | pg.PoolClient;
}

export const randomUid = () => randomBytes(7).toString('hex');

// A confirmed account with a password (staff, or an attendee who answered an RSVP).
export async function createAccount(email: string): Promise<string> {
  const admin = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.auth.admin.createUser({ email, password: STAFF_PASSWORD, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message ?? 'no user'}`);
  return data.user.id;
}

export async function createStandardFixture(opts: { poolSize?: number } = {}): Promise<StandardFixture> {
  const pool = createPool(opts.poolSize ?? 4);
  const slug = `t-${randomBytes(6).toString('hex')}`;
  const one = async <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T> => {
    const { rows } = await pool.query<T>(sql, params);
    const row = rows[0];
    if (!row) throw new Error(`fixture query returned no rows: ${sql}`);
    return row;
  };

  const event = async (s: string, name: string) =>
    one<{ id: string }>(
      `insert into events (slug, name, venue, starts_at, ends_at)
       values ($1, $2, 'Fixture Hall', now(), now() + interval '1 day') returning id`,
      [s, name],
    );
  const e1 = { ...(await event(slug, `Fixture ${slug} One`)), name: `Fixture ${slug} One` };
  const e2 = { ...(await event(`${slug}-2`, `Fixture ${slug} Two`)), name: `Fixture ${slug} Two` };

  const checkpoint = async (eventId: string, name: string, kind: string, requiresCheckin: boolean, capacity: number | null) =>
    (
      await one<{ id: string }>(
        `insert into checkpoints (event_id, name, kind, requires_checkin, capacity, is_open)
         values ($1, $2, $3, $4, $5, true) returning id`,
        [eventId, name, kind, requiresCheckin, capacity],
      )
    ).id;
  const cp = {
    D: await checkpoint(e1.id, 'Door', 'door', false, null),
    L: await checkpoint(e1.id, 'Lunch', 'meal', true, null),
    W: await checkpoint(e1.id, 'Workshop', 'session', true, 2),
    R: await checkpoint(e1.id, 'Raffle', 'custom', false, null),
    D2: await checkpoint(e2.id, 'Door', 'door', false, null),
  };

  const issuePass = async (participantId: string, db: pg.Pool | pg.PoolClient = pool) => {
    const token = generateToken();
    const { rows } = await db.query<{ id: string }>('select issue_pass($1, $2) as id', [participantId, sha256hex(token)]);
    const passId = rows[0]?.id;
    if (!passId) throw new Error('issue_pass returned nothing');
    return { passId, token };
  };

  let seq = 0;
  const participant = async (eventId: string, first: string, status: string, extra: { isTest?: boolean; dietary?: string } = {}) => {
    seq += 1;
    return (
      await one<{ id: string }>(
        `insert into participants (event_id, external_id, email, first_name, last_name, search_text, dietary_notes, status, source, is_test)
         values ($1, $2, $3, $4, 'Fixture', $5, $6, $7, 'seed', $8) returning id`,
        [
          eventId,
          randomUUID(),
          `p${seq}-${randomBytes(4).toString('hex')}@${slug}.test`,
          first,
          `${first.toLowerCase()} fixture`,
          extra.dietary ?? null,
          status,
          extra.isTest ?? false,
        ],
      )
    ).id;
  };

  const p = {
    A: await participant(e1.id, 'Ada', 'accepted', { dietary: 'Vegetarian' }),
    B: await participant(e1.id, 'Ben', 'accepted'),
    C: await participant(e1.id, 'Cy', 'waitlisted'),
    Rv: await participant(e1.id, 'Rae', 'accepted'),
    Wd: await participant(e1.id, 'Wes', 'accepted'),
    T: await participant(e1.id, 'Tess', 'accepted', { isTest: true }),
    X: await participant(e2.id, 'Xan', 'accepted'),
    N: await participant(e1.id, 'Nia', 'accepted'),
  };

  const rvOld = await issuePass(p.Rv);
  const token = {
    A: (await issuePass(p.A)).token,
    B: (await issuePass(p.B)).token,
    Rv: (await issuePass(p.Rv)).token,
    Wd: (await issuePass(p.Wd)).token,
    T: (await issuePass(p.T)).token,
    X: (await issuePass(p.X)).token,
    N: (await issuePass(p.N)).token,
  };
  await pool.query(`update participants set status = 'withdrawn' where id = $1`, [p.Wd]);
  await pool.query(
    `update passes set revoked_at = now(), revoke_reason = 'status_change' where participant_id = $1 and revoked_at is null`,
    [p.Wd],
  );

  const staffEmail = {
    org1: `org1@${slug}.test`,
    vol1: `vol1@${slug}.test`,
    vol2: `vol2@${slug}.test`,
    vol3: `vol3@${slug}.test`,
  };
  const staff = {
    org1: await createAccount(staffEmail.org1),
    vol1: await createAccount(staffEmail.vol1),
    vol2: await createAccount(staffEmail.vol2),
    vol3: await createAccount(staffEmail.vol3),
  };
  const staffRows: Array<[string, string, string, string]> = [
    [e1.id, staff.org1, 'organizer', 'Org One'],
    [e1.id, staff.vol1, 'volunteer', 'Vol One'],
    [e1.id, staff.vol2, 'volunteer', 'Vol Two'],
    [e2.id, staff.vol3, 'volunteer', 'Vol Three'],
  ];
  for (const [eventId, userId, role, name] of staffRows) {
    await pool.query('insert into staff_profiles (user_id, display_name) values ($1, $2)', [userId, name]);
    await pool.query('insert into event_staff (event_id, user_id, role) values ($1, $2, $3)', [eventId, userId, role]);
  }

  const scan = async (args: ScanArgs): Promise<ScanResult> => {
    const method = args.token !== undefined ? 'qr' : 'manual';
    const { rows } = await (args.db ?? pool).query<{ r: ScanResult }>(
      'select record_scan($1, $2, $3::scan_method, $4, $5, $6, $7) as r',
      [
        args.cp,
        args.staff,
        method,
        args.token !== undefined ? sha256hex(args.token) : null,
        args.participantId ?? null,
        args.clientScanId ?? randomUUID(),
        args.clientScannedAt === undefined ? new Date().toISOString() : args.clientScannedAt,
      ],
    );
    const r = rows[0]?.r;
    if (!r) throw new Error('record_scan returned nothing');
    return r;
  };

  const voidScan = async (scanId: string, staffId: string, reason = 'Test scan') => {
    const { rows } = await pool.query<{ r: VoidResult }>('select void_scan($1, $2, $3) as r', [scanId, staffId, reason]);
    const r = rows[0]?.r;
    if (!r) throw new Error('void_scan returned nothing');
    return r;
  };

  const addParticipant = async (eventId: string, o: { status?: string; withPass?: boolean } = {}) => {
    const id = await participant(eventId, 'Extra', o.status ?? 'accepted');
    return o.withPass === false ? { id } : { id, token: (await issuePass(id)).token };
  };

  const checkIn = async (participantId: string, tok?: string) => {
    const r = await scan(
      tok !== undefined ? { cp: cp.D, staff: staff.org1, token: tok } : { cp: cp.D, staff: staff.org1, participantId },
    );
    if (r.code !== 'ACCEPTED') throw new Error(`fixture check-in failed: ${r.code}`);
  };

  const linkBadge = async (participantId: string, o: LinkBadgeOpts = {}) => {
    const uid = o.uid ?? randomUid();
    const { rows } = await (o.db ?? pool).query<{ code: string }>(
      `select link_badge(pa.event_id, pa.id, $2, $3, $4) as code from participants pa where pa.id = $1`,
      [participantId, uid, o.actor ?? staff.org1, o.move ?? false],
    );
    const code = rows[0]?.code;
    if (!code) throw new Error('link_badge returned nothing');
    return { uid, code };
  };

  const badgeScan = async (args: { cp: string; staff: string; uid: string; clientScanId?: string; db?: pg.Pool | pg.PoolClient }) => {
    const { rows } = await (args.db ?? pool).query<{ r: ScanResult }>('select record_badge_scan($1, $2, $3, $4, $5) as r', [
      args.cp,
      args.staff,
      args.uid,
      args.clientScanId ?? randomUUID(),
      new Date().toISOString(),
    ]);
    const r = rows[0]?.r;
    if (!r) throw new Error('record_badge_scan returned nothing');
    return r;
  };

  return {
    slug,
    e1,
    e2,
    cp,
    p,
    token,
    rvOldToken: rvOld.token,
    staff,
    staffEmail,
    pool,
    scan,
    issuePass,
    voidScan,
    addParticipant,
    checkIn,
    linkBadge,
    badgeScan,
    close: () => pool.end(),
  };
}
