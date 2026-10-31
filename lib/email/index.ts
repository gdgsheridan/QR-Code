import 'server-only';
import { env } from '@/lib/env';
import { createConsoleProvider } from './console';
import type { EmailProvider } from './provider';
import { createResendProvider } from './resend';

let resend: EmailProvider | undefined;

export function getProvider(): EmailProvider {
  const e = env();
  if (e.EMAIL_PROVIDER === 'resend') {
    // CLAUDE.md: never call a real email provider from tests.
    if (process.env.NODE_ENV === 'test') throw new Error('EMAIL_PROVIDER=resend is not allowed in tests');
    // One per server instance, so its send pacing (v0.11.25) spans every drain the instance runs.
    resend ??= createResendProvider({ apiKey: e.RESEND_API_KEY ?? '' });
    return resend;
  }
  return createConsoleProvider();
}

export function emailFrom(): string {
  return env().EMAIL_FROM ?? 'Datathon <passes@localhost>';
}
