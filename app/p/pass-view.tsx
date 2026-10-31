'use client';

import { BrandMark } from '@/components/brand-mark';
import { Entrance } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';

import Link from 'next/link';
import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { formatEventDateTime } from '@/lib/domain/event-time';
import { QR_OPTIONS } from '@/lib/qr/options';

interface ActivePass {
  state: 'active';
  firstName: string;
  event: { name: string; venue: string; startsAt: string; timezone: string };
  profile: { public: boolean; hasLinkedin: boolean };
}

type View =
  | { kind: 'loading' }
  | { kind: 'active'; pass: ActivePass }
  | { kind: 'replaced' | 'cancelled' | 'not_found' | 'rate_limited' | 'error' };

const APP_ORIGIN = process.env.NEXT_PUBLIC_APP_ORIGIN ?? '';

function readToken(): string {
  try {
    return decodeURIComponent(window.location.hash.replace(/^#/, '')).trim();
  } catch {
    return ''; // malformed %-escapes
  }
}

function subscribeHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function isActivePass(v: unknown): v is ActivePass {
  return typeof v === 'object' && v !== null && 'state' in v && v.state === 'active' && 'firstName' in v && 'event' in v;
}

async function fetchPass(token: string): Promise<View> {
  try {
    const res = await fetch('/api/pass', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
      cache: 'no-store',
    });
    if (res.status === 429) return { kind: 'rate_limited' };
    if (res.status === 404) return { kind: 'not_found' };
    if (!res.ok) return { kind: 'error' };
    const body: unknown = await res.json();
    if (isActivePass(body)) return { kind: 'active', pass: body };
    const state = typeof body === 'object' && body !== null && 'state' in body ? body.state : null;
    return { kind: state === 'replaced' || state === 'cancelled' ? state : 'error' };
  } catch {
    return { kind: 'error' };
  }
}

export function PassView() {
  // Each answer remembers its token, so a new #token shows "Loading" instead of the previous pass's status.
  const [loaded, setLoaded] = useState<{ token: string; view: View } | null>(null);
  const [reloads, setReloads] = useState(0);
  // The fragment is only readable in the browser; on the server render the token is null (loading).
  const token = useSyncExternalStore(subscribeHash, readToken, () => null);
  const reload = useCallback(() => setReloads((n) => n + 1), []);

  useEffect(() => {
    if (!token) return;
    let stale = false;
    void fetchPass(token).then((next) => {
      if (!stale) setLoaded({ token, view: next });
    });
    return () => {
      stale = true;
    };
  }, [token, reloads]);

  const shown: View = token === '' ? { kind: 'not_found' } : loaded && loaded.token === token ? loaded.view : { kind: 'loading' };

  return (
    <Entrance><main className="max-w-[480px] lg:pointer-fine:max-w-[760px]  m-[0px_auto] p-[24px_16px_56px] flex flex-col gap-[16px] [:where(&)_>_*]:mt-0

          [:where(&)_>_*]:mb-0">
      {/* Same header row as the /me pages. */}
      <div className="flex items-center gap-[16px] min-h-[44px]">
        <Link className="inline-flex shrink-0 items-center min-h-[44px] text-fg font-semibold no-underline [&:hover]:text-accent" href="/me">
          ← Menu
        </Link>
        <BrandMark name={shown.kind === 'active' ? shown.pass.event.name : undefined} className="max-w-[70%]" />
        <span aria-hidden="true" className="min-w-3 flex-1 h-px bg-[var(--edge)]" />
      </div>
      {shown.kind === 'loading' && <p aria-live="polite">Loading your pass…</p>}
      {shown.kind === 'active' && token && <ActiveView pass={shown.pass} token={token} />}
      {shown.kind === 'replaced' && (
        <Status tone="warn" icon="!" title="This pass was replaced">
          Check your most recent email for your current pass.
        </Status>
      )}
      {shown.kind === 'cancelled' && (
        <Status tone="bad" icon="✕" title="This pass is no longer valid">
          Please contact the organizers.
        </Status>
      )}
      {shown.kind === 'not_found' && (
        <Status tone="bad" icon="?" title="Pass not found">
          Open the link from your pass email again.
        </Status>
      )}
      {shown.kind === 'rate_limited' && (
        <Status tone="warn" icon="!" title="Too many attempts">
          Please wait a minute and reload the page.
        </Status>
      )}
      {shown.kind === 'error' && (
        <Status tone="warn" icon="!" title="Couldn't load your pass">
          Check your connection and try again.{' '}
          <Button type="button" onClick={reload}>
            Retry
          </Button>
        </Status>
      )}
    </main></Entrance>
  );
}

function Status(props: { tone: 'warn' | 'bad'; icon: string; title: string; children: React.ReactNode }) {
  return (
    <Card className="tw-pass-card flex flex-col gap-[12px] [background:var(--card)] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-card p-[20px] shadow-panel [:where(&)_>_*]:m-0

          [&_h2]:text-[18px] [&.tw-pass-card]:flex-row [&.tw-pass-card]:gap-[12px] [&.tw-pass-card]:items-start

          [&.tw-pass-card_h1]:m-[0px_0px_4px] [&.tw-pass-card_h1]:text-[22px] [&.tw-pass-card_p]:m-0" asChild><section  role="status">
      <span className={` text-[28px] leading-[1] ${({ warn: 'text-warn', bad: 'text-bad', ok: 'text-ok' })[props.tone]}`} aria-hidden="true">
        {props.icon}
      </span>
      <div>
        <h1>{props.title}</h1>
        <p>{props.children}</p>
      </div>
    </section></Card>
  );
}

function ActiveView({ pass, token }: { pass: ActivePass; token: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // I-4: the payload is exactly `${APP_ORIGIN}/p#${token}`.
    const el = canvas.current;
    if (!el) return;
    void QRCode.toCanvas(el, `${APP_ORIGIN}/p#${token}`, QR_OPTIONS).then(() => {
      // toCanvas pins an inline 600 px size; let the stylesheet size it to the screen instead.
      el.style.removeProperty('width');
      el.style.removeProperty('height');
    });
  }, [token]);

  return (
    <>

      <section className="overflow-hidden [overflow-wrap:anywhere] [background:var(--card)] [border-width:1px]

          [border-style:solid] [border-top-color:var(--line)] [border-right-color:var(--line)]

          [border-bottom-color:var(--line)] [border-left-color:var(--line)] rounded-ticket shadow-panel" aria-labelledby="pass-name">
        <div className="grid [justify-items:center] gap-[4px] p-[24px_20px_20px] text-center [:where(&)_>_*]:m-0">
          <h1 id="pass-name" className="text-[32px] leading-[1.15] [overflow-wrap:anywhere]">
            {pass.firstName}
          </h1>
          <canvas ref={canvas} className="block w-[min(100%,_300px)] h-auto [background:rgb(255,_255,_255)] rounded-md

          [image-rendering:pixelated]" role="img" aria-label="Your check-in QR code" />
        </div>
        <dl className="grid [grid-template-columns:repeat(auto-fit,_minmax(160px,_1fr))] gap-[16px] m-0 p-[16px_20px_20px]

          [border-top-width:1px] [border-top-style:dashed] [border-top-color:var(--line)] [&_dt]:text-muted-foreground

          [&_dt]:text-[12px] [&_dt]:tracking-[0.08em] [&_dt]:uppercase [&_dd]:m-[4px_0px_0px] [&_dd]:font-semibold">
          <div>
            <dt>When</dt>
            <dd>{formatEventDateTime(pass.event.startsAt, pass.event.timezone)}</dd>
          </div>
          <div>
            <dt>Where</dt>
            <dd>{pass.event.venue}</dd>
          </div>
        </dl>
      </section>
      {/* Keyed so another pass opened in this tab (hash change) never shows the previous pass's setting. */}
      <ProfileSection key={`${token}:${pass.profile.public}`} pass={pass} token={token} />
    </>
  );
}

