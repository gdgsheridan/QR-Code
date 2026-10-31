// SPEC §10.3 / F11: "Undo last" shows for 120 s after the volunteer's own accepted scan.
// The server enforces the same window in void_scan(); this only decides visibility.
export const UNDO_WINDOW_MS = 120_000;

export function undoVisible(lastOwnAccepted: { at: number } | null, nowMs: number): boolean {
  return lastOwnAccepted !== null && nowMs - lastOwnAccepted.at <= UNDO_WINDOW_MS;
}

// A11: void requests get the scanner's 8 s convention. A stalled connection must
// surface as no-connection instead of hanging the UI; the server stays idempotent.
export const VOID_TIMEOUT_MS = 8000;

export type VoidOutcome =
  | { kind: 'voided' }
  | { kind: 'already-voided' }
  | { kind: 'forbidden' }
  | { kind: 'unauthorized' }
  | { kind: 'no-connection' }
  | { kind: 'failed' };

export async function requestVoid(
  scanId: string,
  reason: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<VoidOutcome> {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? VOID_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await doFetch(`/api/scans/${scanId}/void`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason }),
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch {
    clearTimeout(timer);
    return { kind: 'no-connection' };
  }
  clearTimeout(timer);
  if (res.status === 401) return { kind: 'unauthorized' };
  const body = (await res.json().catch(() => ({}))) as { code?: string };
  switch (body.code) {
    case 'VOIDED':
      return { kind: 'voided' };
    case 'ALREADY_VOIDED':
      return { kind: 'already-voided' };
    case 'FORBIDDEN':
      return { kind: 'forbidden' };
    default:
      return { kind: 'failed' };
  }
}
