import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/lib/db/types.gen';
import { toFileLabel } from '@/lib/domain/file-label';
import { shownReplyBy } from '@/lib/domain/rsvp';
import { nextAttempt, sanitizeError } from '@/lib/domain/outbox';
import { generateToken, passToken, sha256hex } from '@/lib/domain/token';
import { renderQrPng } from '@/lib/qr/render';
import { ProviderError, type EmailMessage, type EmailProvider } from './provider';
import { renderPassEmail, type RenderedEmail } from './templates/pass';
import { renderProfileReminderEmail } from './templates/profile-reminder';
import { renderRsvpEmail } from './templates/rsvp';
import { renderStaffAddedEmail } from './templates/staff-added';
import { renderTeamInviteEmail } from './templates/team-invite';
import { emailEventName } from './links';

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
}

// SPEC F4. Safe to run concurrently: rows are claimed with FOR UPDATE SKIP LOCKED.
export async function drainOutbox(opts: DrainOptions): Promise<DrainResult> {
  if (opts.provider.holdQueue) return { claimed: 0, sent: 0, retrying: 0, failed: 0, cancelled: 0 };
  const { data: rows, error } = await opts.db.rpc('claim_outbox', { p_limit: opts.limit ?? 20 });
  if (error) throw new Error(`claim_outbox failed (${error.code})`);
  const result: DrainResult = { claimed: rows.length, sent: 0, retrying: 0, failed: 0, cancelled: 0 };
  for (const row of rows) result[await processRow(opts, row)] += 1;
  return result;
}

// Drains batch after batch until nothing is due or the time budget is spent (after() / cron runs).
export async function drainUntilIdle(opts: DrainOptions, budgetMs = 25_000): Promise<number> {
  const deadline = Date.now() + budgetMs;
  let claimed = 0;
  for (;;) {
    const r = await drainOutbox(opts);
    claimed += r.claimed;
    if (r.claimed === 0 || Date.now() > deadline) return claimed;
  }
}

async function finish(db: Db, args: FinishArgs): Promise<void> {
  const { error } = await db.rpc('finish_outbox', args);
  if (error) throw new Error(`finish_outbox failed (${error.code})`);
}

// What the drainer sends for one row; null cancels it.
type Outgoing = Pick<EmailMessage, 'to' | 'subject' | 'html' | 'text' | 'inlineImages' | 'fileLabel'>;

async function processRow(opts: DrainOptions, row: OutboxRow): Promise<Exclude<keyof DrainResult, 'claimed'>> {
  let providerId: string;
  try {
    const message = row.kind === 'staff_added' ? await staffEmail(opts, row) : await participantEmail(opts, row);
    if (!message) {
      await finish(opts.db, { p_id: row.id, p_status: 'cancelled' });
      return 'cancelled';
    }
    // 3. Send.
    ({ id: providerId } = await opts.provider.send({ ...message, from: opts.from, idempotencyKey: `${row.id}:${row.attempts}` }));
  } catch (err) {
    // 5. Failure: back off, or give up after the last attempt. last_error is sanitized (I-11).
    const next = nextAttempt({
      attempts: row.attempts,
      now: (opts.now ?? (() => new Date()))(),
      retryAfterSeconds: err instanceof ProviderError ? err.retryAfterSeconds : undefined,
    });
    const lastError = sanitizeError(err);
    if (next.status === 'failed') {
      await finish(opts.db, { p_id: row.id, p_status: 'failed', p_last_error: lastError });
      return 'failed';
    }
    await finish(opts.db, {
      p_id: row.id,
      p_status: 'pending',
      p_next_attempt_at: next.at.toISOString(),
      p_last_error: lastError,
    });
    return 'retrying';
  }

  // 4. Success. If this write fails, the row is retried and a second email goes out with a newer
  // code; only the newest works (accepted edge, SPEC F4).
  await finish(opts.db, { p_id: row.id, p_status: 'sent', p_provider_message_id: providerId });
  return 'sent';
}

// 1. Reload the participant; stop if they were deleted, or (for a pass) are no longer accepted,
// or (for an RSVP or its reminder, F13) already are.
async function participantEmail(opts: DrainOptions, row: OutboxRow): Promise<Outgoing | null> {
  const participantId = row.participant_id;
  if (participantId === null) return null;
  const { data: p, error } = await opts.db
    .from('participants')
    .select('first_name, email, status, deleted_at, emergency_name, overnight, team_status, events(slug, name, venue, starts_at, timezone, rsvp_reply_by)')
    .eq('id', participantId)
    .single();
  if (error) throw new Error(`participant load failed (${error.code})`);
  const accepted = p.status === 'accepted';
  const rsvp = row.kind === 'rsvp' || row.kind === 'rsvp_reminder';
  if (p.deleted_at !== null || (rsvp ? accepted : !accepted)) return null;
  const event = { name: emailEventName(p.events.slug, p.events.name), venue: p.events.venue, startsAt: p.events.starts_at, timezone: p.events.timezone };

  let email: RenderedEmail;
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
    // v0.11.27: they're asked to reply by the event's reply-by date while it's ahead; the invitation closes later.
    const replyBy = p.events.rsvp_reply_by && new Date(p.events.rsvp_reply_by).toISOString();
    email = renderRsvpEmail({ firstName: p.first_name, event, rsvpUrl: `${opts.appOrigin}/rsvp#${token}`, closesAt: shownReplyBy(replyBy, closesAt, opts.now?.() ?? new Date()), reminder: row.kind === 'rsvp_reminder' });
  } else if (row.kind === 'team_invite') {
    const { data: invite, error: inviteError } = await opts.db.from('team_invites')
      .select('teams!inner(name), participants!team_invites_invited_by_fkey(first_name)')
      .eq('participant_id', participantId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (inviteError) throw new Error(`invite load failed (${inviteError.code})`);
    if (!invite) return null;
    email = renderTeamInviteEmail({ firstName: p.first_name, inviter: invite.participants?.first_name ?? 'A teammate', team: invite.teams.name, event: event.name, appOrigin: opts.appOrigin });
  } else if (row.kind === 'profile_reminder') {
    // F14 (v0.9): only while their profile still isn't finished.
    if (p.emergency_name !== null && p.overnight !== null && p.team_status !== null) return null;
    email = renderProfileReminderEmail({ firstName: p.first_name, event: event.name, appOrigin: opts.appOrigin });
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

  return { to: p.email, ...email, fileLabel: toFileLabel(p.events.name, p.first_name) };
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
