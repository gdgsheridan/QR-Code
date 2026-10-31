import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

// SPEC §10.5: Web NFC exists only in Chrome on Android. Every NFC control is rendered only when this
// is true (no fallback text elsewhere).
export function nfcSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.NDEFReader === 'function';
}

const subscribeNever = () => () => undefined;

export interface NfcTag {
  serial: string;
  records: readonly NDEFRecord[];
}

export type NfcState = 'off' | 'starting' | 'on';

const START_ERRORS: Record<string, string> = {
  NotAllowedError: 'NFC permission was denied. Allow it in Chrome’s site settings, then tap Start badge reader.',
  NotSupportedError: 'No usable NFC reader. Check that NFC is turned on in Android settings.',
};

/**
 * A continuous Web NFC reader with an on/off preference (ported from datathon-badges' reader).
 * The first start must come from a tap, so Chrome can ask for permission; later visits auto-start
 * when the preference is on and the `nfc` permission is already granted.
 */
export function useNfcReader(opts: {
  prefKey: string;
  defaultOn?: boolean;
  /** false: never start without a tap, whatever the saved preference (the tag writer). */
  autoStart?: boolean;
  onTag: (tag: NfcTag, reader: NDEFReader) => void;
  onUnreadable?: () => void;
}) {
  const { prefKey, defaultOn = true, autoStart = true } = opts;
  const supported = useSyncExternalStore(subscribeNever, nfcSupported, () => false);
  const [state, setState] = useState<NfcState>('off');
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  // Held while scanning. Otherwise only the reader's own listeners reach it: on a real phone Chrome
  // collected it and kept the NFC session, so taps were swallowed with nobody listening (T-NFC-10).
  const active = useRef<NDEFReader | null>(null);
  const handlers = useRef(opts);
  useEffect(() => {
    handlers.current = opts;
  });

  const remember = useCallback(
    (on: boolean) => {
      try {
        window.localStorage.setItem(prefKey, on ? 'on' : 'off');
      } catch {
        // private mode: the preference just isn't remembered
      }
    },
    [prefKey],
  );

  const start = useCallback(async () => {
    const Reader = window.NDEFReader;
    if (!Reader) return;
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    setError(null);
    setState('starting');
    const reader = new Reader();
    active.current = reader;
    reader.addEventListener('reading', (e) => {
      const ev = e as NDEFReadingEvent;
      handlers.current.onTag({ serial: ev.serialNumber, records: ev.message.records }, reader);
    });
    reader.addEventListener('readingerror', () => handlers.current.onUnreadable?.());
    try {
      await reader.scan({ signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      setState('on');
      remember(true);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setState('off');
      const name = e instanceof DOMException ? e.name : '';
      if (name !== 'AbortError') setError(START_ERRORS[name] ?? 'Couldn’t start the badge reader.');
    }
  }, [remember]);

  const stop = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    active.current = null;
    setState('off');
    remember(false);
  }, [remember]);

  useEffect(() => {
    if (!supported) return;
    let wanted = defaultOn && autoStart;
    try {
      // Pre-rename `passline:` keys still count, so a reader turned off before v0.11.21 stays off.
      const saved = window.localStorage.getItem(prefKey) ?? window.localStorage.getItem(prefKey.replace(/^station:/, 'passline:'));
      if (saved !== null) wanted = autoStart && saved === 'on';
    } catch {
      // keep the default
    }
    let stale = false;
    if (wanted) {
      void navigator.permissions
        .query({ name: 'nfc' as PermissionName })
        .then((p) => {
          // Not over a reader already started by a tap (that would abort and replace it).
          if (!stale && p.state === 'granted' && !controller.current) void start();
        })
        .catch(() => undefined);
    }
    return () => {
      stale = true; // only cancels a pending auto-start: a reader started by a tap must survive autoStart changing
    };
  }, [supported, prefKey, defaultOn, autoStart, start]);

  // Leaving the page stops the reader.
  useEffect(() => {
    const ctrl = controller;
    return () => ctrl.current?.abort();
  }, []);

  return { supported, state, error, start, stop };
}
