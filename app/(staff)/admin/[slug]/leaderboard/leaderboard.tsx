'use client';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useCallback, useEffect, useRef, useState } from 'react';
import { adminUrl, errorText, useApi, useLoad } from '../api';
import { ConfirmDialog } from '../dialog';
import { PageHeader } from '../page-header';
import { ManageConnections } from './manage-connections';

interface Board {
  frozenAt: string | null;
  rows: Array<{ rank: number; name: string; points: number }>;
}

const REFRESH_MS = 10_000;

// SPEC F17 step 6 (v0.12): the top 10 by mutual connections, refreshed every 10 s, for the projector. Names are
// "First L." only. Freeze fixes the board before prizes; full screen hides everything else.
export function Leaderboard({ slug }: { slug: string }) {
  const api = useApi();
  const screen = useRef<HTMLElement>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    const r = await api<Board>(adminUrl(slug, '/leaderboard'));
    if (r.ok) {
      setBoard(r.data);
      setError(null);
    } else setError(errorText(r));
  }, [api, slug]);

  useLoad(load);
  useEffect(() => {
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  async function setFrozen(frozen: boolean) {
    setConfirming(false);
    setBusy(true);
    const r = await api<{ frozen: boolean }>(adminUrl(slug, '/leaderboard/freeze'), { method: 'POST', body: { frozen } });
    setBusy(false);
    if (r.ok) await load();
    else setError(errorText(r));
  }

  const frozen = board?.frozenAt != null;
  return (
    <div className="grid gap-[24px]">
      <PageHeader title="Leaderboard" description="Most connections, for the projector. Hackers only see their own rank.">
        <Button type="button" variant="outline" onClick={() => void screen.current?.requestFullscreen()}>
          Full screen
        </Button>
        <Button type="button" variant={frozen ? 'default' : 'outline'} disabled={busy || !board} onClick={() => (frozen ? void setFrozen(false) : setConfirming(true))}>
          {frozen ? 'Unfreeze' : 'Freeze leaderboard'}
        </Button>
      </PageHeader>
      {error && (
        <Alert className="text-bad" asChild>
          <p role="alert">✕ {error}</p>
        </Alert>
      )}
      {/* Projector sizes only in Full screen; on the admin page the board reads like the rest of it. */}
      <section
        ref={screen}
        aria-labelledby="board-heading"
        className="grid gap-[14px] p-[20px] rounded-card [background:var(--card)] [border-width:1px] [border-style:solid] [border-color:var(--line)] [&:fullscreen]:gap-[24px] [&:fullscreen]:p-[6vh_8vw] [&:fullscreen]:[background:var(--bg)]"
      >
        <div className="grid gap-[4px] text-center">
          <h2 id="board-heading" className="m-0 text-center justify-self-center text-[24px]! leading-[1.1] [:fullscreen_&]:text-[clamp(36px,_5vw,_72px)]!">
            Most connections
          </h2>
          {frozen && (
            <p className="m-0 text-foreground text-[16px] [:fullscreen_&]:text-[clamp(20px,_2.5vw,_36px)]" role="status">
              Final results
            </p>
          )}
        </div>
        {board && board.rows.length === 0 && <p className="text-center text-muted-foreground">No connections yet.</p>}
        {board && board.rows.length > 0 && (
          <ol className="m-0 p-0 list-none grid gap-[8px]">
            {board.rows.map((r) => (
              <li
                key={`${r.rank}-${r.name}`}
                className="flex items-center gap-[12px] p-[8px_14px] rounded-md [background:var(--raised)] text-[14px] [&:nth-child(-n+3)]:font-semibold [:fullscreen_&]:gap-[16px] [:fullscreen_&]:p-[12px_20px] [:fullscreen_&]:text-[clamp(18px,_2.6vw,_40px)]"
              >
                <span className="w-[3ch] text-muted-foreground tabular-nums">#{r.rank}</span>
                <span className="flex-1 min-w-0 [overflow-wrap:anywhere]">{r.name}</span>
                <span className="tabular-nums">
                  {r.points} <span className="text-muted-foreground text-[0.85em] [:fullscreen_&]:text-[0.6em]">{r.points === 1 ? 'connection' : 'connections'}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
      <ManageConnections slug={slug} onChange={() => void load()} />
      {confirming && (
        <ConfirmDialog
          title="Freeze the leaderboard?"
          body={<p className="copy">It stays as it is now until you unfreeze it. Hackers see their rank as of this moment.</p>}
          confirmLabel="Freeze leaderboard"
          onConfirm={() => void setFrozen(true)}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
