import { scanResponseSchema, type ScanRequest, type ScanResponse } from '@/lib/scan/schema';

// SPEC §10.2 "Network": 8 s timeout, then up to 2 automatic retries with the SAME clientScanId
// (record_scan() replays it safely), then NETWORK. A fetch that fails at the network level means
// the device is offline: no retries, the scanner switches to the OFFLINE banner.
export type SubmitOutcome =
  | { kind: 'response'; data: ScanResponse }
  | { kind: 'network' }
  | { kind: 'offline' }
  | { kind: 'unauthorized' }
  | { kind: 'rate_limited' };

// A03: latch-free OFFLINE banner. A thrown fetch sets networkDown, but any
// HTTP-backed answer proves connectivity and clears it. A 'network' outcome
// (timeouts / 5xx / parse) leaves the flag as it was: the next scan retries and
// clears it on success, so no reload is ever needed to recover.
export function nextNetworkDown(prev: boolean, kind: SubmitOutcome['kind']): boolean {
  if (kind === 'offline') return true;
  if (kind === 'network') return prev;
  return false;
}

export async function submitScan(
  body: ScanRequest,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number; retries?: number } = {},
): Promise<SubmitOutcome> {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const attempts = 1 + (opts.retries ?? 2);
  const payload = JSON.stringify(body); // identical bytes, identical clientScanId, on every attempt

  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch('/api/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload,
        signal: controller.signal,
        cache: 'no-store',
      });
    } catch {
      clearTimeout(timer);
      if (controller.signal.aborted) continue; // timed out: retry
      return { kind: 'offline' };
    }
    clearTimeout(timer);
    if (res.status === 401) return { kind: 'unauthorized' };
    if (res.status === 429) return { kind: 'rate_limited' };
    if (res.status >= 500) continue;
    if (!res.ok) return { kind: 'network' };
    try {
      const parsed = scanResponseSchema.safeParse(await res.json());
      return parsed.success ? { kind: 'response', data: parsed.data } : { kind: 'network' };
    } catch {
      return { kind: 'network' };
    }
  }
  return { kind: 'network' };
}
