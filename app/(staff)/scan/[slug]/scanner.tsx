'use client';

import { BrandMark } from '@/components/brand-mark';
import { SectionLabel } from '@/components/section-label';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';

import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { linkNotice, normalizeUid } from '@/lib/domain/badge';
import { parseScannedText } from '@/lib/domain/scanned-text';
import type { ScanRequest } from '@/lib/scan/schema';
import { createDeduper, DEDUPE_WINDOW_MS } from '@/lib/scanner/dedupe';
import { playFeedback, unlockAudio, useNeedsTap, vibrateRead } from '@/lib/scanner/feedback';
import { useBadgeWrite } from '@/lib/scanner/badge-write';
import { nfcSupported, useNfcReader, type NfcTag } from '@/lib/scanner/nfc';
import { CameraError, createBarcodeScanner, type BarcodeScanner, type CameraFailure } from '@/lib/scanner/qr-scanner';
import { viewFor, type Outcome, type ResultView } from '@/lib/scanner/result-view';
import { nextNetworkDown, submitScan } from '@/lib/scanner/submit';
import { requestVoid, undoVisible } from '@/lib/scanner/undo';
import { keepScreenAwake } from '@/lib/scanner/wake-lock';
import { CheckpointPicker } from './checkpoint-picker';
import { LinkSheet, type LinkState } from './link-sheet';
import { ManualSearch, type Row } from './manual-search';
import { ResultScreen } from './result-screen';
import { ScannedHere } from './scanned-here';
import { CAMERA_KEY, checkpointKey, INPUT_KEY, KIND_LABEL, NFC_KEY, readPref, writePref, type Checkpoint, type InputMode } from './types';
import { UndoDialog } from './undo-dialog';

type CameraState = 'starting' | 'ready' | CameraFailure;

const subscribeOnline = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};

// Camera or NFC badges, one at a time (§10.1, v0.8.1): on a real Android phone a running camera stopped NFC
// reads. Saved per device like the checkpoint (kept in memory too, for private mode); NFC only with Web NFC.
let chosenInput: InputMode | null = null;
const inputListeners = new Set<() => void>();
const subscribeInput = (cb: () => void) => {
  inputListeners.add(cb);
  return () => void inputListeners.delete(cb);
};
const currentInput = (): InputMode => ((chosenInput ?? readPref(INPUT_KEY)) === 'nfc' && nfcSupported() ? 'nfc' : 'camera');
function saveInput(mode: InputMode): void {
  chosenInput = mode;
  writePref(INPUT_KEY, mode);
  for (const cb of inputListeners) cb();
}

const CAMERA_HELP: Record<CameraFailure, string> = {
  denied: 'Camera access is blocked. Allow the camera for this site in your browser settings, then reload. You can still use Manual search.',
  unavailable: 'No camera found or it is in use by another app. You can still use Manual search.',
  other: "The camera couldn't start. Reload the page, or use Manual search.",
};
// The chosen input is a solid fill; the other stays the quiet outline.
const PRESSED = 'aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground';

