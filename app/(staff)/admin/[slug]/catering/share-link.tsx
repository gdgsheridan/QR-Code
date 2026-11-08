'use client';

import { Button } from '@/components/ui/button';

import { useState } from 'react';
import { adminUrl, errorText, useApi } from '../api';
import { ConfirmDialog } from '../dialog';

// §11 (v0.11.39): like a doc's "anyone with the link" button. The first Copy makes the link; Reset link replaces it,
// and the old link stops working at once.
export function ShareLink({ slug, shareUrl, onChange }: { slug: string; shareUrl: string | null; onChange: (url: string) => void }) {
  const api = useApi();
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function newLink(): Promise<string | null> {
    setBusy(true);
    const r = await api<{ shareUrl: string }>(adminUrl(slug, '/catering/link'), { method: 'POST' });
    setBusy(false);
    if (!r.ok) {
      if (r.status !== 401) setStatus(`✕ ${errorText(r)}`);
      return null;
    }
    onChange(r.data.shareUrl);
    return r.data.shareUrl;
  }

  async function copy(url: string | null, done: string) {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setStatus(done);
    } catch {
      setStatus(`Couldn’t copy. The link is: ${url}`); // no clipboard (plain http): show it to select instead
    }
  }

  return (
    <div className="grid justify-items-end gap-1">
      <div className="flex flex-wrap gap-2">
        {shareUrl && (
          <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => setConfirming(true)}>
            Reset link
          </Button>
        )}
        <Button type="button" className="min-h-11" disabled={busy} onClick={async () => copy(shareUrl ?? (await newLink()), '✓ Link copied. Anyone with it can see this page.')}>
          Copy link
        </Button>
      </div>
      <p role="status" className="m-0 max-w-[min(100%,_420px)] text-right text-xs text-muted-foreground [overflow-wrap:anywhere]">{status}</p>
      {confirming && (
        <ConfirmDialog
          title="Reset the share link?"
          body={<p>The current link stops working right away, for everyone who has it. You get a new link to share.</p>}
          confirmLabel="Reset link"
          danger
          onConfirm={async () => {
            setConfirming(false);
            await copy(await newLink(), '✓ New link copied. The old one no longer works.');
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
