import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/lib/db/types.gen';
import { toFileLabel } from '@/lib/domain/file-label';
import { earlierReplyBy } from '@/lib/domain/rsvp';
import { nextAttempt, sanitizeError } from '@/lib/domain/outbox';
import { generateToken, passToken, sha256hex } from '@/lib/domain/token';
import { renderQrPng } from '@/lib/qr/render';
import { ProviderError, type EmailMessage, type EmailProvider } from './provider';
import { renderEventEveEmail } from './templates/event-eve';
import { renderPassEmail, type RenderedEmail } from './templates/pass';
import { renderProfileReminderEmail } from './templates/profile-reminder';
import { renderRsvpEmail } from './templates/rsvp';
import { renderStaffAddedEmail } from './templates/staff-added';
import { renderTeamInviteEmail } from './templates/team-invite';
import { emailEventName, formalVenue } from './links';

type Db = SupabaseClient<Database>;
type OutboxRow = Database['public']['Tables']['email_outbox']['Row'];
type FinishArgs = Database['public']['Functions']['finish_outbox']['Args'];

export interface DrainOptions {
  db: Db;
  provider: EmailProvider;
  appOrigin: string;
  from: string;
  /** PASS_TOKEN_SECRET (§6.1). */
  passSecret: string;
  limit?: number;
  now?: () => Date;
}

export interface DrainResult {
  claimed: number;
  sent: number;
  retrying: number;
  failed: number;
  cancelled: number;
  /** A 429 stopped this batch (v0.11.25). */
  rateLimited: boolean;
}

// SPEC F4. Safe to run concurrently: rows are claimed with FOR UPDATE SKIP LOCKED.
export async function drainOutbox(opts: DrainOptions): Promise<DrainResult> {
  if (opts.provider.holdQueue) return { claimed: 0, sent: 0, retrying: 0, failed: 0, cancelled: 0, rateLimited: false };
  const { data: rows, error } = await opts.db.rpc('claim_outbox', { p_limit: opts.limit ?? 20 });
  if (error) throw new Error(`claim_outbox failed (${error.code})`);
  const result: DrainResult = { claimed: rows.length, sent: 0, retrying: 0, failed: 0, cancelled: 0, rateLimited: false };
  for (const [i, row] of rows.entries()) {
    const outcome = await processRow(opts, row);
    if (outcome === 'rateLimited') {
      // v0.11.25: the provider said slow down. Hand the rest of the batch back, uncharged, for after its wait.
      result.retrying += 1;
      result.rateLimited = true;
      for (const rest of rows.slice(i + 1)) {
        await finish(opts.db, { p_id: rest.id, p_status: 'pending', p_refund: true, p_claim_token: rest.claim_token });
        result.retrying += 1;
      }
      break;
    }
    result[outcome] += 1;
  }
  return result;
}

// Drains batch after batch until nothing is due or the time budget is spent (after() / cron runs).
export async function drainUntilIdle(opts: DrainOptions, budgetMs = 25_000): Promise<number> {
  const deadline = Date.now() + budgetMs;
  let claimed = 0;
  for (;;) {
    const r = await drainOutbox(opts);
    claimed += r.claimed;
    if (r.claimed === 0 || r.rateLimited || Date.now() > deadline) return claimed;
  }
}

async function finish(db: Db, args: FinishArgs): Promise<void> {
  // A09: finish_outbox is fenced by claim_token. A row reclaimed after this batch's lease expired
  // no longer matches, so a stale finish returns false and changes nothing instead of overwriting
  // the new owner's result.
  const { error } = await db.rpc('finish_outbox', args);
  if (error) throw new Error(`finish_outbox failed (${error.code})`);
}

// What the drainer sends for one row; null cancels it. A team-invite email also says up to which invite it covers.
type Outgoing = Pick<EmailMessage, 'to' | 'subject' | 'html' | 'text' | 'inlineImages' | 'fileLabel'> & { invitesUpTo?: string };

