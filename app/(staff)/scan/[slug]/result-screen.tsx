'use client';

import { Entrance } from '@/components/motion';

import { useEffect, useRef, useState } from 'react';
import { formatCountdown } from '@/lib/domain/countdown';
import type { NfcState } from '@/lib/scanner/nfc';
import type { ResultView } from '@/lib/scanner/result-view';
import type { LinkState } from './link-sheet';

/** v0.12.2: a waiting door ADMIT reads their badge itself; this is that reading's state. */
export interface AdmitLink {
  state: LinkState;
  readerState: NfcState;
  readerError: string | null;
  /** Chrome needs a tap before this phone's reader can start (first use, or after an error). */
  needsTap: boolean;
  onStart: () => void;
  /** v0.12.4: stop the reader and start a fresh one, like leaving Chrome and coming back. */
  onReset: () => void;
}

const BODY = 'm-0 flex w-full flex-1 flex-col items-center justify-center gap-4 border-0 bg-transparent p-0 text-center font-mono text-base text-white whitespace-normal';

// SPEC §10.2: icon + text + colour together; names ≥ 32 px. Flat fills (Tailwind 700 shades) keep white text above 4.5:1.
// The full-screen result takes keyboard focus when it appears and hands it back on dismiss (A12). The assertive
// live region is a sibling of the dismiss button, never content inside it, so screen readers announce it reliably.
// Only green (and the "Not a Datathon code" notice) auto-dismiss; every problem needs a tap so the volunteer notices it.
// v0.12.1 (owner's decision): with `link` (door ADMIT, Web NFC only) check-in isn't finished until the badge is linked,
// so the screen has no dismiss area. v0.12.2 (owner's request): no Link badge button either: the reader is already on
// and a badge tap links it; Start badge reader shows only while Chrome still needs a tap to allow NFC.
export function ResultScreen({ view, shownAt, onDismiss, link }: { view: ResultView; shownAt: number; onDismiss: () => void; link?: AdmitLink }) {
  const tap = view.dismiss === 'tap';
  const mustLink = !!link;
  const linkStatus = !link ? null
    : link.state.kind === 'saving' ? { text: 'Linking badge…', bad: false }
    : link.state.kind === 'result' ? { text: link.state.notice.text, bad: link.state.notice.tone === 'bad' }
    : link.state.unreadable ? { text: 'Couldn’t read that badge. Hold it still and tap again.', bad: true }
    : link.readerError ? { text: `✕ ${link.readerError}`, bad: true }
    : null;
  // Only ask for the badge once the reader is on: a tap before that goes to Android, which opens the badge's page.
  const hint = !link ? (tap ? 'Tap to continue' : 'Tap to skip')
    : link.readerState === 'on' ? 'Hold their badge flat on the phone until it says linked'
    : link.readerState === 'off' && link.needsTap ? 'Tap Start badge reader, then their badge'
    : 'Starting badge reader…';
  const container = useRef<HTMLDivElement>(null);
  const previous = useRef<Element | null>(null);

  useEffect(() => {
    previous.current = document.activeElement;
    container.current?.focus();
    return () => {
      const back = previous.current;
      if (back instanceof HTMLElement && document.contains(back)) back.focus();
    };
  }, []);

  // Workshop cooldown: tick once a second from when the result appeared (performance.now() only measures elapsed time).
  const [tick, setTick] = useState(() => performance.now()); // shownAt is performance.now() too
  useEffect(() => {
    if (view.countdownMs === undefined) return;
    const t = setInterval(() => setTick(performance.now()), 1000);
    return () => clearInterval(t);
  }, [view.countdownMs]);
  const left = view.countdownMs === undefined ? null : view.countdownMs - Math.max(0, tick - shownAt);
  const countdownText = left === null ? null : left > 0 ? `Next workshop in ${formatCountdown(left)}` : 'They can check in to a workshop now';

  const announcement = [view.headline, view.name, view.tags?.join(', '), view.emphasis, view.detail, view.countdownMs !== undefined ? `Next workshop in ${formatCountdown(view.countdownMs)}` : null].filter(Boolean).join('. ');

  const body = (
    <>
      <Entrance pop><span className="tw-scanner-resultIcon text-[76px] leading-[1]" aria-hidden="true">
        {view.icon}
      </span></Entrance>
      <strong className="text-[clamp(28px,_4vw,_40px)] font-bold tracking-tight m-0">{view.headline}</strong>
      {view.name && <span className="text-[clamp(32px,_3vw,_38px)] font-bold m-0 [overflow-wrap:anywhere]">{view.name}</span>}
      {view.tags && (
        <ul className="m-0 flex list-none flex-wrap justify-center gap-2 p-0" data-testid="diet-tags">
          {view.tags.map((tag) => (
            <li key={tag} className="rounded-card border-2 border-white bg-white px-[14px] py-[6px] text-[22px] font-extrabold uppercase tracking-wide text-[#14532d]">{tag}</li>
          ))}
        </ul>
      )}
      {view.emphasis && <span className="text-[22px] font-extrabold [background:rgba(0,_0,_0,_0.22)] [border-width:1px] [border-style:solid]

          [border-color:rgba(255,_255,_255,_0.18)] p-[10px_16px] rounded-card">{view.emphasis}</span>}
      {countdownText && <span className="text-[28px] font-bold tabular-nums" data-testid="cooldown-timer">{countdownText}</span>}
      {view.detail && <span className="text-[17px] leading-[1.6] m-0 max-w-[520px] opacity-[0.9]">{view.detail}</span>}
      <span id="result-hint" className={mustLink ? 'mt-[8px] text-[20px] font-bold' : 'text-[14px] opacity-[0.78] mt-[8px]'}>
        {hint}
      </span>
      {link && (
        <div aria-live="polite" aria-atomic="true" className="w-full max-w-[460px]">
          {linkStatus && (
            <p
              className="m-0 rounded-card bg-white px-4 py-3 text-[18px] font-bold text-[#14532d] [overflow-wrap:anywhere] data-[bad=true]:text-[#b91c1c]"
              data-bad={linkStatus.bad}
              data-testid="admit-link-status"
            >
              {linkStatus.text}
            </p>
          )}
        </div>
      )}
    </>
  );

  return (
    <div
      ref={container}
      tabIndex={-1}
      className="fixed inset-0 z-20 m-0 flex w-full flex-col items-center justify-center gap-4 border-0 p-8 text-center font-mono text-base text-white whitespace-normal cursor-pointer
        focus-visible:outline-2 focus-visible:-outline-offset-8 focus-visible:outline-white
        data-[tone=green]:bg-[#15803d] data-[tone=amber]:bg-[#b45309] data-[tone=red]:bg-[#b91c1c]"
      data-tone={view.tone}
      data-testid="scan-result"
      data-shown-at={shownAt}
      data-dismiss={mustLink ? 'link' : tap ? 'tap' : 'auto'}
      onClick={mustLink ? undefined : onDismiss}
    >
      <p role="status" aria-live="assertive" className="sr-only">
        {announcement}
      </p>
      {mustLink ? (
        <div className={`${BODY} cursor-default`}>
          {body}
        </div>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          aria-describedby="result-hint"
          className={`${BODY} cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white`}
        >
          {body}
        </button>
      )}
      {link && link.needsTap && link.readerState === 'off' && link.state.kind !== 'saving' && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            link.onStart();
          }}
          aria-describedby="result-hint"
          className="mb-2 min-h-[60px] w-full max-w-[420px] cursor-pointer rounded-card border-2 border-solid border-white bg-white px-6 font-mono text-[20px] font-extrabold text-[#14532d]
            focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
        >
          Start badge reader
        </button>
      )}
      {link && link.readerState === 'on' && link.state.kind !== 'saving' && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            link.onReset();
          }}
          className="mb-2 min-h-[44px] cursor-pointer rounded-card border-2 border-solid border-white/70 bg-transparent px-5 font-mono text-[16px] font-bold text-white
            focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
        >
          Badge not reading? Reset badge reader
        </button>
      )}
    </div>
  );
}
