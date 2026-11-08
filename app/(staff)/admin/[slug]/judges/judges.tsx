'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { useCallback, useRef, useState } from 'react';
import type { Judge } from '@/lib/admin/judges';
import { linkNotice, normalizeUid } from '@/lib/domain/badge';
import { useBadgeWrite } from '@/lib/scanner/badge-write';
import { useNfcReader, nfcSupported, type NfcTag } from '@/lib/scanner/nfc';
import { adminUrl, errorText, useApi, useLoad } from '../api';
import { ConfirmDialog, Modal } from '../dialog';
import { PageHeader } from '../page-header';


// SPEC §11 Judges (v0.12.4, owner's request): give each judge a LinkedIn and link their badge, which then
// opens their name, "Judge", title and LinkedIn when tapped (§6.5). Badges link on Android Chrome only (Web NFC).
export function Judges({ slug, badgeOrigin }: { slug: string; badgeOrigin: string }) {
  const api = useApi();
  const [judges, setJudges] = useState<Judge[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<{ judges: Judge[] }>(adminUrl(slug, '/judges'));
    if (r.ok) setJudges(r.data.judges);
    else if (r.status !== 401) setError(errorText(r));
  }, [api, slug]);
  useLoad(load);


  const [drafts, setDrafts] = useState<Record<string, string>>({});
  async function saveLinkedin(j: Judge) {
    const value = drafts[j.id] ?? j.linkedinUrl ?? '';
    const r = await api<{ linkedinUrl: string | null }>(adminUrl(slug, `/judges/${j.id}`), { method: 'PATCH', body: { linkedin: value } });
    if (!r.ok) return setMessage(`✕ ${errorText(r)}`);
    setDrafts((d) => {
      const rest = { ...d };
      delete rest[j.id];
      return rest;
    });
    setMessage(r.data.linkedinUrl ? `✓ LinkedIn saved for ${j.name}.` : `✓ LinkedIn cleared for ${j.name}.`);
    await load();
  }

  // Link badge: the same tap flow as the Participants page (write the profile link, then save the link).
  const badgeWrite = useBadgeWrite(badgeOrigin);
  const [target, setTarget] = useState<Judge | null>(null);
  const [badgeError, setBadgeError] = useState<string | null>(null);
  const [badgeBusy, setBadgeBusy] = useState(false);
  const linking = useRef(false);
  async function link(tag: NfcTag, reader: NDEFReader, judge: Judge) {
    if (linking.current) return;
    const uid = normalizeUid(tag.serial);
    if (!uid) return setBadgeError('Couldn’t read that badge. Hold it still and tap again.');
    linking.current = true;
    setBadgeBusy(true);
    const write = await badgeWrite.write(tag, reader, uid);
    nfc.stop();
    const r = await api<{ code?: string; from?: string }>(adminUrl(slug, `/judges/${judge.id}/badge`), { method: 'POST', body: { uid } });
    setTarget(null);
    setBadgeBusy(false);
    const code = r.ok ? r.data.code : r.status === 404 ? 'NOT_FOUND' : undefined;
    const moved = r.ok && r.data.from ? ` It was ${r.data.from}’s badge, so it’s unlinked from them.` : '';
    setMessage(`${linkNotice(code, uid, judge.name, write).text}${moved}`);
    await load();
  }
  const nfc = useNfcReader({
    prefKey: 'station:judge-linker',
    defaultOn: false,
    autoStart: false,
    onTag: (tag, reader) => {
      badgeWrite.observe(tag.serial);
      if (target) void link(tag, reader, target);
    },
    onUnreadable: () => {
      if (target && !linking.current) setBadgeError('Couldn’t read that badge. Hold it still and tap again.');
    },
  });
  function startLink(j: Judge) {
    linking.current = false;
    setTarget(j);
    setBadgeError(null);
    if (nfc.state === 'off') void nfc.start(); // this click is the user gesture Chrome needs
  }
  function cancelLink() {
    badgeWrite.cancel();
    linking.current = true;
    nfc.stop();
    setTarget(null);
  }

  const [pending, setPending] = useState<{ kind: 'unlink' | 'delete'; judge: Judge } | null>(null);
  async function act(kind: 'unlink' | 'delete', j: Judge) {
    setPending(null);
    const r = await api<{ code?: string }>(adminUrl(slug, `/judges/${j.id}${kind === 'unlink' ? '/badge' : ''}`), { method: 'DELETE' });
    if (!r.ok && r.status !== 404) return setMessage(`✕ ${errorText(r)}`);
    setMessage(kind === 'unlink' ? `✓ Badge unlinked from ${j.name}.` : `✓ ${j.name} removed from the judges.`);
    await load();
  }

  const canLink = nfcSupported();
  return (
    <div className="grid gap-[24px] min-w-0 pb-[32px]">
      <PageHeader title="Judges" description="Add each judge’s LinkedIn and link their badge: tapping it opens their name, title and LinkedIn." />

      {error && <p role="alert" className="m-0 text-bad">✕ {error}</p>}
      {/* Only when there is something to say (an always-there empty line left an odd gap under the header). */}
      {message && (
        <p role="status" className={`m-0 p-[12px_16px] rounded-md text-[13px] leading-[1.6] [overflow-wrap:anywhere] [border:1px_solid] ${
          message.startsWith('✕')
            ? '[border-color:color-mix(in_srgb,var(--bad)_40%,var(--line))] [background:color-mix(in_srgb,#f87171_6%,var(--card))]'
            : '[border-color:color-mix(in_srgb,var(--ok)_40%,var(--line))] [background:color-mix(in_srgb,#4ade80_6%,var(--card))]'}`}>
          {message}
        </p>
      )}

      {judges && judges.length === 0 && <p className="copy text-muted-foreground">No judges yet.</p>}
      {judges && judges.length > 0 && (
        // One card per judge (a table cut the LinkedIn field and buttons off on a phone): stacked on a phone, three
        // columns from md up.
        <ul className="m-0 p-0 list-none grid gap-[10px]" aria-label="Judges">
          {judges.map((j) => {
            const draft = drafts[j.id] ?? j.linkedinUrl ?? '';
            return (
              <li key={j.id} aria-label={j.name} className="grid gap-[12px] p-[14px_16px] rounded-lg [border:1px_solid_var(--line)] [background:var(--card)]
                md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_430px] md:items-center">
                <div className="min-w-0">
                  <div className="font-semibold [overflow-wrap:anywhere]">{j.name}</div>
                  {j.title && <div className="text-muted-foreground text-[13px] [overflow-wrap:anywhere]">{j.title}</div>}
                </div>
                <form className="flex gap-[8px] items-center min-w-0" onSubmit={(e) => { e.preventDefault(); void saveLinkedin(j); }}>
                  <Input aria-label={`LinkedIn for ${j.name}`} className="min-h-[44px] flex-1 min-w-0" placeholder="linkedin.com/in/…" value={draft} onChange={(e) => setDrafts((d) => ({ ...d, [j.id]: e.target.value }))} />
                  <Button type="submit" variant="outline" size="sm" disabled={draft === (j.linkedinUrl ?? '')}>Save</Button>
                </form>
                <div className="flex flex-wrap gap-[8px] items-center md:justify-end">
                  {/* Their profile: the same card their badge opens (§6.5), with or without a badge. */}
                  <Button size="sm" variant="outline" asChild>
                    <a href={`/judge/${j.id}`} target="_blank" rel="noopener" aria-label={`Open ${j.name}’s profile`}>Profile ↗</a>
                  </Button>
                  {canLink && (
                    <Button type="button" size="sm" variant="outline" disabled={badgeBusy} aria-label={`${j.badgeUid ? 'Replace' : 'Link'} badge for ${j.name}`} onClick={() => startLink(j)}>
                      {j.badgeUid ? 'Replace badge' : 'Link badge'}
                    </Button>
                  )}
                  {j.badgeUid ? <span className="text-ok text-[13px]">✓ Badge linked</span> : <span className="text-muted-foreground text-[13px]">No badge</span>}
                  {j.badgeUid && (
                    <Button type="button" size="sm" variant="ghost" aria-label={`Unlink badge for ${j.name}`} onClick={() => setPending({ kind: 'unlink', judge: j })}>Unlink</Button>
                  )}
                  <Button type="button" size="sm" variant="ghost" aria-label={`Remove ${j.name}`} onClick={() => setPending({ kind: 'delete', judge: j })}>Remove</Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {target && (
        <Modal title="Link a badge" onCancel={cancelLink}>
          <p className="copy">Tap the badge to link it to {target.name}. Hold it on the phone until this closes.</p>
          <div aria-live="polite">
            {badgeBusy ? <p>Linking badge…</p> : (badgeError || nfc.error) && <p className="text-bad">{badgeError ?? nfc.error}</p>}
          </div>
          <div className="flex gap-[8px] justify-end flex-wrap mt-[8px] pt-[14px] [border-top:1px_solid_var(--line)]">
            {nfc.state === 'off' && !badgeBusy && <Button type="button" onClick={() => void nfc.start()}>Start badge reader</Button>}
            <Button type="button" variant="outline" onClick={cancelLink}>Cancel</Button>
          </div>
        </Modal>
      )}
      {pending && (
        <ConfirmDialog
          title={pending.kind === 'unlink' ? 'Unlink this badge?' : `Remove ${pending.judge.name}?`}
          body={<p>{pending.kind === 'unlink' ? `${pending.judge.name}’s badge stops opening their profile until it’s linked again.` : 'They leave the judge list, and their badge stops opening their profile. An import adds them back.'}</p>}
          confirmLabel={pending.kind === 'unlink' ? 'Unlink badge' : 'Remove'}
          danger
          onConfirm={() => void act(pending.kind, pending.judge)}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
