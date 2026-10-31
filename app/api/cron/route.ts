import { bearerMatches } from '@/lib/auth/secret';
import { db } from '@/lib/db/server';
import { emailFrom, getProvider } from '@/lib/email';
import { drainUntilIdle } from '@/lib/email/drain';
import { cronSecret, env } from '@/lib/env';
import { route } from '@/lib/http/route';

// v0.11.25: room to send a few hundred RSVPs in one run (5 a second) instead of ~120 per 25 s run (Vercel Pro: 300 s).
export const maxDuration = 300;
const DRAIN_BUDGET_MS = 240_000;

// SPEC F4/F13 (v0.9): the scheduler's job every few minutes (Bearer CRON_SECRET only). Expire missed RSVP
// deadlines and queue due reminders, then send whatever is waiting, including retries of failed sends.
export const POST = route(async (request) => {
  if (!bearerMatches(request.headers.get('authorization'), cronSecret(env()))) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { data: jobs, error } = await db().rpc('run_rsvp_jobs', {});
  // Send whatever is waiting even if the jobs failed: retries must not stop with them.
  const claimed = await drainUntilIdle({
    db: db(),
    provider: getProvider(),
    appOrigin: env().NEXT_PUBLIC_APP_ORIGIN,
    passSecret: env().PASS_TOKEN_SECRET,
    from: emailFrom(),
  }, DRAIN_BUDGET_MS);
  if (error) throw new Error(`run_rsvp_jobs failed (${error.code})`);
  return Response.json({ jobs, claimed });
});
// Vercel Cron calls GET with `Authorization: Bearer $CRON_SECRET` (its own env var, set to the scheduler value).
export const GET = POST;
