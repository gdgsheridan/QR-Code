'use client';

import { BrandMark } from '@/components/brand-mark';
import { SectionLabel } from '@/components/section-label';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';

import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { formatUid, linkNotice, normalizeUid } from '@/lib/domain/badge';
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

type LinkTarget = Pick<Row, 'id' | 'displayName'>;
/** mustLink (v0.12.1): a door ADMIT on a phone with Web NFC stays until their badge is linked (§10.2); linked: it was. */
type Shown = { view: ResultView; id: number; shownAt: number; mustLink?: LinkTarget; linked?: boolean };

// v0.12.2: how long a check-in's "✓ Badge linked" stays before scanning resumes (a tap skips it).
const LINKED_MS = 1500;
// v0.12.4: a badge pulled away mid-write leaves it linked but without its profile link: the waiting ADMIT asks for the
// same badge again, up to this many writes, before finishing anyway (a bad chip mustn't block the door).
const WRITE_TRIES = 3;
// v0.12.4 (A10): the camera's hardware closes a moment after its tracks stop; starting the reader in that moment can
// leave it deaf until Chrome is left and reopened.
const CAMERA_RELEASE_MS = 800;

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
  const [searchLinkOnly, setSearchLinkOnly] = useState(false); // v0.11.40: the bottom bar's Link badge
  const searchButton = useRef<HTMLButtonElement>(null);
  const [linking, setLinking] = useState<LinkTarget | null>(null);
  const [linkState, setLinkState] = useState<LinkState>({ kind: 'waiting' });
  const { write: writeBadge, cancel: cancelWrite, observe: observeTag, lastError: writeError } = useBadgeWrite(props.badgeOrigin);
  const linkAttempt = useRef<string | null>(null); // one tap per sheet, including while the request is in flight
  const linkRow = useRef<LinkTarget | null>(null); // the open sheet's person, for an answer that comes back after it closed
  // Every badge tapped while the sheet is open (serial → last seen), so Android repeating one of those taps
  // just after the sheet closes isn't recorded as a scan. The deduper only remembers the last code.
  const linkTaps = useRef(new Map<string, number>());
  const [undoOpen, setUndoOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const peopleButton = useRef<HTMLButtonElement>(null);
  const [result, setResult] = useState<Shown | null>(null);
  // v0.12.2: the person a waiting door ADMIT is reading a badge for (no sheet), until their check-in finishes.
  const admitRow = useRef<LinkTarget | null>(null);
  const writeTries = useRef(0); // writes tried for the waiting ADMIT (v0.12.4)
  const cameraOffAt = useRef(-Infinity); // performance.now() when the camera was last released
  const readerGen = useRef(0); // bumped by every start and stop, so a start delayed for the camera can be called off
  const [cameraWait, setCameraWait] = useState(false); // a reader start waiting for the camera to close: shown as starting
  // v0.12.2: set once the reader exists (below); a write leaves Chrome deaf to new taps until the reader restarts.
  const restartReader = useRef<() => void>(() => undefined);
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

  const fetchCheckpoints = useCallback(async (): Promise<Checkpoint[] | null> => {
    const res = await fetch(`/api/events/${encodeURIComponent(slug)}/checkpoints`, { cache: 'no-store' });
    if (res.status === 401) {
      toLogin();
      return null;
    }
    return res.ok ? ((await res.json()) as { checkpoints: Checkpoint[] }).checkpoints : [];
  }, [slug, toLogin]);

  // Checkpoints for this event; restore this device's last choice while it is open (§10.1, v0.11.41).
  useEffect(() => {
    let stale = false;
    void fetchCheckpoints().then((list) => {
      if (stale || !list) return;
      setCheckpoints(list);
      const saved = readPref(checkpointKey(slug));
      // v0.12.1: Check-in links each badge, so only a phone with Web NFC restores it.
      if (saved && list.some((c) => c.id === saved && c.isOpen && (c.kind !== 'door' || nfcSupported()))) {
        setCheckpointId(saved);
        setCheckpointSetAt(performance.now());
      } else setPickerOpen(true);
    });
    return () => {
      stale = true;
    };
  }, [slug, fetchCheckpoints]);

  // v0.11.41: the picker lists open checkpoints only, so reload them each time it opens (an organizer may have
  // just opened Dinner). Offline or failing, it keeps the list it has.
  function openPicker() {
    setPickerOpen(true);
    fetchCheckpoints().then((list) => list && setCheckpoints(list), () => undefined);
  }

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
    // v0.12.1 (owner's decision): check-in ends only once their badge is linked, so this ADMIT has no timer.
    const mustLink = view.linkable && nfcSupported() ? { id: view.linkable.id, displayName: view.linkable.name } : undefined;
    setResult({ view: mustLink ? { ...view, dismiss: 'tap' } : view, id, shownAt: performance.now(), mustLink });
    if (mustLink) {
      // v0.12.2 (owner's request): no Link badge button: the ADMIT reads their badge straight away (§10.2).
      setLinking(mustLink);
      linkRow.current = mustLink;
      admitRow.current = mustLink;
      linkAttempt.current = null;
      writeTries.current = 0;
      setLinkState({ kind: 'waiting' });
    }
    playFeedback(view.sound);
    if (view.dismiss !== 'tap' && !mustLink) {
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

  const linkBadge = useCallback(async (row: LinkTarget, uid: string, tag: NfcTag, reader: NDEFReader) => {
    const write = await writeBadge(tag, reader, uid);
    if (write !== 'unchanged') restartReader.current(); // the tag was written to (or nearly): see useNfcReader.restart
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
    let notice = linkNotice(code, uid, row.displayName, write);
    const atAdmit = admitRow.current === row;
    // v0.12.4: linked, but the badge left before its profile link was written: ask for the same badge again.
    const rewrite = atAdmit && code === 'LINKED' && write === 'failed' && ++writeTries.current < WRITE_TRIES;
    if (atAdmit && code === 'LINKED' && write === 'failed') {
      notice = rewrite
        ? { tone: 'bad', text: `✕ Its profile link didn't write (${writeError.current}). Hold the same badge flat on the phone until it says linked.` }
        : { tone: 'bad', text: `✓ Badge ${formatUid(uid)} linked to ${row.displayName}, but its profile link didn't write (${writeError.current}). Rewrite it later: Link badge, then Replace badge.` };
    }
    if (code === 'LINKED' && !rewrite) {
      // Check-in finished: the ADMIT says so briefly, then clears like any green (the effect below); a missing profile
      // link waits for a tap, so the volunteer sees it.
      const dismissAfter = write === 'failed' ? 'tap' : { autoMs: LINKED_MS };
      setResult((r) => (r?.mustLink?.id === row.id ? { ...r, linked: true, view: { ...r.view, detail: notice.text, dismiss: dismissAfter } } : r));
    } else if (atAdmit) {
      // A waiting check-in takes the next badge tap, the refused one included (forgotten by the repeat guard below).
      if (linkAttempt.current) linkTaps.current.delete(linkAttempt.current);
      linkAttempt.current = null;
    }
    if (linkRow.current === row) setLinkState({ kind: 'result', notice, linked: code === 'LINKED' && !rewrite });
    else setNotice(notice.text); // the sheet was closed while saving: still say what happened
  }, [slug, toLogin, writeBadge, writeError]);

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
        const seen = linkTaps.current.get(serial);
        linkTaps.current.set(serial, Date.now());
        if (linkAttempt.current !== null) return;
        // A waiting check-in: a badge seen in the last 3 s (the previous person's, still near the phone) isn't theirs.
        if (admitRow.current === linking && seen !== undefined && Date.now() - seen < DEDUPE_WINDOW_MS) return;
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
  const restartNfc = nfc.restart;
  useEffect(() => {
    restartReader.current = () => void restartNfc();
  }, [restartNfc]);

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
      cameraOffAt.current = performance.now();
      if (scannerRef.current === scanner) scannerRef.current = null;
    };
  }, [mode, linking]);

  // A10: on a real phone NFC reads only arrive with the camera off, so the camera is released before the reader
  // starts (synchronously, so a tap's user gesture still starts it), not later when the camera effect cleans up.
  const startNfc = nfc.start;
  const startReader = useCallback(async () => {
    if (scannerRef.current) {
      void scannerRef.current.stop();
      cameraOffAt.current = performance.now();
    }
    const gen = ++readerGen.current;
    // v0.12.4: give the camera time to close (Chrome keeps a tap's permission to start NFC for 5 s).
    const wait = cameraOffAt.current + CAMERA_RELEASE_MS - performance.now();
    if (wait > 0) {
      setCameraWait(true);
      await new Promise((resolve) => setTimeout(resolve, wait));
      if (gen !== readerGen.current) return;
      setCameraWait(false);
    }
    await startNfc();
  }, [startNfc]);

  function startLink(row: LinkTarget) {
    setSearchOpen(false);
    setNotice(null);
    setLinking(row);
    linkRow.current = row;
    setLinkState({ kind: 'waiting' });
    linkAttempt.current = null;
    if (nfc.state !== 'on') void startReader(); // keep Chrome's user gesture; the saved input mode stays as it was
  }

  function openSearch(linkOnly: boolean) {
    setSearchLinkOnly(linkOnly);
    setSearchOpen(true);
  }

  // Always allowed, even while saving: Chrome closes the dialog itself on a second Back/Escape anyway.
  const stopNfc = nfc.stop;
  const stopReader = useCallback(() => {
    readerGen.current++; // calls off a start still waiting for the camera
    setCameraWait(false);
    stopNfc();
  }, [stopNfc]);
  const closeLink = useCallback(() => {
    if (!linkRow.current) return; // already closed (Cancel, then the dialog's own close event)
    cancelWrite();
    linkRow.current = null;
    admitRow.current = null;
    if (mode === 'camera') {
      stopReader();
      setCamera('starting');
      setCameraReadyAt(null);
    }
    setLinking(null);
    requestAnimationFrame(() => searchButton.current?.focus());
  }, [cancelWrite, mode, stopReader]);

  // v0.12.2: Chrome starts the reader without a tap only once this site may use NFC, so the permission is read when
  // the page opens (and followed), letting a waiting check-in start reading the moment it appears.
  const [nfcAllowed, setNfcAllowed] = useState(false);
  const nfcSupportedHere = nfc.supported;
  useEffect(() => {
    if (!nfcSupportedHere) return;
    let status: PermissionStatus | null = null;
    void navigator.permissions
      .query({ name: 'nfc' as PermissionName })
      .then((p) => {
        status = p;
        setNfcAllowed(p.state === 'granted');
        p.onchange = () => setNfcAllowed(p.state === 'granted');
      })
      .catch(() => undefined);
    return () => {
      if (status) status.onchange = null;
    };
  }, [nfcSupportedHere]);

  // v0.12.2: a waiting check-in reads their badge at once (the camera is already off, A10); the first time on a
  // phone, or after a reader error, the ADMIT offers Start badge reader instead (that tap lets Chrome ask).
  const needsReaderTap = !nfcAllowed || !!nfc.error;
  const readerState = cameraWait && nfc.state === 'off' ? 'starting' : nfc.state;
  const autoReadFor = result?.mustLink && !result.linked && nfc.state === 'off' && !needsReaderTap ? result.id : null;
  useEffect(() => {
    if (autoReadFor !== null) void startReader();
  }, [autoReadFor, startReader]);

  // v0.12.2: linked: the check-in is done; after the confirmation, scanning resumes (camera back in Camera mode).
  const linkedResult = result?.linked && result.view.dismiss !== 'tap' ? result.id : null;
  useEffect(() => {
    if (linkedResult === null) return;
    const t = setTimeout(() => {
      setResult((r) => (r?.id === linkedResult ? null : r));
      closeLink();
    }, LINKED_MS);
    return () => clearTimeout(t);
  }, [linkedResult, closeLink]);

  function chooseInput(next: InputMode) {
    if (next === mode) return;
    if (next === 'nfc') {
      void startReader(); // this tap is the user gesture Chrome needs to start NFC
    } else {
      stopReader();
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
    if (result?.linked) closeLink(); // a tap skips the "✓ Badge linked" confirmation
    setResult(null);
    if (action === 'pick-checkpoint') openPicker();
    if (action === 'manual-search') openSearch(false);
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
        <Button type="button" variant="ghost" className="border-white/50 bg-white/12 text-white hover:bg-white/15 hover:text-white" onClick={openPicker} disabled={!checkpoints}>
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
              <Button type="button" onClick={() => void startReader()}>
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
        <Button ref={searchButton} type="button" onClick={() => openSearch(false)} disabled={offline || !checkpoint}>
          Manual search
        </Button>
        <Button ref={peopleButton} type="button" variant="outline" onClick={() => setPeopleOpen(true)} disabled={offline || !checkpoint}>
          Scanned here
        </Button>
        {nfc.supported && mode && (
          <Button type="button" variant="outline" onClick={() => openSearch(true)} disabled={offline || !checkpoint}>
            Link badge
          </Button>
        )}
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
        <CheckpointPicker checkpoints={checkpoints} currentId={checkpointId} doorBlocked={!nfc.supported} onChoose={chooseCheckpoint} onCancel={() => setPickerOpen(false)} />
      )}
      {searchOpen && checkpoint && (
        <ManualSearch
          slug={slug}
          checkpointId={checkpoint.id}
          disabled={offline || busy}
          onUnauthorized={toLogin}
          onLinkBadge={startLink}
          linkOnly={searchLinkOnly}
          onClose={() => setSearchOpen(false)}
          onRecord={(participantId) => {
            setSearchOpen(false);
            void record({ method: 'manual', participantId });
          }}
        />
      )}
      {linking && linking !== result?.mustLink && (
        <LinkSheet
          name={linking.displayName}
          state={linkState}
          readerState={readerState}
          readerError={nfc.error}
          onStart={() => void startReader()}
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
      {result && (
        <ResultScreen
          view={result.view}
          shownAt={result.shownAt}
          onDismiss={dismiss}
          link={result.mustLink && !result.linked ? { state: linkState, readerState, readerError: nfc.error, needsTap: needsReaderTap, onStart: () => void startReader(), onReset: () => restartReader.current() } : undefined}
        />
      )}
    </main>
  );
}
