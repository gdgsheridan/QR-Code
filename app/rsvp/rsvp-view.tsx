'use client';

import { BrandMark } from '@/components/brand-mark';
import { Entrance } from '@/components/motion';
import { Typewriter } from '@/components/typewriter';
import { Card } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { safeNextPath } from '@/lib/auth/next-path';
import { formatEventDateTime } from '@/lib/domain/event-time';
import { DISCORD_URL } from '@/lib/email/links';

interface Invite {
  firstName: string;
  event: { name: string; venue: string; startsAt: string; timezone: string };
  status: string;
  hasAccount: boolean;
  /** v0.6: the Sheet's dietary notes and LinkedIn, to prefill the Yes form. */
  profile: { dietaryNotes: string | null; linkedinUrl: string | null; profilePublic: boolean };
  /** v0.9: the reply-by time (null: no deadline), and whether it has passed for them. */
  closesAt: string | null;
  closed: boolean;
}

type View =
  | { kind: 'loading' | 'not_found' | 'rate_limited' | 'error' | 'not_going' | 'going' }
  | { kind: 'invite'; invite: Invite; yesForm: boolean; confirmNo?: boolean }
  | { kind: 'signed_in'; firstName: string };

function readToken(): string {
  try {
    return decodeURIComponent(window.location.hash.replace(/^#/, '')).trim();
  } catch {
    return ''; // malformed %-escapes
  }
}

async function post(body: object): Promise<{ status: number; data: Record<string, unknown> }> {
  try {
    const res = await fetch('/api/rsvp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, data: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
  } catch {
    return { status: 0, data: {} };
  }
}

const GIVE_AWAY = 'give away';

// v0.11.25: giving a spot away can't be undone after the deadline (and cancels an accepted hacker's pass),
// so it takes the words typed, not one tap.
function GiveAwayConfirm({ accepted, busy, onConfirm, onCancel }: { accepted: boolean; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const [typed, setTyped] = useState('');
  const ok = typed.trim().toLowerCase() === GIVE_AWAY;
  return (
    <form className="grid gap-[12px] [&_h2]:m-0 [&_h2]:text-[18px] [&>p]:m-0" onSubmit={(e) => { e.preventDefault(); if (ok) onConfirm(); }}>
      <h2>Give your spot away?</h2>
      <p className="copy text-muted-foreground text-[14px]">
        {accepted ? 'Your pass stops working and your spot goes to someone on the waitlist.' : 'Your spot goes to someone on the waitlist.'}
      </p>
      <Label htmlFor="give-away" className="text-[14px] font-medium">Type “{GIVE_AWAY}” to confirm</Label>
      <Input id="give-away" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} className="min-h-12 w-full" />
      <Button type="submit" variant="destructive" disabled={!ok || busy}>{busy ? 'Saving…' : 'Give my spot away'}</Button>
      <Button type="button" variant="link" className="font-normal" disabled={busy} onClick={onCancel}>Keep my spot</Button>
    </form>
  );
}

// SPEC F13: answer the invitation by its deadline (v0.9). Yes asks only for a password (v0.7.2: a new one
// without an account, their own with one), signs them in and offers profile setup (/me/profile, F14) or
// their menu; the pass is emailed. No gives the spot away (they can change their mind until the deadline).
export function RsvpView() {
  const router = useRouter();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // v0.11.25: another invitation opened in this tab (mail apps reuse tabs) changes only the fragment.
  const [hashes, setHashes] = useState(0);
  useEffect(() => {
    const onHash = () => { setView({ kind: 'loading' }); setError(null); setHashes((n) => n + 1); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    // A late answer from an abandoned lookup (React runs this twice in dev) must not reset an open form.
    let stale = false;
    const token = readToken();
    void (token ? post({ token }) : Promise.resolve({ status: 404, data: {} })).then((r) => {
      if (stale) return;
      setView(
        r.status === 200
          ? { kind: 'invite', invite: r.data as unknown as Invite, yesForm: false }
          : { kind: r.status === 404 ? 'not_found' : r.status === 429 ? 'rate_limited' : 'error' },
      );
    });
    return () => {
      stale = true;
    };
  }, [hashes]);

  async function respond(going: boolean, fields: Record<string, string | boolean> = {}) {
    setBusy(true);
    setError(null);
    const r = await post({ token: readToken(), going, ...fields });
    setBusy(false);
    if (r.status === 400 && r.data.error === 'weak_password') return setError('Use 8 to 72 characters for your password.');
    if (r.status === 400 && r.data.error === 'wrong_password') {
      // The server sees an account (maybe made by an earlier try of this form): ask for its password from now on.
      setView((v) => (v.kind === 'invite' ? { ...v, invite: { ...v.invite, hasAccount: true } } : v));
      return setError('That isn’t your Datathon password. Try again, or reset it on the sign-in page.');
    }
    if (r.status === 400 && r.data.error === 'password_required') return setError('Enter your password.');
    if (r.status === 404) return setView({ kind: 'not_found' });
    if (r.status === 409 && r.data.error === 'closed') return setView((v) => (v.kind === 'invite' ? { ...v, invite: { ...v.invite, closed: true } } : v));
    if (r.status !== 200) return setError(r.status === 429 ? 'Too many tries. Wait a minute and try again.' : 'Something went wrong. Try again.');
    if (r.data.code === 'NOT_GOING') return setView({ kind: 'not_going' });
    // Where the server says (staff may need onboarding first); only our own paths.
    if (r.data.signedIn === true) {
      const next = safeNextPath(typeof r.data.next === 'string' ? r.data.next : null, '/me');
      // Profile setup is offered, not forced; any other landing (staff onboarding) goes straight on.
      if (next !== '/me/profile') return router.push(next);
      return setView((v) => ({ kind: 'signed_in', firstName: v.kind === 'invite' ? v.invite.firstName : '' }));
    }
    setView({ kind: 'going' });
  }

  return (
    <Entrance><main className="min-h-dvh justify-center max-w-[480px] lg:pointer-fine:max-w-[760px]  m-[0px_auto] p-[24px_16px_56px] flex flex-col gap-[16px] [:where(&)_>_*]:mt-0

          [:where(&)_>_*]:mb-0">
      <BrandMark name={view.kind === 'invite' ? view.invite.event.name : undefined} className="min-h-11" />
      <Card className="[&>p]:m-0 [&>h2]:text-lg " asChild><section >
        {view.kind === 'loading' && <Alert asChild role="status"><p role="status">Loading…</p></Alert>}
        {view.kind === 'not_found' && (
          <>
            <h1>This invitation link doesn’t work</h1>
            <p className="copy">It may have been replaced by a newer email, or the event is over.</p>
            <Button className="self-start" asChild><a href="/login?next=%2Fme">Sign in</a></Button>
          </>
        )}
        {(view.kind === 'rate_limited' || view.kind === 'error') && (
          <>
            <h1>Couldn’t load your invitation</h1>
            <p className="copy">{view.kind === 'rate_limited' ? 'Too many tries. Wait a minute, then reload.' : 'Check your connection, then reload.'}</p>
          </>
        )}
        {view.kind === 'going' && (
          <>
            <h1>You’re going</h1>
            <p className="copy">We’re emailing your check-in pass. You can also see it on the Datathon site.</p>
            <p>
              <Button className="self-start" asChild><a  href="/login?next=%2Fme">
                Sign in to see your pass
              </a></Button>
            </p>
          </>
        )}
        {view.kind === 'signed_in' && (
          <Entrance><div className="grid gap-[16px] [&>p]:m-0">
            <h1>You’re in, {view.firstName}</h1>
            <p className="copy">Your check-in pass is on its way by email.</p>
            <p className="copy text-muted-foreground text-[14px]">Set up your hacker profile: emergency contact, overnight stay, allergies and your team. You can also do it later from your menu.</p>
            <Button asChild><a href="/me/profile?setup=1">Set up my hacker profile</a></Button>
            <Button variant="link" className="font-normal" asChild><a href="/me">Later</a></Button>
          </div></Entrance>
        )}
        {view.kind === 'not_going' && (
          <>
            <h1>Thanks for letting us know</h1>
            <p className="copy">Your spot goes to someone on the waitlist. Changed your mind? Until the RSVP deadline, open the invitation link again to say yes.</p>
          </>
        )}
        {view.kind === 'invite' && view.confirmNo && (
          <GiveAwayConfirm accepted={view.invite.status === 'accepted'} busy={busy}
            onConfirm={() => void respond(false)} onCancel={() => setView({ ...view, confirmNo: false })} />
        )}
        {view.kind === 'invite' && !view.confirmNo && view.invite.status === 'accepted' && (
          // v0.11.25: hackers reopen the invitation to find their pass; they're in, so say so.
          <div className="grid gap-[16px] [&>p]:m-0">
            <h1>You’re in, {view.invite.firstName}</h1>
            <p className="copy">Your check-in pass is in your email and on your menu.</p>
            <Button asChild><a href="/me">Open my pass and menu</a></Button>
            <Button type="button" variant="link" className="font-normal" disabled={busy} onClick={() => setView({ ...view, confirmNo: true })}>
              Can’t make it anymore?
            </Button>
          </div>
        )}
        {view.kind === 'invite' && !view.confirmNo && view.invite.status !== 'accepted' && (
          <>
            <Typewriter heading={view.invite.event.name} details={
              <p className="m-0 text-muted-foreground text-[14px]">
                {formatEventDateTime(view.invite.event.startsAt, view.invite.event.timezone)} · {view.invite.event.venue}
              </p>
            }>
              {view.invite.closed ? (
                <>
                  Hi {view.invite.firstName}. The RSVP deadline
                  {view.invite.closesAt && ` (${formatEventDateTime(view.invite.closesAt, view.invite.event.timezone)})`} has passed. If you still want to come, <a className="text-link underline" href={DISCORD_URL} rel="noopener" target="_blank">Ask the organizers on Discord</a>.
                </>
              ) : (
                <>
                  Hi {view.invite.firstName}, will you be there?
                  {view.invite.status === 'withdrawn' && ' (You said no. You can still change your mind.)'}
                  {view.invite.closesAt && (
                    <strong> Reply by {formatEventDateTime(view.invite.closesAt, view.invite.event.timezone)}.</strong>
                  )}
                </>
              )}
            </Typewriter>
            {view.invite.closed ? (
              // Too late for Yes; someone who hasn't answered can still give their spot away now.
              view.invite.status === 'pending' && (
                <div className="grid gap-[16px] [&_label_+_:is(input,_select,_textarea)]:mt-[-10px] [&_label]:text-[14px]

          [&_label]:font-medium [&_h2]:m-[12px_0px_-8px] [&_h2]:pt-[16px] [&_h2]:[border-top-width:1px]

          [&_h2]:[border-top-style:solid] [&_h2]:[border-top-color:var(--line)] [&_h2]:text-[18px]

          [&_h2:first-of-type]:mt-0 [&_h2:first-of-type]:pt-0 [&_h2:first-of-type]:[border-top:0px]">
                  <Button type="button" variant="link" className="whitespace-normal font-normal" disabled={busy} onClick={() => setView({ ...view, confirmNo: true })}>
                    No, give my spot away
                  </Button>
                </div>
              )
            ) : view.yesForm ? (
              <form
                className="grid gap-[16px] [&_label_+_:is(input,_select,_textarea)]:mt-[-10px] [&_label]:text-[14px]

          [&_label]:font-medium [&_h2]:m-[12px_0px_-8px] [&_h2]:pt-[16px] [&_h2]:[border-top-width:1px]

          [&_h2]:[border-top-style:solid] [&_h2]:[border-top-color:var(--line)] [&_h2]:text-[18px]

          [&_h2:first-of-type]:mt-0 [&_h2:first-of-type]:pt-0 [&_h2:first-of-type]:[border-top:0px]"
                onSubmit={(e) => {
                  e.preventDefault();
                  const d = new FormData(e.currentTarget);
                  const text = (k: string) => String(d.get(k) ?? '');
                  void respond(true, { password: text('password') });
                }}
              >
                <p className="copy m-0 text-muted-foreground text-[14px]">Then you can set up your hacker profile: emergency contact, overnight stay, allergies and your team.</p>
                {view.invite.hasAccount ? (
                  <>
                    <Label htmlFor="password">Your Datathon password</Label>
                    <Input id="password" name="password" type="password" required maxLength={200} autoComplete="current-password" className="min-h-12 w-full" />
                    <p className="copy m-0 text-muted-foreground text-[14px]">
                      You already have a Datathon account with this email.{' '}
                      <a className="min-h-[44px] [background:none] [border-width:0px] [border-style:none] [border-color:currentcolor]

          text-link underline [text-underline-offset:3px] [font-style:inherit] [font-variant:inherit] font-normal

          [font-stretch:inherit] [font-size:inherit] leading-[inherit] [font-family:inherit]

          [font-optical-sizing:inherit] [font-size-adjust:inherit] [font-kerning:inherit]

          [font-feature-settings:inherit] [font-variation-settings:inherit] [font-language-override:inherit]

          cursor-pointer [&:hover:not(:disabled)]:text-fg" style={{ display: 'inline-flex', alignItems: 'center' }} href="/login" target="_blank" rel="noopener">
                        Forgot it?
                      </a>
                    </p>
                  </>
                ) : (
                  <>
                    <Label htmlFor="password">Set a password for your Datathon account</Label>
                    <Input id="password" name="password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" className="min-h-12 w-full" />
                  </>
                )}
                <Button type="submit" disabled={busy}>
                  {busy ? 'Saving…' : 'Yes, I’m coming'}
                </Button>
              </form>
            ) : (
              <div className="grid gap-[16px] [&_label_+_:is(input,_select,_textarea)]:mt-[-10px] [&_label]:text-[14px]

          [&_label]:font-medium [&_h2]:m-[12px_0px_-8px] [&_h2]:pt-[16px] [&_h2]:[border-top-width:1px]

          [&_h2]:[border-top-style:solid] [&_h2]:[border-top-color:var(--line)] [&_h2]:text-[18px]

          [&_h2:first-of-type]:mt-0 [&_h2:first-of-type]:pt-0 [&_h2:first-of-type]:[border-top:0px]">
                <Button type="button" disabled={busy} onClick={() => setView({ ...view, yesForm: true })}>
                  Yes, I’m coming
                </Button>
                <Button type="button" variant="link" className="whitespace-normal font-normal" disabled={busy} onClick={() => setView({ ...view, confirmNo: true })}>
                  No, give my spot away
                </Button>
              </div>
            )}
            {error && (
              <Alert className="text-bad" asChild><p role="alert" >
                ✕ {error}
              </p></Alert>
            )}
          </>
        )}
      </section></Card>
    </main></Entrance>
  );
}
