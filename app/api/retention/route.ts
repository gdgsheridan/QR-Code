import { bearerMatches } from '@/lib/auth/secret';
import { db } from '@/lib/db/server';
import { cronSecret, env } from '@/lib/env';
import { route } from '@/lib/http/route';
import { runRetention } from '@/lib/privacy/retention';

// SPEC §15 retention, run daily by the same scheduler as the outbox drain (Bearer CRON_SECRET).
// Vercel Cron cannot send a custom header, so this endpoint intentionally shares the scheduler
// credential instead of getting its own (L1); the mail drainer (/api/email/drain) is the one
// with a separate secret.
export const POST = route(async (request) => {
  if (!bearerMatches(request.headers.get('authorization'), cronSecret(env()))) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  return Response.json(await runRetention(db(), new Date()));
});
// Vercel Cron calls GET with `Authorization: Bearer $CRON_SECRET` (its own env var, set to the scheduler value).
export const GET = POST;