async function processRow(opts: DrainOptions, row: OutboxRow): Promise<'sent' | 'retrying' | 'failed' | 'cancelled' | 'rateLimited'> {
  let providerId: string;
  let invitesCovered: string | undefined;
  try {
    const outgoing = row.kind === 'staff_added' ? await staffEmail(opts, row) : await participantEmail(opts, row);
    if (!outgoing) {
      await finish(opts.db, { p_id: row.id, p_status: 'cancelled', p_claim_token: row.claim_token });
      return 'cancelled';
    }
    const { invitesUpTo, ...message } = outgoing;
    invitesCovered = invitesUpTo;
    // 3. Send.
    ({ id: providerId } = await opts.provider.send({ ...message, from: opts.from, idempotencyKey: `${row.id}:${row.attempts}` }));
  } catch (err) {
    // 5. Failure: back off, or give up after the last attempt. last_error is sanitized (I-11).
    // A 429 isn't charged as an attempt and has its own, larger allowance (v0.11.25).
    const rateLimited = err instanceof ProviderError && err.status === 429;
    const next = nextAttempt({
      attempts: row.attempts,
      now: (opts.now ?? (() => new Date()))(),
      retryAfterSeconds: err instanceof ProviderError ? err.retryAfterSeconds : undefined,
      rateLimitHits: rateLimited ? row.rate_limit_hits + 1 : undefined,
    });
    const lastError = sanitizeError(err);
    const charge = { p_refund: rateLimited, p_rate_limited: rateLimited };
    if (next.status === 'failed') {
      await finish(opts.db, { p_id: row.id, p_status: 'failed', p_last_error: lastError, p_claim_token: row.claim_token, ...charge });
      return 'failed';
    }
    await finish(opts.db, {
      p_id: row.id,
      p_status: 'pending',
      p_next_attempt_at: next.at.toISOString(),
      p_last_error: lastError,
      p_claim_token: row.claim_token,
      ...charge,
    });
    return rateLimited ? 'rateLimited' : 'retrying';
  }

  // 4. Success. If this write fails, the row is retried and a second email goes out with a newer
  // code; only the newest works (accepted edge, SPEC F4).
  await finish(opts.db, { p_id: row.id, p_status: 'sent', p_provider_message_id: providerId, p_claim_token: row.claim_token });
  if (invitesCovered && row.participant_id) await queueLaterInvites(opts, row.participant_id, invitesCovered);
  return 'sent';
}

// v0.11.47 (F15 step 8): an invite that arrived while this email was being sent wasn't in it, and its own email was
// refused (one waits per person at a time), so it gets one an hour later, under the hourly limit.
async function queueLaterInvites(opts: DrainOptions, participantId: string, after: string) {
  const { count, error } = await opts.db.from('team_invites').select('team_id', { count: 'exact', head: true })
    .eq('participant_id', participantId).gt('created_at', after);
  if (error) throw new Error(`invite recount failed (${error.code})`);
  if (!count) return;
  const at = new Date((opts.now ?? (() => new Date()))().getTime() + 3_600_000).toISOString();
  const { error: queueError } = await opts.db.from('email_outbox').insert({ participant_id: participantId, kind: 'team_invite', next_attempt_at: at });
  if (queueError && queueError.code !== '23505') throw new Error(`invite follow-up failed (${queueError.code})`); // 23505: one is waiting already
}