// SPEC §6.5: opt-in, off by default. The token travels only in the PATCH body (I-3).
function ProfileSection({ pass, token }: { pass: ActivePass; token: string }) {
  const [on, setOn] = useState(pass.profile.public);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  async function onToggle(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.checked;
    setOn(next); // shown at once; put back if the save fails
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/pass', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, profilePublic: next }),
      });
      if (res.ok) {
        setMessage({ tone: 'ok', text: next ? 'Your badge profile is shared.' : 'Your badge profile is hidden.' });
      } else {
        setOn(!next);
        setMessage({ tone: 'bad', text: res.status === 429 ? 'Too many attempts. Please wait a minute.' : 'Couldn’t save. Please try again.' });
      }
    } catch {
      setOn(!next);
      setMessage({ tone: 'bad', text: 'Couldn’t save. Check your connection and try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="tw-pass-card flex flex-col gap-[12px] [background:var(--card)] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-card p-[20px] shadow-panel [:where(&)_>_*]:m-0

          [&_h2]:text-[18px]" asChild><section  aria-labelledby="profile-heading">
      <h2 id="profile-heading">Badge profile (optional)</h2>
      <Label className="flex gap-[12px] items-center min-h-[44px] font-semibold [&_input]:w-[22px] [&_input]:h-[22px]

          [&_input]:[flex:0_0_auto] [&_input]:[accent-color:var(--accent)]">
        <input type="checkbox" checked={on} onChange={onToggle} disabled={busy} />
        Show my name and profile links to anyone who taps my badge
      </Label>
      <Alert className={` [&:empty]:mt-[-12px] [&:empty]:p-0 [&:empty]:border-0 [&:empty]:bg-transparent [&:empty]:shadow-none ${message ? ({ warn: 'text-warn', bad: 'text-bad', ok: 'text-ok' })[message.tone] : ''}`} asChild role="status"><p  role="status" aria-live="polite">
        {message ? `${message.tone === 'ok' ? '✓' : '✕'} ${message.text}` : ''}
      </p></Alert>
    </section></Card>
  );
}
