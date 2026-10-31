import { describe, expect, it } from 'vitest';
import {
  CLIENT_SCANNED_AT_FUTURE_MS,
  CLIENT_SCANNED_AT_PAST_MS,
  clampClientScannedAt,
  scanRequestSchema,
} from '@/lib/scan/schema';

const NOW = Date.parse('2026-10-31T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const base = {
  checkpointId: '0b8b4e0e-9a1c-4c5e-8a55-4b8f3e0d6c11',
  method: 'qr' as const,
  token: 'Ab3_-xYz0123456789abcdefGHIJKLMN',
  clientScanId: '3f2b7a9e-1c4d-4e8f-9a0b-2c3d4e5f6a7b',
};

describe('clampClientScannedAt (I-7: server time authoritative)', () => {
  it('L5: an in-window timestamp passes through unchanged', () => {
    const v = iso(NOW - 60_000);
    expect(clampClientScannedAt(v, NOW)).toBe(v);
    expect(clampClientScannedAt(iso(NOW), NOW)).toBe(iso(NOW));
  });

  it('L5: a backdated timestamp clamps to the lower bound', () => {
    expect(clampClientScannedAt(iso(NOW - 60 * 60_000), NOW)).toBe(iso(NOW - CLIENT_SCANNED_AT_PAST_MS));
  });

  it('L5: a future timestamp clamps to the upper bound', () => {
    expect(clampClientScannedAt(iso(NOW + 60 * 60_000), NOW)).toBe(iso(NOW + CLIENT_SCANNED_AT_FUTURE_MS));
  });

  it('L5: invalid input is rejected by zod and left untouched by the clamp', () => {
    expect(scanRequestSchema.safeParse({ ...base, clientScannedAt: 'yesterday' }).success).toBe(false);
    expect(clampClientScannedAt('yesterday', NOW)).toBe('yesterday');
  });
});
