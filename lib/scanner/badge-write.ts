import { useCallback, useEffect, useRef } from 'react';
import { badgeUrl, badgeWritable, normalizeUid, type BadgeWriteOutcome } from '@/lib/domain/badge';
import type { NfcTag } from './nfc';

// Tags written before the move to station.sheridandatathon.com still open the right profile (308 redirect, v0.11.15),
// so they count as written: every write at the door is a chance for a badge to be pulled away mid-write (v0.12.4).
const LEGACY_ORIGIN = 'https://nfc.yvesdonato.com';
// With the badge on the phone a write takes well under a second; longer means Chrome lost the tag and is holding the
// write for whichever tag comes next, so give up soon (v0.12.4: 3 s, was 5 s).
const WRITE_TIMEOUT_MS = 3000;

function describe(err: unknown, startedAt: number): string {
  const name = err instanceof DOMException ? err.name : 'Error';
  return `${name} after ${Math.round(performance.now() - startedAt)} ms`;
}

// Chrome queues writes until a tag is in range: never let one spill onto the next badge.
export function useBadgeWrite(origin: string) {
  const pending = useRef<{ uid: string; abort: AbortController } | null>(null);
  /** Why the last write failed, e.g. "NetworkError after 212 ms" (no UID, no name: it may be logged). */
  const lastError = useRef<string | null>(null);
  const cancel = useCallback(() => pending.current?.abort.abort(), []);
  useEffect(() => cancel, [cancel]);

  const observe = useCallback((serial: string) => {
    if (pending.current && normalizeUid(serial) !== pending.current.uid) {
      pending.current.abort.abort(new DOMException('Another badge was tapped', 'AbortError'));
    }
  }, []);

  const write = useCallback(async (tag: NfcTag, reader: NDEFReader, uid: string): Promise<BadgeWriteOutcome> => {
    lastError.current = null;
    if (!badgeWritable(origin)) return 'unchanged';
    const url = badgeUrl(origin, uid);
    const record = tag.records[0];
    const current = tag.records.length === 1 && record?.recordType === 'url' && record.data ? new TextDecoder().decode(record.data) : null;
    if (current === url || current === badgeUrl(LEGACY_ORIGIN, uid)) return 'unchanged';
    const abort = new AbortController();
    const attempt = { uid, abort };
    pending.current = attempt;
    const startedAt = performance.now();
    const timer = setTimeout(() => abort.abort(new DOMException('No badge to write to', 'TimeoutError')), WRITE_TIMEOUT_MS);
    try {
      await Promise.race([
        reader.write({ records: [{ recordType: 'url', data: url }] }, { signal: abort.signal }),
        new Promise<never>((_, reject) => abort.signal.addEventListener('abort', () => reject(abort.signal.reason), { once: true })),
      ]);
      if (!abort.signal.aborted) return 'written';
      lastError.current = describe(abort.signal.reason, startedAt);
      return 'failed';
    } catch (err) {
      lastError.current = describe(err, startedAt);
      console.error(JSON.stringify({ level: 'error', where: 'badge.write', error: lastError.current }));
      return 'failed';
    } finally {
      clearTimeout(timer);
      if (pending.current === attempt) pending.current = null;
    }
  }, [origin]);

  return { write, cancel, observe, lastError };
}
