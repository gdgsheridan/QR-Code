import { describe, expect, it } from 'vitest';
import { SCAN_CODES, type ScanCode } from '@/lib/domain/scan-codes';
import { viewFor, type ViewContext } from '@/lib/scanner/result-view';
import type { ScanResponse } from '@/lib/scan/schema';

const now = new Date('2026-10-03T16:03:20Z');
const ctx = (kind: ViewContext['checkpointKind'] = 'door'): ViewContext => ({
  checkpointKind: kind,
  checkpointName: kind === 'door' ? 'Door' : 'Lunch Sat',
  timezone: 'America/Toronto',
  now,
});
const participant = { id: 'p1', displayName: 'Ada Lovelace', status: 'accepted', dietaryNotes: null };
const server = (data: Partial<ScanResponse> & { code: ScanCode }) => ({ kind: 'server' as const, data: { serverTime: now.toISOString(), ...data } });

describe('result screen mapping (SPEC §10.2)', () => {
  it('T-SCUI-03: ACCEPTED headlines per checkpoint kind, green, auto-dismiss 2.5 s, chime; meal dietary tags (v0.11.39)', () => {
    expect(viewFor(server({ code: 'ACCEPTED', participant }), ctx('door'))).toMatchObject({
      tone: 'green', icon: '✓', headline: 'ADMIT', name: 'Ada Lovelace', dismiss: { autoMs: 2500 }, sound: 'chime',
    });
    const meal = viewFor(server({ code: 'ACCEPTED', participant: { ...participant, dietaryNotes: 'Vegan, nut allergy' } }), ctx('meal'));
    expect(meal).toMatchObject({ tone: 'green', headline: 'SERVE', emphasis: 'Vegan, nut allergy', tags: ['Vegan', 'Nuts'] });
    // v0.11.39: the catering groups as tags; a note that means no restriction shows nothing.
    const halal = viewFor(server({ code: 'ACCEPTED', participant: { ...participant, dietaryNotes: 'Halal, no pork' } }), ctx('meal'));
    expect(halal).toMatchObject({ emphasis: 'Halal, no pork', tags: ['Halal', 'No pork'] });
    const none = viewFor(server({ code: 'ACCEPTED', participant: { ...participant, dietaryNotes: 'N/A' } }), ctx('meal'));
    expect([none.emphasis, none.tags]).toEqual([undefined, undefined]);
    expect(viewFor(server({ code: 'ACCEPTED', participant: { ...participant, dietaryNotes: 'Halal' } }), ctx('door')).tags).toBeUndefined();
    // v0.9: the allergy and its severity come first; never at the door.
    const allergic = { ...participant, dietaryNotes: 'Vegan', allergies: 'Peanuts', allergySeverity: 'severe' };
    expect(viewFor(server({ code: 'ACCEPTED', participant: allergic }), ctx('meal')).emphasis).toBe('ALLERGY (SEVERE): Peanuts · Vegan');
    expect(viewFor(server({ code: 'ACCEPTED', participant: allergic }), ctx('door')).emphasis).toBeUndefined();
    expect(viewFor(server({ code: 'ACCEPTED', participant }), ctx('session')).headline).toBe('RECORDED');
    expect(viewFor(server({ code: 'ACCEPTED', participant }), ctx('custom')).headline).toBe('RECORDED');
    expect(viewFor(server({ code: 'ACCEPTED', replayed: true, participant }), ctx('door'))).toMatchObject({
      tone: 'green', headline: 'ADMIT (confirmed)', dismiss: { autoMs: 2500 },
    });
    // T-SCAN-32 (v0.12): seconds at a meal stay green, with the allergy, and say so.
    expect(viewFor(server({ code: 'ACCEPTED', replayed: false, seconds: true, participant: allergic }), ctx('meal'))).toMatchObject({
      tone: 'green', headline: 'SERVE (seconds)', emphasis: 'ALLERGY (SEVERE): Peanuts · Vegan', dismiss: { autoMs: 2500 },
    });
  });

  it('T-NFC-29: a door ADMIT by QR or manual search offers to link that person a badge (v0.11.40)', () => {
    const want = { id: 'p1', name: 'Ada Lovelace' };
    expect(viewFor(server({ code: 'ACCEPTED', participant }), ctx('door')).linkable).toEqual(want);
    expect(viewFor(server({ code: 'ACCEPTED', participant }), { ...ctx('door'), method: 'manual' }).linkable).toEqual(want);
    expect(viewFor(server({ code: 'ACCEPTED', replayed: true, participant }), { ...ctx('door'), method: 'qr' }).linkable).toEqual(want);
    // Not by badge (they hold a linked one), not at other checkpoints, never on a problem.
    expect(viewFor(server({ code: 'ACCEPTED', participant }), { ...ctx('door'), method: 'nfc' }).linkable).toBeUndefined();
    expect(viewFor(server({ code: 'ACCEPTED', participant }), ctx('meal')).linkable).toBeUndefined();
    expect(viewFor(server({ code: 'ACCEPTED' }), ctx('door')).linkable).toBeUndefined();
    const previous = { scannedAt: now.toISOString(), scannedByName: 'Maya', scannedByMe: false };
    expect(viewFor(server({ code: 'ALREADY_SCANNED', participant, previous }), ctx('door')).linkable).toBeUndefined();
    expect(viewFor(server({ code: 'NOT_ACCEPTED', participant }), ctx('door')).linkable).toBeUndefined();
  });

  it('T-SCUI-12: ALREADY_SCANNED by me < 60 s is amber; by me ≥ 60 s or by someone else is red with time and name', () => {
    const at = (secondsAgo: number) => new Date(now.getTime() - secondsAgo * 1000).toISOString();
    expect(viewFor(server({ code: 'ALREADY_SCANNED', participant, previous: { scannedAt: at(8), scannedByName: 'Me', scannedByMe: true } }), ctx())).toMatchObject({
      tone: 'amber', icon: '⟳', headline: 'You scanned this 8 s ago', dismiss: 'tap', sound: 'double',
    });
    const old = viewFor(server({ code: 'ALREADY_SCANNED', participant, previous: { scannedAt: at(90), scannedByName: 'Me', scannedByMe: true } }), ctx());
    expect(old).toMatchObject({ tone: 'red', icon: '✕', headline: 'ALREADY SCANNED 12:01 PM by Me', dismiss: 'tap', sound: 'buzz' });
    const other = viewFor(server({ code: 'ALREADY_SCANNED', participant, previous: { scannedAt: at(17), scannedByName: 'Maya', scannedByMe: false } }), ctx());
    expect(other).toEqual({ tone: 'red', icon: '✕', headline: 'ALREADY SCANNED 12:03 PM by Maya', name: 'Ada Lovelace', dismiss: 'tap', sound: 'buzz' });
  });

  it('T-SCUI-03: every problem code has its §10.2 tone, icon, text and requires a tap', () => {
    const cases: Array<[Parameters<typeof viewFor>[0], object]> = [
      [server({ code: 'NOT_FOUND' }), { tone: 'red', icon: '✕', headline: 'UNKNOWN CODE', detail: 'Use manual search', action: 'manual-search' }],
      [server({ code: 'REVOKED', reissued: true, participant }), { tone: 'amber', icon: '!', headline: 'OLD CODE', detail: 'Ask for their newest email' }],
      [server({ code: 'REVOKED', reissued: false, participant }), { tone: 'red', icon: '✕', headline: 'PASS CANCELLED', detail: 'Send to an organizer' }],
      [server({ code: 'NOT_ACCEPTED', participant: { ...participant, status: 'waitlisted' } }), { tone: 'red', icon: '✕', headline: 'NOT ACCEPTED (waitlisted)' }],
      [server({ code: 'WRONG_EVENT', otherEvent: 'Design Day' }), { tone: 'red', icon: '✕', headline: 'This pass is for Design Day' }],
      [server({ code: 'NOT_CHECKED_IN', participant }), { tone: 'amber', icon: '!', headline: 'Not checked in yet', detail: 'Send to the entrance' }],
      [server({ code: 'CHECKPOINT_CLOSED', participant }), { tone: 'amber', icon: '!', headline: 'Door is closed' }],
      [server({ code: 'CAPACITY_REACHED', participant, capacity: 40 }), { tone: 'red', icon: '✕', headline: 'FULL (40)' }],
      [server({ code: 'FORBIDDEN' }), { tone: 'red', icon: '✕', headline: 'No access', detail: 'Re-select the event', action: 'pick-checkpoint' }],
      [server({ code: 'CHECKPOINT_NOT_FOUND' }), { tone: 'red', icon: '✕', headline: 'No access', action: 'pick-checkpoint' }],
      [server({ code: 'CLIENT_ID_CONFLICT' }), { tone: 'amber', icon: '!', headline: 'Rescan please' }],
      // T-SCAN-31: the workshop cooldown, with the time left as of the server's clock.
      [server({ code: 'SESSION_COOLDOWN', participant, availableAt: new Date(now.getTime() + 245_000).toISOString(), cooldownMinutes: 5 }),
        { tone: 'amber', icon: '!', headline: 'COOLDOWN', name: 'Ada Lovelace', countdownMs: 245_000, detail: 'Just checked in to another workshop. Workshops need 5 min between check-ins' }],
      [{ kind: 'network' }, { tone: 'amber', icon: '!', headline: 'NO RESULT: do not admit yet. Rescan.' }],
      [{ kind: 'rate_limited' }, { tone: 'amber', icon: '!', headline: 'Slow down' }],
    ];
    for (const [outcome, expected] of cases) {
      const v = viewFor(outcome, ctx());
      expect(v, JSON.stringify(outcome)).toMatchObject({ ...expected, dismiss: 'tap' });
      expect(v.sound).toBe(v.tone === 'red' ? 'buzz' : 'double');
    }
  });

  it('T-SCUI-06: MALFORMED is amber "?" and auto-dismisses after 1.5 s', () => {
    expect(viewFor({ kind: 'malformed' }, ctx())).toMatchObject({ tone: 'amber', icon: '?', headline: 'Not a Datathon code', dismiss: { autoMs: 1500 } });
  });

  it('I-1: nothing but a server ACCEPTED is ever green', () => {
    for (const code of SCAN_CODES.filter((c) => c !== 'ACCEPTED')) {
      expect(viewFor(server({ code, participant, reissued: true, previous: { scannedAt: now.toISOString(), scannedByName: 'x', scannedByMe: true } }), ctx()).tone).not.toBe('green');
    }
    for (const kind of ['malformed', 'network', 'rate_limited'] as const) expect(viewFor({ kind }, ctx()).tone).not.toBe('green');
  });

  it('T-NFC-09: NOT_FOUND from a badge is red "UNKNOWN BADGE" and needs a tap; nothing but ACCEPTED is green for NFC either', () => {
    const nfc = { ...ctx(), method: 'nfc' as const };
    expect(viewFor(server({ code: 'NOT_FOUND' }), nfc)).toEqual({
      tone: 'red', icon: '✕', headline: 'UNKNOWN BADGE', detail: 'Scan their QR instead', dismiss: 'tap', sound: 'buzz',
    });
    expect(viewFor(server({ code: 'NOT_FOUND' }), ctx()).headline).toBe('UNKNOWN CODE');
    expect(viewFor(server({ code: 'ACCEPTED', participant }), nfc)).toMatchObject({ tone: 'green', headline: 'ADMIT' });
    for (const code of SCAN_CODES.filter((c) => c !== 'ACCEPTED')) {
      expect(viewFor(server({ code, participant, previous: { scannedAt: now.toISOString(), scannedByName: 'x', scannedByMe: true } }), nfc).tone).not.toBe('green');
    }
  });
});
