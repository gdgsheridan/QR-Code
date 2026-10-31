import { z } from 'zod';
import { BADGE_UID_RE } from '@/lib/domain/badge';
import { SCAN_CODES } from '@/lib/domain/scan-codes';

// SPEC §9.1 request body. Client-safe: the scanner builds requests with the same schema.
export const scanRequestSchema = z
  .object({
    checkpointId: z.uuid(),
    method: z.enum(['qr', 'manual', 'nfc']),
    token: z.string().regex(/^[A-Za-z0-9_-]{32}$/).optional(),
    participantId: z.uuid().optional(),
    badgeUid: z.string().regex(BADGE_UID_RE).optional(),
    clientScanId: z.uuidv4(),
    clientScannedAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine(
    (b) => {
      const given = { qr: b.token, manual: b.participantId, nfc: b.badgeUid };
      return given[b.method] !== undefined && Object.values(given).filter((v) => v !== undefined).length === 1;
    },
    { message: 'token iff qr, participantId iff manual, badgeUid iff nfc' },
  );

export type ScanRequest = z.infer<typeof scanRequestSchema>;

// I-7: server time is authoritative; clientScannedAt is diagnostic only. Clamp it server-side into
// [now - 5 min, now + 1 min] so a skewed or backdated client clock can't rewrite history. Pure, so
// unit-testable; invalid input is left for the zod schema above to reject.
export const CLIENT_SCANNED_AT_PAST_MS = 5 * 60 * 1000;
export const CLIENT_SCANNED_AT_FUTURE_MS = 60 * 1000;
export function clampClientScannedAt(value: string, nowMs = Date.now()): string {
  const t = Date.parse(value);
  if (Number.isNaN(t)) return value;
  if (t < nowMs - CLIENT_SCANNED_AT_PAST_MS) return new Date(nowMs - CLIENT_SCANNED_AT_PAST_MS).toISOString();
  if (t > nowMs + CLIENT_SCANNED_AT_FUTURE_MS) return new Date(nowMs + CLIENT_SCANNED_AT_FUTURE_MS).toISOString();
  return value;
}

// §9.1 200-response, as the scanner client validates it. Anything that doesn't parse is treated as
// NETWORK (amber), so a proxy error page can never turn into a green screen (I-1).
export const scanResponseSchema = z.object({
  code: z.enum(SCAN_CODES),
  replayed: z.boolean().optional(),
  voided: z.boolean().optional(),
  scanId: z.string().optional(),
  participant: z
    .object({
      id: z.string(),
      displayName: z.string(),
      status: z.string(),
      dietaryNotes: z.string().nullable().optional(),
      allergies: z.string().nullable().optional(), // v0.9: meal scans, ACCEPTED only
      allergySeverity: z.string().nullable().optional(),
    })
    .optional(),
  previous: z.object({ scannedAt: z.string(), scannedByName: z.string().nullable(), scannedByMe: z.boolean() }).optional(),
  reissued: z.boolean().optional(),
  revokeReason: z.string().nullable().optional(),
  otherEvent: z.string().nullable().optional(),
  capacity: z.number().optional(),
  serverTime: z.string(),
});

export type ScanResponse = z.infer<typeof scanResponseSchema>;