// 1. Reload the participant; stop if they were deleted, or (for a pass) are no longer accepted,
// or (for an RSVP or its reminder, F13) already are.
async function participantEmail(opts: DrainOptions, row: OutboxRow): Promise<Outgoing | null> {
  const participantId = row.participant_id;
  if (participantId === null) return null;
  const { data: p, error } = await opts.db
    .from('participants')
    .select('first_name, email, status, deleted_at, emergency_name, overnight, team_status, team_id, events(slug, name, venue, starts_at, ends_at, timezone, rsvp_reply_by, teams_open)')
    .eq('id', participantId)
    .single();
  if (error) throw new Error(`participant load failed (${error.code})`);
  const accepted = p.status === 'accepted';
  const rsvp = row.kind === 'rsvp' || row.kind === 'rsvp_reminder';
  if (p.deleted_at !== null || (rsvp ? accepted : !accepted)) return null;
  const event = { name: emailEventName(p.events.slug, p.events.name), venue: formalVenue(p.events.venue), startsAt: p.events.starts_at, timezone: p.events.timezone };

  let email: RenderedEmail;
  let invitesUpTo: string | undefined;
  if (rsvp) {
    // 2. A fresh RSVP token, stored (hash only) BEFORE the send, like a pass (I-10); older links stop working.
    // Only while this job is still ours (an answer that cancelled it since the claim stops the resend) and,
    // for a reminder, while they can still answer. It answers when the invitation closes.
    const token = generateToken();
    const { data: stored, error: rsvpError } = await opts.db.rpc('set_rsvp_token', { p_outbox_id: row.id, p_token_hash: sha256hex(token) });
    if (rsvpError) throw new Error(`set_rsvp_token failed (${rsvpError.code})`);
    const closes = z.object({ closesAt: z.string().nullable() }).safeParse(stored);
    if (!closes.success) return null;
    const closesAt = closes.data.closesAt && new Date(closes.data.closesAt).toISOString();
    // v0.11.28: they're asked to reply by the event's reply-by date while it's ahead; the email also names the
    // real close, the only time no reply counts as a no.
    const replyBy = p.events.rsvp_reply_by && new Date(p.events.rsvp_reply_by).toISOString();
    // v0.11.35: no automatic reminders; an organizer's re-send to someone still pending who already got one
    // is the reminder ("RSVP sent" on the Participants page). Someone who said No gets the invitation again.
    let reminder = row.kind === 'rsvp_reminder';
    if (!reminder && p.status === 'pending') {
      const { count, error: sentError } = await opts.db.from('email_outbox').select('id', { count: 'exact', head: true })
        .eq('participant_id', participantId).in('kind', ['rsvp', 'rsvp_reminder']).eq('status', 'sent').neq('id', row.id);
      if (sentError) throw new Error(`rsvp history load failed (${sentError.code})`);
      reminder = (count ?? 0) > 0;
    }
    email = renderRsvpEmail({ firstName: p.first_name, event, rsvpUrl: `${opts.appOrigin}/rsvp#${token}`, closesAt, replyBy: earlierReplyBy(replyBy, closesAt, opts.now?.() ?? new Date()), reminder, now: opts.now?.() });
  } else if (row.kind === 'team_invite') {
    if (p.team_id !== null) return null; // joined a team since (v0.11.25): the invite no longer applies
    // v0.11.47: only invites they can still accept: forming open, the event not over, a team with room.
    if (!p.events.teams_open || Date.parse(p.events.ends_at) <= (opts.now ?? (() => new Date()))().getTime()) return null;
    const { data: invites, error: inviteError } = await opts.db.from('team_invites')
      .select('created_at, teams!inner(name, participants(count)), participants!team_invites_invited_by_fkey(first_name)')
      .eq('participant_id', participantId).order('created_at', { ascending: false });
    if (inviteError) throw new Error(`invite load failed (${inviteError.code})`);
    const open = invites.filter((i) => (i.teams.participants[0]?.count ?? 0) < 4);
    const invite = open[0];
    if (!invite) return null;
    invitesUpTo = invites[0]?.created_at;
    email = renderTeamInviteEmail({ firstName: p.first_name, inviter: invite.participants?.first_name ?? 'A teammate', team: invite.teams.name, event: event.name, appOrigin: opts.appOrigin, count: open.length });
  } else if (row.kind === 'profile_reminder') {
    // F14 (v0.9): only while their profile still isn't finished.
    if (p.emergency_name !== null && p.overnight !== null && p.team_status !== null) return null;
    email = renderProfileReminderEmail({ firstName: p.first_name, event: event.name, appOrigin: opts.appOrigin });
  } else if (row.kind === 'event_eve') {
    // v0.12.3: the "See you tomorrow" check-in details; still accepted (checked above), no token.
    email = renderEventEveEmail({ firstName: p.first_name, event: event.name, appOrigin: opts.appOrigin });
  } else if (row.kind === 'pass_issued' || row.kind === 'pass_reissued') {
    // 2. Issue the pass. issue_pass() commits in its own transaction BEFORE the send (I-10).
    const passId = randomUUID();
    const token = passToken(opts.passSecret, passId);
    const { error: issueError } = await opts.db.rpc('issue_pass', {
      p_participant_id: participantId,
      p_token_hash: sha256hex(token),
      p_pass_id: passId,
    });
    if (issueError) throw new Error(`issue_pass failed (${issueError.code})`);
    const passUrl = `${opts.appOrigin}/p#${token}`;
    email = renderPassEmail({ firstName: p.first_name, event, passUrl, qrPng: await renderQrPng(passUrl), profileUrl: `${opts.appOrigin}/me/profile` });
  } else {
    // A kind this drainer doesn't know is never sent, least of all as a pass.
    return null;
  }

  return { to: p.email, ...email, fileLabel: toFileLabel(p.events.name, p.first_name), invitesUpTo };
}

// F9 step 1 (v0.11.12): an existing account added as staff. Read when sent, so it carries their current role,
// and is cancelled if they were removed before it went out.
async function staffEmail(opts: DrainOptions, row: OutboxRow): Promise<Outgoing | null> {
  const { data, error } = await opts.db.rpc('staff_email_target', { p_outbox_id: row.id });
  if (error) throw new Error(`staff_email_target failed (${error.code})`);
  if (data === null) return null;
  const t = z
    .object({ email: z.string(), name: z.string().nullable(), role: z.enum(['organizer', 'volunteer']), slug: z.string(), eventName: z.string(), startsAt: z.string(), timezone: z.string() })
    .parse(data);
  const email = renderStaffAddedEmail({ name: t.name, role: t.role, event: { name: emailEventName(t.slug, t.eventName), startsAt: t.startsAt, timezone: t.timezone }, slug: t.slug, appOrigin: opts.appOrigin });
  return { to: t.email, ...email, fileLabel: toFileLabel(t.eventName, 'staff') };
}
