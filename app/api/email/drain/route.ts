import { bearerMatches } from '@/lib/auth/secret';
import { cookieAuthenticator } from '@/lib/auth/session';
import { isOrganizerOfAnyEvent } from '@/lib/auth/staff';
import { db } from '@/lib/db/server';
import { drainOutbox } from '@/lib/email/drain';
import { emailFrom, getProvider } from '@/lib/email';
import { emailDrainSecret, env } from '@/lib/env';
import { route } from '@/lib/http/route';

// SPEC §9.3 / F4: Bearer EMAIL_DRAIN_SECRET (scheduler) or an organizer session ("Send pending" button).
export const POST = route(async (request) => {
  const bySecret = bearerMatches(request.headers.get('authorization'), emailDrainSecret(env()));
  if (!bySecret) {
    const user = await cookieAuthenticator(request);
    if (!user || !(await isOrganizerOfAnyEvent(db(), user.id))) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
  }
  const result = await drainOutbox({
    db: db(),
    provider: getProvider(),
    appOrigin: env().NEXT_PUBLIC_APP_ORIGIN,
    passSecret: env().PASS_TOKEN_SECRET,
    from: emailFrom(),
  });
  return Response.json(result);
});
