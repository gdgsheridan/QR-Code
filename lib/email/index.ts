import 'server-only';
import { env } from '@/lib/env';
import { createConsoleProvider, isLocalDatabase } from './console';
import type { EmailProvider } from './provider';
import { createResendProvider } from './resend';

export function getProvider(): EmailProvider {
  const e = env();
  if (e.EMAIL_PROVIDER === 'resend') {
    // CLAUDE.md: never call a real email provider from tests.
    if (process.env.NODE_ENV === 'test') throw new Error('EMAIL_PROVIDER=resend is not allowed in tests');
    return createResendProvider({ apiKey: e.RESEND_API_KEY ?? '' });
  }
  // v0.11.26: a dev server on the live database must not "send" its emails to ./.mail; the deployed cron sends them.
  return createConsoleProvider({ holdQueue: !isLocalDatabase(e.NEXT_PUBLIC_SUPABASE_URL) });
}

export function emailFrom(): string {
  return env().EMAIL_FROM ?? 'Datathon <passes@localhost>';
}
