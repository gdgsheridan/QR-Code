import { dietaryGroups, noRestriction } from '@/lib/domain/dashboard';
import { remainingMs } from '@/lib/domain/countdown';
import type { ScanResponse } from '@/lib/scan/schema';

// SPEC §10.2. Every state has an icon, a text label and a colour, never colour alone.
// I-1: 'green' is produced ONLY for a server response whose code is ACCEPTED.

export type Tone = 'green' | 'amber' | 'red';
export type CheckpointKind = 'door' | 'meal' | 'session' | 'custom';

export type Outcome =
  | { kind: 'server'; data: ScanResponse }
  | { kind: 'malformed' }
  | { kind: 'network' }
  | { kind: 'rate_limited' };

export interface ViewContext {
  checkpointKind: CheckpointKind;
  checkpointName: string;
  timezone: string;
  now: Date;
  /** How the scan was made; only changes the NOT_FOUND wording (§10.2 "NOT_FOUND via NFC"). */
  method?: 'qr' | 'manual' | 'nfc';
}

export interface ResultView {
  tone: Tone;
  icon: '✓' | '⟳' | '✕' | '!' | '?';
  headline: string;
  detail?: string;
  /** Shown bold, e.g. dietary notes at a meal. */
  emphasis?: string;
  /** v0.11.39: the catering groups of their dietary notes at a meal, e.g. Halal, No pork. */
  tags?: string[];
  /** v0.11.40: who to link a badge to, offered on a door ADMIT made by QR or manual search (§10.2). */
  linkable?: { id: string; name: string };
  name?: string;
  /** SESSION_COOLDOWN: time left until the next workshop check-in opens, as of when the result is shown. */
  countdownMs?: number;
  dismiss: { autoMs: number } | 'tap';
  action?: 'manual-search' | 'pick-checkpoint';
  sound: 'chime' | 'buzz' | 'double';
}

const GREEN_MS = 2500;
const MALFORMED_MS = 1500;

const HEADLINE: Record<CheckpointKind, string> = { door: 'ADMIT', meal: 'SERVE', session: 'RECORDED', custom: 'RECORDED' };

function problem(tone: 'amber' | 'red', icon: ResultView['icon'], headline: string, extra: Partial<ResultView> = {}): ResultView {
  return { tone, icon, headline, dismiss: 'tap', sound: tone === 'red' ? 'buzz' : 'double', ...extra };
}

function clock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export function viewFor(outcome: Outcome, ctx: ViewContext): ResultView {
  if (outcome.kind === 'malformed') {
    return { tone: 'amber', icon: '?', headline: 'Not a Datathon code', dismiss: { autoMs: MALFORMED_MS }, sound: 'double' };
  }
  if (outcome.kind === 'network') return problem('amber', '!', 'NO RESULT: do not admit yet. Rescan.');
  if (outcome.kind === 'rate_limited') return problem('amber', '!', 'Slow down', { detail: 'Too many scans. Wait a moment, then rescan.' });

  const r = outcome.data;
  const who = r.participant ? { name: r.participant.displayName } : {};

  switch (r.code) {
    case 'ACCEPTED': {
      const headline = HEADLINE[ctx.checkpointKind] + (r.seconds ? ' (seconds)' : r.replayed ? ' (confirmed)' : '');
      // At a meal: the allergy first (v0.9), then the dietary notes.
      const p = ctx.checkpointKind === 'meal' ? r.participant : undefined;
      const allergy = p?.allergies ? `ALLERGY${p.allergySeverity ? ` (${p.allergySeverity.toUpperCase()})` : ''}: ${p.allergies}` : null;
      const note = p?.dietaryNotes && !noRestriction(p.dietaryNotes) ? p.dietaryNotes : null;
      const emphasis = [allergy, note].filter(Boolean).join(' · ');
      const tags = dietaryGroups(note);
      return {
        tone: 'green',
        icon: '✓',
        headline,
        ...who,
        ...(emphasis ? { emphasis } : {}),
        ...(tags.length > 0 && { tags }),
        ...(ctx.checkpointKind === 'door' && ctx.method !== 'nfc' && r.participant && { linkable: { id: r.participant.id, name: r.participant.displayName } }),
        dismiss: { autoMs: GREEN_MS },
        sound: 'chime',
      };
    }
    case 'ALREADY_SCANNED': {
      const prev = r.previous;
      const ageS = prev ? Math.max(0, Math.round((ctx.now.getTime() - Date.parse(prev.scannedAt)) / 1000)) : Infinity;
      if (prev?.scannedByMe && ageS < 60) return problem('amber', '⟳', `You scanned this ${ageS} s ago`, who);
      const when = prev ? ` ${clock(prev.scannedAt, ctx.timezone)}` : '';
      const by = prev ? ` by ${prev.scannedByName ?? 'another volunteer'}` : '';
      return problem('red', '✕', `ALREADY SCANNED${when}${by}`, who);
    }
    case 'NOT_FOUND':
      return ctx.method === 'nfc'
        ? problem('red', '✕', 'UNKNOWN BADGE', { detail: 'Scan their QR instead' })
        : problem('red', '✕', 'UNKNOWN CODE', { detail: 'Use manual search', action: 'manual-search' });
    case 'REVOKED':
      return r.reissued
        ? problem('amber', '!', 'OLD CODE', { ...who, detail: 'Ask for their newest email' })
        : problem('red', '✕', 'PASS CANCELLED', { ...who, detail: 'Send to an organizer' });
    case 'NOT_ACCEPTED':
      return problem('red', '✕', `NOT ACCEPTED (${r.participant?.status ?? 'unknown'})`, who);
    case 'WRONG_EVENT':
      return problem('red', '✕', `This pass is for ${r.otherEvent ?? 'another event'}`);
    case 'NOT_CHECKED_IN':
      return problem('amber', '!', 'Not checked in yet', { ...who, detail: 'Send to the entrance' });
    case 'CHECKPOINT_CLOSED':
      return problem('amber', '!', `${ctx.checkpointName} is closed`, who);
    case 'CAPACITY_REACHED':
      return problem('red', '✕', `FULL (${r.capacity ?? '?'})`, who);
    case 'FORBIDDEN':
    case 'CHECKPOINT_NOT_FOUND':
      return problem('red', '✕', 'No access', { detail: 'Re-select the event', action: 'pick-checkpoint' });
    case 'CLIENT_ID_CONFLICT':
      return problem('amber', '!', 'Rescan please');
    case 'SESSION_COOLDOWN': {
      // Both instants are the server's (I-7): the screen ticks down from here.
      const left = r.availableAt ? remainingMs(r.availableAt, r.serverTime) : 0;
      return problem('amber', '!', 'COOLDOWN', {
        ...who,
        detail: `Just checked in to another workshop. Workshops need ${r.cooldownMinutes ?? 5} min between check-ins`,
        countdownMs: left,
      });
    }
  }
}
