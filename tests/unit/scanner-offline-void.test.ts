import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextNetworkDown } from '@/lib/scanner/submit';
import { requestVoid, VOID_TIMEOUT_MS } from '@/lib/scanner/undo';

describe('A03 offline recovery (SPEC §10.2)', () => {
  it('A03: a thrown fetch latches networkDown, but any HTTP-backed answer clears it without a reload', () => {
    expect(nextNetworkDown(false, 'offline')).toBe(true);
    expect(nextNetworkDown(true, 'response')).toBe(false);
    expect(nextNetworkDown(true, 'unauthorized')).toBe(false);
    expect(nextNetworkDown(true, 'rate_limited')).toBe(false);
  });

  it('A03: a network outcome (timeout/5xx/parse) leaves the flag so the next scan can clear it', () => {
    expect(nextNetworkDown(true, 'network')).toBe(true);
    expect(nextNetworkDown(false, 'network')).toBe(false);
  });
});

describe('A11 void timeout (SPEC §10.3/§10.6)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // A fetch that never answers but honours abort, like a stalled connection.
  const hang: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));

  it('A11: a hung void times out at 8 s as no-connection (never hangs the UI)', async () => {
    expect(VOID_TIMEOUT_MS).toBe(8000);
    const pending = requestVoid('3f2b7a9e-1c4d-4e8f-9a0b-2c3d4e5f6a7b', 'Wrong checkpoint', { fetchImpl: vi.fn(hang) });
    await vi.advanceTimersByTimeAsync(VOID_TIMEOUT_MS + 10);
    expect(await pending).toEqual({ kind: 'no-connection' });
  });

  it('A11: maps VOIDED / ALREADY_VOIDED / FORBIDDEN / 401 like the old inline code', async () => {
    const code = (c: string) => vi.fn<typeof fetch>(async () => Response.json({ code: c }));
    expect(await requestVoid('id', 'r', { fetchImpl: code('VOIDED') })).toEqual({ kind: 'voided' });
    expect(await requestVoid('id', 'r', { fetchImpl: code('ALREADY_VOIDED') })).toEqual({ kind: 'already-voided' });
    expect(await requestVoid('id', 'r', { fetchImpl: code('FORBIDDEN') })).toEqual({ kind: 'forbidden' });
    expect(await requestVoid('id', 'r', { fetchImpl: vi.fn<typeof fetch>(async () => new Response('{}', { status: 401 })) })).toEqual({
      kind: 'unauthorized',
    });
  });

  it('A11: a thrown fetch is no-connection; an unknown code is failed', async () => {
    const down = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await requestVoid('id', 'r', { fetchImpl: down })).toEqual({ kind: 'no-connection' });
    const weird = vi.fn<typeof fetch>(async () => Response.json({ code: 'NOPE' }));
    expect(await requestVoid('id', 'r', { fetchImpl: weird })).toEqual({ kind: 'failed' });
  });
});
