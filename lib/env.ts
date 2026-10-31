import 'server-only';
import { z } from 'zod';
import { normalizeEmail } from '@/lib/domain/normalize';

const bareOrigin = z.url().refine((u) => new URL(u).origin === u, 'must be a bare origin, no trailing slash');

// SPEC §19. Parsed once, on first use; any problem throws with every bad key listed.
export const serverEnvSchema = z
  .object({
    NEXT_PUBLIC_APP_ORIGIN: bareOrigin,
    /** §6.5: written onto badge tags; defaults to NEXT_PUBLIC_APP_ORIGIN. */
    BADGE_ORIGIN: bareOrigin.optional(),
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    SHEET_INGEST_SECRET: z.string().min(32, 'must be at least 32 characters'),
    // L1: the mail-drain credential is separate from the scheduler credential. Vercel Cron sends
    // `Authorization: Bearer $CRON_SECRET` and cannot attach a custom header, so both cron-invoked
    // endpoints (/api/cron, /api/retention) share CRON_SECRET by design; /api/email/drain gets its
    // own EMAIL_DRAIN_SECRET. DRAIN_SECRET is the deprecated alias: when set, it backs both until
    // deployments set the new names (then remove it).
    DRAIN_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
    CRON_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
    EMAIL_DRAIN_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
    /** §6.1: pass tokens are derived from it. Changing it hides older passes on /me (scanning still works). */
    PASS_TOKEN_SECRET: z.string().min(32, 'must be at least 32 characters'),
    /** F9 (v0.4.1): comma-separated; these accounts are organizer on every event. */
    ADMIN_EMAILS: z
      .string()
      .optional()
      .transform((s) => (s ?? '').split(',').map(normalizeEmail).filter(Boolean)),
    GOOGLE_SERVICE_ACCOUNT_JSON: z.string().min(1).optional(),
    EMAIL_PROVIDER: z.enum(['console', 'resend']),
    RESEND_API_KEY: z.string().min(1).optional(),
    EMAIL_FROM: z.string().min(3).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.EMAIL_PROVIDER === 'resend') {
      for (const key of ['RESEND_API_KEY', 'EMAIL_FROM'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'required when EMAIL_PROVIDER=resend' });
      }
    }
    // Either the new name or the legacy DRAIN_SECRET must back each credential.
    if (!env.CRON_SECRET && !env.DRAIN_SECRET)
      ctx.addIssue({ code: 'custom', path: ['CRON_SECRET'], message: 'required (legacy DRAIN_SECRET accepted as fallback)' });
    if (!env.EMAIL_DRAIN_SECRET && !env.DRAIN_SECRET)
      ctx.addIssue({ code: 'custom', path: ['EMAIL_DRAIN_SECRET'], message: 'required (legacy DRAIN_SECRET accepted as fallback)' });
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Scheduler credential for the Vercel-cron endpoints (/api/cron, /api/retention). */
export function cronSecret(e: ServerEnv): string {
  return e.CRON_SECRET ?? e.DRAIN_SECRET ?? '';
}

/** Mail-drain credential for /api/email/drain (never the scheduler credential). */
export function emailDrainSecret(e: ServerEnv): string {
  return e.EMAIL_DRAIN_SECRET ?? e.DRAIN_SECRET ?? '';
}

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  // Empty strings in .env files mean "unset".
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ''));
  const result = serverEnvSchema.safeParse(cleaned);
  if (!result.success) {
    // Only key names and messages; never values (they are secrets).
    const problems = result.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${problems}`);
  }
  return result.data;
}

let cached: ServerEnv | undefined;

export function env(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