export function Scanner(props: { slug: string; eventName: string; timezone: string; appOrigin: string; badgeOrigin: string }) {
  const { slug, timezone, appOrigin } = props;
  const [checkpoints, setCheckpoints] = useState<Checkpoint[] | null>(null);
  const [checkpointId, setCheckpointId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchButton = useRef<HTMLButtonElement>(null);
  const [linking, setLinking] = useState<Row | null>(null);
  const [linkState, setLinkState] = useState<LinkState>({ kind: 'waiting' });
  const { write: writeBadge, cancel: cancelWrite, observe: observeTag } = useBadgeWrite(props.badgeOrigin);
  const linkAttempt = useRef<string | null>(null); // one tap per sheet, including while the request is in flight
  const linkRow = useRef<Row | null>(null); // the open sheet's person, for an answer that comes back after it closed
  // Every badge tapped while the sheet is open (serial → last seen), so Android repeating one of those taps
  // just after the sheet closes isn't recorded as a scan. The deduper only remembers the last code.
  const linkTaps = useRef(new Map<string, number>());
  const [undoOpen, setUndoOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const peopleButton = useRef<HTMLButtonElement>(null);
  const [result, setResult] = useState<{ view: ResultView; id: number; shownAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [networkDown, setNetworkDown] = useState(false);
  const [camera, setCamera] = useState<CameraState>('starting');
  const [cameraReadyAt, setCameraReadyAt] = useState<number | null>(null);
  const [checkpointSetAt, setCheckpointSetAt] = useState<number | null>(null);
  const [lastOwn, setLastOwn] = useState<{ at: number; scanId: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [notice, setNotice] = useState<string | null>(null);
  const mode = useSyncExternalStore(subscribeInput, currentInput, () => null); // null until hydrated

  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  // A03: only the browser really being offline disables scanning. A thrown fetch
  // (server down, captive portal, Wi-Fi without internet) sets networkDown but
  // leaves scanning on, so the next scan retries and clears the banner on
  // success — no reload needed. The `online` listener below stays as backup.
  const offline = !online;

  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<BarcodeScanner | null>(null);
  const deduper = useRef(createDeduper());
  const resultSeq = useRef(0);
  const checkpoint = checkpoints?.find((c) => c.id === checkpointId) ?? null;

  const router = useRouter();
  const toLogin = useCallback(() => {
    router.push(`/login?next=${encodeURIComponent(`/scan/${slug}`)}`);
  }, [router, slug]);

  // When scanning actually became possible (camera ready AND a checkpoint chosen); T-SCUI-01 timing.
  const activeAt = cameraReadyAt !== null && checkpointSetAt !== null ? Math.max(cameraReadyAt, checkpointSetAt) : null;

  // Checkpoints for this event; restore this device's last choice (§10.1).
  useEffect(() => {
    let stale = false;
    void fetch(`/api/events/${encodeURIComponent(slug)}/checkpoints`, { cache: 'no-store' }).then(async (res) => {
      if (stale) return;
      if (res.status === 401) return toLogin();
      const list = res.ok ? ((await res.json()) as { checkpoints: Checkpoint[] }).checkpoints : [];
      if (stale) return;
      setCheckpoints(list);
      const saved = readPref(checkpointKey(slug));
      if (saved && list.some((c) => c.id === saved)) {
        setCheckpointId(saved);
        setCheckpointSetAt(performance.now());
      } else setPickerOpen(true);
    });
    return () => {
      stale = true;
    };
  }, [slug, toLogin]);

  // Keep the session cookie fresh during a long shift (access tokens expire hourly).
  useEffect(() => {
    const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '');
    void supabase.auth.getSession();
    return () => void supabase.auth.stopAutoRefresh();
  }, []);

  useEffect(() => {
    if (!networkDown) return;
    const clear = () => setNetworkDown(false);
    window.addEventListener('online', clear);
    return () => window.removeEventListener('online', clear);
  }, [networkDown]);

  const show = useCallback((outcome: Outcome, cp: Checkpoint, method?: ScanRequest['method']) => {
    const view = viewFor(outcome, { checkpointKind: cp.kind, checkpointName: cp.name, timezone, now: new Date(), method });
    const id = ++resultSeq.current;
    setResult({ view, id, shownAt: performance.now() });
    playFeedback(view.sound);
    if (view.dismiss !== 'tap') {
      setTimeout(() => setResult((r) => (r?.id === id ? null : r)), view.dismiss.autoMs);
    }
  }, [timezone]);

  const record = useCallback(
    async (part: Pick<ScanRequest, 'method' | 'token' | 'participantId' | 'badgeUid'>) => {
      if (!checkpoint) return;
      setBusy(true);
      setNotice(null);
      // A new physical scan gets a new clientScanId; submitScan's retries reuse it (§10.2).
      const outcome = await submitScan({
        checkpointId: checkpoint.id,
        ...part,
        clientScanId: crypto.randomUUID(),
        clientScannedAt: new Date().toISOString(),
      });
      setBusy(false);
      if (outcome.kind === 'unauthorized') return toLogin();
      if (outcome.kind === 'offline') {
        setNetworkDown(true);
        return show({ kind: 'network' }, checkpoint, part.method);
      }
      // Any HTTP-backed answer proves connectivity; 'network' (timeout/5xx/parse)
      // leaves the flag so the next scan can still clear it on success (A03).
      setNetworkDown((prev) => nextNetworkDown(prev, outcome.kind));
      if (outcome.kind === 'response') {
        const { data } = outcome;
        if (data.code === 'ACCEPTED' && data.scanId && !data.voided) {
          setLastOwn({ at: Date.now(), scanId: data.scanId });
          setNow(Date.now());
        }
        return show({ kind: 'server', data }, checkpoint, part.method);
      }
      show({ kind: outcome.kind }, checkpoint, part.method);
    },
    [checkpoint, show, toLogin],
  );

  const linkBadge = useCallback(async (row: Row, uid: string, tag: NfcTag, reader: NDEFReader) => {
    const write = await writeBadge(tag, reader, uid);
    let code: string | undefined;
    try {
      if (navigator.onLine) {
        const res = await fetch(`/api/events/${encodeURIComponent(slug)}/badges`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ participantId: row.id, uid }),
          signal: AbortSignal.timeout(8000),
        });
        if (res.status === 401) return toLogin();
        if (res.ok) {
          const body: unknown = await res.json();
          if (body && typeof body === 'object' && 'code' in body && typeof body.code === 'string') code = body.code;
        }
      }
    } catch {
      // A failed link stays in the sheet, never the scan result screen (I-1).
    }
    const notice = linkNotice(code, uid, row.displayName, write);
    if (linkRow.current === row) setLinkState({ kind: 'result', notice });
    else setNotice(notice.text); // the sheet was closed while saving: still say what happened
  }, [slug, toLogin, writeBadge]);

  const scanningPaused = !!result || busy || offline || pickerOpen || searchOpen || !!linking || undoOpen || peopleOpen || !checkpoint;
  const onDecode = useRef<(text: string) => void>(() => undefined);
  useEffect(() => {
    onDecode.current = (text: string) => {
      if (scanningPaused || !checkpoint) return;
      if (!deduper.current.shouldHandle(text, Date.now())) return;
      const parsed = parseScannedText(text, appOrigin);
      // MALFORMED never makes a network request (§6.4).
      if (!parsed.ok) return show({ kind: 'malformed' }, checkpoint);
      void record({ method: 'qr', token: parsed.token });
    };
  }, [scanningPaused, checkpoint, appOrigin, record, show]);

  // NFC taps follow the QR rules: dedupe, pause while anything is on screen, MALFORMED without a request.
  const onTag = useRef<(tag: NfcTag, reader: NDEFReader) => void>(() => undefined);
  const onUnreadable = useRef<() => void>(() => undefined);
  useEffect(() => {
    onTag.current = (tag, reader) => {
      const { serial } = tag;
      observeTag(serial);
      if (linking) {
        linkTaps.current.set(serial, Date.now());
        if (linkAttempt.current !== null) return;
        const uid = normalizeUid(serial);
        if (!uid) return setLinkState({ kind: 'waiting', unreadable: true });
        linkAttempt.current = serial;
        setLinkState({ kind: 'saving' });
        void linkBadge(linking, uid, tag, reader);
        return;
      }
      if (scanningPaused || !checkpoint) return;
      const linkedAt = linkTaps.current.get(serial);
      if (linkedAt !== undefined && Date.now() - linkedAt < DEDUPE_WINDOW_MS) {
        linkTaps.current.set(serial, Date.now()); // still the same tap: like the deduper, a repeat extends the window
        return;
      }
      if (!deduper.current.shouldHandle(`nfc:${serial}`, Date.now())) return;
      try {
        vibrateRead();
        const uid = normalizeUid(serial);
        if (!uid) return show({ kind: 'malformed' }, checkpoint);
        void record({ method: 'nfc', badgeUid: uid });
      } catch (err) {
        // Never fail silently on a badge tap (the volunteer would think nothing was read).
        console.error(JSON.stringify({ level: 'error', where: 'scanner.onTag', error: String(err).slice(0, 200) }));
        setNotice('✕ Couldn’t handle that badge. Reload the page and try again.');
      }
    };
    // A tag sensed but not read: amber feedback, unless reads are being ignored anyway (same guard as onTag).
    onUnreadable.current = () => {
      if (linking) {
        if (linkAttempt.current === null) setLinkState({ kind: 'waiting', unreadable: true });
        return;
      }
      if (scanningPaused || !checkpoint) return;
      playFeedback('double');
      setNotice('✕ Couldn’t read that badge. Hold it still and try again.');
    };
  }, [scanningPaused, checkpoint, record, show, linking, linkBadge, observeTag]);

  // NFC mode or a temporary badge link; kept running while a result is shown so Android doesn't open
  // the tag's URL. Both flows use this single reader.
  const nfc = useNfcReader({
    prefKey: NFC_KEY,
    autoStart: mode === 'nfc',
    onTag: (tag, reader) => onTag.current(tag, reader),
    onUnreadable: () => onUnreadable.current(),
  });
  const needsTap = useNeedsTap();

  // Camera: released while linking (A10); decoding pauses while anything else is on screen (§10.2).
  useEffect(() => {
    if (mode !== 'camera' || linking) return;
    const video = videoRef.current;
    if (!video) return;
    const scanner = createBarcodeScanner({ deviceId: readPref(CAMERA_KEY) });
    scannerRef.current = scanner;
    let cancelled = false;
    scanner
      .start(video, (text) => onDecode.current(text))
      .then(async () => {
        if (cancelled) return;
        setCamera('ready');
        setCameraReadyAt(performance.now());
        const [track] = (video.srcObject instanceof MediaStream ? video.srcObject.getVideoTracks() : []) ?? [];
        const deviceId = track?.getSettings().deviceId;
        if (deviceId) writePref(CAMERA_KEY, deviceId);
      })
      .catch((err: unknown) => {
        if (!cancelled) setCamera(err instanceof CameraError ? err.reason : 'other');
      });
    return () => {
      cancelled = true;
      void scanner.stop(); // releases the camera (its tracks), not just the decoder
      if (scannerRef.current === scanner) scannerRef.current = null;
    };
  }, [mode, linking]);

  function startLink(row: Row) {
    setSearchOpen(false);
    setNotice(null);
    setLinking(row);
    linkRow.current = row;
    setLinkState({ kind: 'waiting' });
    linkAttempt.current = null;
    if (nfc.state !== 'on') void nfc.start(); // keep Chrome's user gesture; the saved input mode stays as it was
  }

  // Always allowed, even while saving: Chrome closes the dialog itself on a second Back/Escape anyway.
  function closeLink() {
    if (!linkRow.current) return; // already closed (Cancel, then the dialog's own close event)
    cancelWrite();
    linkRow.current = null;
    if (mode === 'camera') {
      nfc.stop();
      setCamera('starting');
      setCameraReadyAt(null);
    }
    setLinking(null);
    requestAnimationFrame(() => searchButton.current?.focus());
  }

  function chooseInput(next: InputMode) {
    if (next === mode) return;
    if (next === 'nfc') {
      void nfc.start(); // this tap is the user gesture Chrome needs to start NFC
    } else {
      nfc.stop();
      setCamera('starting');
      setCameraReadyAt(null);
    }
    saveInput(next);
  }

  // Also on a mode change: a camera started after NFC mode must not decode while a dialog is open.
  useEffect(() => {
    scannerRef.current?.setPaused(scanningPaused);
  }, [scanningPaused, mode]);

  const awake = mode === 'nfc' || linking ? nfc.state === 'on' : camera === 'ready';
  useEffect(() => (awake ? keepScreenAwake() : undefined), [awake]);

  // Tick while an undo is possible so the button hides at 120 s (§10.3).
  useEffect(() => {
    if (!lastOwn) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [lastOwn]);

  function dismiss() {
    const action = result?.view.action;
    setResult(null);
    if (action === 'pick-checkpoint') setPickerOpen(true);
    if (action === 'manual-search') setSearchOpen(true);
  }

  function chooseCheckpoint(id: string) {
    writePref(checkpointKey(slug), id);
    setCheckpointId(id);
    setCheckpointSetAt(performance.now());
    setPickerOpen(false);
    setLastOwn(null);
    // A deliberate switch makes the same code a new scan here (e.g. the badge just scanned at the door).
    deduper.current = createDeduper();
  }

  async function undo(reason: string) {
    if (!lastOwn) return;
    setUndoOpen(false);
    // A11: 8 s timeout via requestVoid; a stalled void surfaces instead of hanging.
    const outcome = await requestVoid(lastOwn.scanId, reason);
    if (outcome.kind === 'unauthorized') return toLogin();
    if (outcome.kind === 'no-connection') return setNotice('✕ Undo failed: no connection.');
    if (outcome.kind === 'voided' || outcome.kind === 'already-voided') {
      setLastOwn(null);
      setNotice('✓ Last scan undone.');
    } else if (outcome.kind === 'forbidden') {
      setLastOwn(null);
      setNotice('✕ Too late to undo. Ask an organizer.');
    } else {
      setNotice('✕ Undo failed. Try again.');
    }
  }

  const showUndo = undoVisible(lastOwn, now) && !offline;

  return (
    <main
      className="tw-scanner-root min-h-[100dvh] flex flex-col bg-bg font-mono text-fg"
      onPointerDown={unlockAudio}
      data-camera={mode === 'nfc' || linking ? 'off' : camera}
      data-scanning={scanningPaused ? 'paused' : 'on'}
      data-active-at={activeAt ?? undefined}
    >
      <header className="sticky top-0 z-[5] flex items-center gap-3 p-4 sm:px-6 text-white font-bold

          border-0 border-b border-solid border-white/15

          [&[data-kind='door']]:[background:rgb(23,_71,_166)] [&[data-kind='meal']]:[background:rgb(154,_52,_18)]

          [&[data-kind='session']]:[background:rgb(107,_33,_168)]

          [&[data-kind='custom']]:[background:rgb(8,_103,_94)] [&[data-kind='none']]:[background:rgb(37,_43,_59)]" data-kind={checkpoint?.kind ?? 'none'} data-testid="checkpoint-banner">
        <BrandMark name="" className="shrink-0 gap-0" />
        <div className="flex-1 min-w-0">
          <SectionLabel className="mb-1 [&>span:first-child]:text-white [&>span:last-child]:bg-white/25">
            {checkpoint ? `${KIND_LABEL[checkpoint.kind]}${checkpoint.isOpen ? '' : ' · closed'}` : props.eventName}
          </SectionLabel>
          <span className="block text-lg sm:text-xl leading-[1.3] overflow-hidden text-ellipsis whitespace-nowrap">{checkpoint?.name ?? 'No checkpoint selected'}</span>
        </div>
        <Button type="button" variant="ghost" className="border-white/50 bg-white/12 text-white hover:bg-white/15 hover:text-white" onClick={() => setPickerOpen(true)} disabled={!checkpoints}>
          Change
        </Button>
      </header>

      {(offline || networkDown) && (
        <Alert className="[background:rgb(127,_29,_29)] text-white p-[12px_16px] font-bold text-center

          [border-bottom:1px_solid_rgba(255,_255,_255,_0.12)]" asChild><div  role="alert">
          {offline ? '⚠ OFFLINE: use paper list' : '⚠ CONNECTION ISSUE: use paper list'}
        </div></Alert>
      )}

      <div className="relative h-[60dvh] min-h-[320px] shrink-0 bg-bg-deep overflow-hidden border-0 border-b border-solid border-line">
        <video ref={videoRef} className="block w-full h-full object-cover" style={mode === 'nfc' || linking ? { display: 'none' } : undefined} playsInline muted aria-label="Camera view" />
        {mode === 'nfc' ? (
          <div className="absolute [inset:0px] grid [place-items:center] p-[32px] text-center

          bg-card text-fg">
            <p>📶 NFC badges: the camera is off. Hold a badge flat against the back of the phone.</p>
            {nfc.state === 'off' && (
              <Button type="button" onClick={() => void nfc.start()}>
                Start badge reader
              </Button>
            )}
          </div>
        ) : (
          camera !== 'starting' &&
          camera !== 'ready' && (
            <Alert className="absolute [inset:0px] grid [place-items:center] p-[32px] text-center

          bg-card text-fg" asChild><div  role="alert">
              <p>📷 {CAMERA_HELP[camera]}</p>
            </div></Alert>
          )
        )}
        <div className="absolute left-4 right-4 bottom-4 rounded-card border border-solid border-line bg-card p-4 text-sm text-fg" aria-live="polite">
          {busy
            ? 'Checking…'
            : mode === 'nfc'
              ? nfc.state === 'on'
                ? checkpoint
                  ? 'Ready: tap a badge on the back of the phone'
                  : ''
                : nfc.state === 'starting'
                  ? 'Starting badge reader…'
                  : 'Badge reader is off'
              : camera === 'starting'
                ? 'Starting camera…'
                : camera === 'ready' && checkpoint
                  ? 'Ready to scan'
                  : ''}
        </div>
      </div>

      <div className="flex gap-3 p-4 sm:p-6 flex-wrap bg-bg [&_button]:flex-1 [&_button]:min-h-[52px]">
        <Button ref={searchButton} type="button" onClick={() => setSearchOpen(true)} disabled={offline || !checkpoint}>
          Manual search
        </Button>
        <Button ref={peopleButton} type="button" variant="outline" onClick={() => setPeopleOpen(true)} disabled={offline || !checkpoint}>
          Scanned here
        </Button>
        {showUndo && (
          <Button type="button" variant="outline" onClick={() => setUndoOpen(true)}>
            Undo last
          </Button>
        )}
        {nfc.supported && mode && (
          <div className="flex gap-2 rounded-card border border-solid border-line bg-card p-2 [flex:1_1_100%]" role="group" aria-label="Scan with">
            <Button type="button" variant={mode === 'camera' ? 'default' : 'outline'} className={PRESSED} aria-pressed={mode === 'camera'} onClick={() => chooseInput('camera')}>
              Camera
            </Button>
            <Button type="button" variant={mode === 'nfc' ? 'default' : 'outline'} className={PRESSED} aria-pressed={mode === 'nfc'} onClick={() => chooseInput('nfc')}>
              NFC badges
            </Button>
          </div>
        )}
      </div>
      {nfc.supported && needsTap && <p className="p-[0px_24px_16px] text-muted-foreground text-[14px]">Tap the screen once so the phone can vibrate on each scan.</p>}
      {mode === 'nfc' && !linking && nfc.error && (
        <Alert className="p-[0px_24px_16px] text-muted-foreground text-[14px]" asChild><p  role="alert">
          ✕ {nfc.error}
        </p></Alert>
      )}
      {notice && (
        <Alert className="p-[0px_24px_16px] text-muted-foreground text-[14px]" asChild role="status"><p  role="status">
          {notice}
        </p></Alert>
      )}

      {pickerOpen && checkpoints && (
        <CheckpointPicker checkpoints={checkpoints} currentId={checkpointId} onChoose={chooseCheckpoint} onCancel={() => setPickerOpen(false)} />
      )}
      {searchOpen && checkpoint && (
        <ManualSearch
          slug={slug}
          checkpointId={checkpoint.id}
          disabled={offline || busy}
          onUnauthorized={toLogin}
          onLinkBadge={startLink}
          onClose={() => setSearchOpen(false)}
          onRecord={(participantId) => {
            setSearchOpen(false);
            void record({ method: 'manual', participantId });
          }}
        />
      )}
      {linking && (
        <LinkSheet
          name={linking.displayName}
          state={linkState}
          readerState={nfc.state}
          readerError={nfc.error}
          onStart={() => void nfc.start()}
          onClose={closeLink}
        />
      )}
      {peopleOpen && checkpoint && (
        <ScannedHere
          slug={slug}
          checkpoint={checkpoint}
          timezone={timezone}
          disabled={offline}
          onUnauthorized={toLogin}
          onClose={() => {
            setPeopleOpen(false);
            requestAnimationFrame(() => peopleButton.current?.focus());
          }}
          onRemoved={(scanId) => setLastOwn((l) => (l?.scanId === scanId ? null : l))}
        />
      )}
      {undoOpen && <UndoDialog onSubmit={(r) => void undo(r)} onCancel={() => setUndoOpen(false)} />}
      {result && <ResultScreen view={result.view} shownAt={result.shownAt} onDismiss={dismiss} />}
    </main>
  );
}
