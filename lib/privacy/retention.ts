import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types.gen';
import { PHOTO_BUCKET } from '@/lib/storage/photos';

type Db = SupabaseClient<Database>;
export const RETENTION_DAYS = 30;
/** SPEC §15: participant PII is anonymised 12 months after the event ends (aggregate stats are kept). */
export const PII_RETENTION_DAYS = 365;
/** First name written by the 12-month stage. 'Deleted' stays reserved for the admin tombstone (§5.1). */
export const ANONYMISED_NAME = 'Former participant';

export interface RetentionReport {
  events: Array<{ eventId: string; participants: number; photos: number }>;
  anonymised: Array<{ eventId: string; participants: number; photos: number }>;
}

/** Deterministic tombstone email for an anonymised row (email is NOT NULL, so it cannot be nulled). */
export function anonymisedEmail(id: string): string {
  return `deleted+${id}@invalid`;
}

/** Whether this row still carries PII (tombstoned/anonymised rows already match the end state). */
export function needsAnonymisation(row: { email: string | null }): boolean {
  return !/^deleted\+.*@invalid$/.test(row.email ?? '');
}

type ParticipantUpdate = Database['public']['Tables']['participants']['Update'];

// The 12-month patch. Keeps ids, event membership, team link and scan history so analytics and
// audit still work; clears every PII column the tombstone (§5.1) clears, plus the RSVP token hash
// (a bearer credential) and the directory profile (bio, pace, consent — §15 follows PII retention).
export function anonymisedPatch(id: string, nowIso: string): ParticipantUpdate {
  return {
    email: anonymisedEmail(id),
    first_name: ANONYMISED_NAME,
    last_name: '',
    search_text: '',
    photo_path: null,
    photo_updated_at: null,
    dietary_notes: null,
    dietary_set_at: null,
    linkedin_url: null,
    linkedin_set_at: null,
    discord_username: null,
    website_url: null,
    bio: null,
    pace: null,
    directory_opt_in: false,
    looking_for_team: false,
    emergency_name: null,
    emergency_phone: null,
    emergency_relation: null,
    overnight: null,
    allergies: null,
    allergy_severity: null,
    team_status: null,
    accessibility: null,
    rsvp_token_hash: null,
    updated_at: nowIso,
  };
}

// SPEC §15: 30 days after an event ends, delete its photos (storage objects too), dietary notes and
// emergency contacts (v0.6).
// Storage first, then the rows, so a crash in between is repaired by the next run (removing a
// missing object is not an error). Idempotent: already-cleared rows are not selected again.
export async function runRetention(db: Db, now: Date): Promise<RetentionReport> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86_400_000).toISOString();
  const { data: events, error } = await db.from('events').select('id').lte('ends_at', cutoff);
  if (error) throw new Error(`retention events load failed (${error.code})`);

  const report: RetentionReport = { events: [], anonymised: [] };
  for (const { id: eventId } of events) {
    const { data: people, error: peopleError } = await db
      .from('participants')
      .select('id, photo_path')
      .eq('event_id', eventId)
      .or('photo_path.not.is.null,dietary_notes.not.is.null,emergency_name.not.is.null,allergies.not.is.null,accessibility.not.is.null');
    if (peopleError) throw new Error(`retention participants load failed (${peopleError.code})`);
    if (people.length === 0) continue;

    const paths = people.flatMap((p) => (p.photo_path ? [p.photo_path] : []));
    for (let i = 0; i < paths.length; i += 500) {
      const { error: removeError } = await db.storage.from(PHOTO_BUCKET).remove(paths.slice(i, i + 500));
      if (removeError) throw new Error(`retention photo removal failed (${removeError.name})`);
    }
    const ids = people.map((p) => p.id);
    for (let i = 0; i < ids.length; i += 500) {
      const { error: updateError } = await db
        .from('participants')
        .update({
          photo_path: null,
          photo_updated_at: null,
          dietary_notes: null,
          emergency_name: null,
          emergency_phone: null,
          emergency_relation: null,
          allergies: null, // v0.9
          allergy_severity: null,
          accessibility: null,
          updated_at: now.toISOString(),
        })
        .in('id', ids.slice(i, i + 500));
      if (updateError) throw new Error(`retention update failed (${updateError.code})`);
    }
    // Counts only (I-11).
    const { error: auditError } = await db
      .from('audit_log')
      .insert({ event_id: eventId, actor_kind: 'system', action: 'privacy.retention', detail: { participants: ids.length, photos: paths.length } });
    if (auditError) throw new Error(`audit_log insert failed (${auditError.code})`);
    report.events.push({ eventId, participants: ids.length, photos: paths.length });
  }

  // Stage 2 (A04): events that ended over 12 months ago get participant PII anonymised. Storage
  // first, then the rows — same crash-repair ordering as stage 1. Idempotent: rows whose email is
  // already a tombstone address are not selected again (covers tombstoned rows too, since the
  // admin tombstone writes the same email shape). No migration needed: no new column, NOT NULL
  // names/emails take deterministic tombstone values.
  const piiCutoff = new Date(now.getTime() - PII_RETENTION_DAYS * 86_400_000).toISOString();
  const { data: oldEvents, error: oldError } = await db.from('events').select('id').lte('ends_at', piiCutoff);
  if (oldError) throw new Error(`retention events load failed (${oldError.code})`);
  const stamped = now.toISOString();
  for (const { id: eventId } of oldEvents ?? []) {
    const { data: people, error: peopleError } = await db
      .from('participants')
      .select('id, photo_path')
      .eq('event_id', eventId)
      .not('email', 'like', 'deleted+%@invalid');
    if (peopleError) throw new Error(`retention pii load failed (${peopleError.code})`);
    if (people.length === 0) continue;

    const photoPaths = people.flatMap((p) => (p.photo_path ? [p.photo_path] : []));
    for (let i = 0; i < photoPaths.length; i += 500) {
      const { error: removeError } = await db.storage.from(PHOTO_BUCKET).remove(photoPaths.slice(i, i + 500));
      if (removeError) throw new Error(`retention photo removal failed (${removeError.name})`);
    }
    // One update per participant: the anonymised email is per-row, so it cannot be bulk-set.
    // ponytail: O(n) updates; fine for a daily job at club scale, batch the RPC if events grow 100x.
    for (const p of people) {
      const { error: updateError } = await db.from('participants').update(anonymisedPatch(p.id, stamped)).eq('id', p.id);
      if (updateError) throw new Error(`retention anonymise failed (${updateError.code})`);
    }
    // Counts only (I-11).
    const { error: auditError } = await db
      .from('audit_log')
      .insert({ event_id: eventId, actor_kind: 'system', action: 'privacy.anonymise', detail: { participants: people.length, photos: photoPaths.length } });
    if (auditError) throw new Error(`audit_log insert failed (${auditError.code})`);
    report.anonymised.push({ eventId, participants: people.length, photos: photoPaths.length });
  }
  return report;
}
