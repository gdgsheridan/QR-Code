'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { CateringHacker } from '@/lib/admin/catering';
import { CateringView } from '../../(staff)/admin/[slug]/catering/catering';

type View = { kind: 'loading' } | { kind: 'ok'; event: string; hackers: CateringHacker[] } | { kind: 'not_found' | 'rate_limited' | 'error' };

function readToken(): string {
  try {
    return decodeURIComponent(window.location.hash.replace(/^#/, '')).trim();
  } catch {
    return ''; // malformed %-escapes
  }
}

// A new link pasted into the same tab only changes the fragment, so follow it.
function subscribeHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

async function fetchCatering(slug: string, token: string): Promise<View> {
  try {
    const res = await fetch('/api/catering', { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug, token }) });
    if (res.status === 404 || res.status === 400) return { kind: 'not_found' };
    if (res.status === 429) return { kind: 'rate_limited' };
    if (!res.ok) return { kind: 'error' };
    const body = (await res.json()) as { event: { name: string }; hackers: CateringHacker[] };
    return { kind: 'ok', event: body.event.name, hackers: body.hackers };
  } catch {
    return { kind: 'error' };
  }
}

const MESSAGES = {
  loading: 'Loading catering…',
  not_found: 'This link doesn’t work. It may have been reset: ask the organizers for the current one.',
  rate_limited: 'Too many requests. Wait a minute, then reload.',
  error: 'Couldn’t load the list. Check your connection and reload.',
};

export function SharedCatering({ slug }: { slug: string }) {
  const token = useSyncExternalStore(subscribeHash, readToken, () => '');
  const [view, setView] = useState<View>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => void fetchCatering(slug, token).then((v) => live && setView(v)), 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [slug, token]);

  return (
    <main className="mx-auto w-full max-w-[1400px] box-border p-[clamp(24px,_3vw,_44px)] max-[600.001px]:p-[22px_14px_32px]
      [&_h2]:m-[36px_0px_14px] [&_h2]:text-[20px] [&_h2]:font-semibold [&_h2]:tracking-[-0.025em]">
      <header className="mb-7 border-b border-[var(--line)] pb-[18px]">
        <h1 className="m-0 text-[clamp(32px,_2.8vw,_42px)] font-bold leading-[1.1] tracking-[-0.05em]">Catering</h1>
        {view.kind === 'ok' && <p className="m-[8px_0px_0px] text-sm text-muted-foreground">{view.event} · shared by the organizers, read-only</p>}
      </header>
      {view.kind === 'ok' ? <CateringView hackers={view.hackers} /> : <p role={view.kind === 'loading' ? 'status' : 'alert'}>{MESSAGES[view.kind]}</p>}
    </main>
  );
}
