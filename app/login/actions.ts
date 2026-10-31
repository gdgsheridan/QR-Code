'use server';

import { createClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { z } from 'zod';
import { isAdminEmail } from '@/lib/auth/admins';
import { safeNextPath } from '@/lib/auth/next-path';
import { landingAfterSignIn } from '@/lib/auth/onboarding';
import { supabaseForRequest } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { normalizeEmail } from '@/lib/domain/normalize';
import { env } from '@/lib/env';
import { clientIpKey } from '@/lib/http/ip';
import { emailKey, withinLimit } from '@/lib/pass/handlers';

// Never carries the email back: Next logs server-action arguments (incl. this state) in dev (I-11).
export type LoginState = { error: 'credentials' } | { sent: true } | null;

const emailSchema = z.string().transform(normalizeEmail).pipe(z.email());
const nextOf = (form: FormData) => safeNextPath(String(form.get('next') ?? ''), '/me');
// Postgres-backed limits (serverless has no shared memory), per email (emailKey).

// SPEC F9 (v0.4): email + password. One generic error, whether the email or the password was wrong.
export async function signIn(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = emailSchema.safeParse(form.get('email'));
  const password = z.string().min(1).max(200).safeParse(form.get('password'));
  if (!email.success || !password.success) return { error: 'credentials' };
  // Slows password guessing on one account: 10 tries per 15 min.
  if (!(await withinLimit(db(), emailKey('signin', email.data), 900, 10))) return { error: 'credentials' };
  // ... and on one machine across accounts: 30 tries per 15 min. Same generic error, nothing enumerable.
  if (!(await withinLimit(db(), clientIpKey(await headers(), 'signin'), 900, 30))) return { error: 'credentials' };
  const { data, error } = await (await supabaseForRequest()).auth.signInWithPassword({ email: email.data, password: password.data });
  if (error || !data.user) return { error: 'credentials' };
  redirect(await landingAfterSignIn(db(), data.user, nextOf(form), env().ADMIN_EMAILS));
}

// "Forgot or never set your password?": a reset link for an existing account, an invite (first
// password) for an accepted participant, invited staff member or admin email without one, nothing otherwise.
// The answer is the same in every case, so this can't be used to find out who has an account.
export async function sendPasswordLink(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = emailSchema.safeParse(form.get('email'));
  if (!email.success) return { sent: true };
  // At most 3 emails per address per hour, so nobody can flood someone's inbox; over the limit looks the same.
  if (!(await withinLimit(db(), emailKey('pwlink', email.data), 3600, 3))) return { sent: true };
  // ... and 10 per hour per machine across addresses; over the limit looks the same.
  if (!(await withinLimit(db(), clientIpKey(await headers(), 'pwlink'), 3600, 10))) return { sent: true };
  const { data: found, error } = await db().rpc('password_link_kind', { p_email: email.data });
  if (error) throw new Error(`password_link_kind failed (${error.code})`);
  const kind = found === 'none' && isAdminEmail(email.data, env().ADMIN_EMAILS) ? 'invite' : found;
  const confirm = (type: 'invite' | 'recovery') =>
    `${env().NEXT_PUBLIC_APP_ORIGIN}/auth/confirm?type=${type}&next=${encodeURIComponent(nextOf(form))}`;
  // Implicit flow: the emailed link must work in any browser, not only the one holding a PKCE verifier.
  const anon = () =>
    createClient(env().NEXT_PUBLIC_SUPABASE_URL, env().NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false },
    });
  const sent =
    kind === 'reset'
      ? await anon().auth.resetPasswordForEmail(email.data, { redirectTo: confirm('recovery') })
      : kind === 'invite'
        ? await db().auth.admin.inviteUserByEmail(email.data, { redirectTo: confirm('invite') })
        : { error: null };
  // Logged without the address (I-11); the person can simply ask again.
  if (sent.error) console.error(JSON.stringify({ level: 'warn', msg: 'password_link_failed', kind, code: sent.error.code ?? null }));
  return { sent: true };
}
