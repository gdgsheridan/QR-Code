// SPEC §9.1. The single definition of scan result codes (I-15).
// T-SCAN-23 asserts this set equals the codes record_scan() can return.
export const SCAN_CODES = [
  'ACCEPTED',
  'ALREADY_SCANNED',
  'NOT_FOUND',
  'REVOKED',
  'NOT_ACCEPTED',
  'WRONG_EVENT',
  'NOT_CHECKED_IN',
  'CHECKPOINT_CLOSED',
  'CAPACITY_REACHED',
  'FORBIDDEN',
  'CHECKPOINT_NOT_FOUND',
  'CLIENT_ID_CONFLICT',
  'SESSION_COOLDOWN', // §8 step 11b: another workshop within the event's cooldown
] as const;

export type ScanCode = (typeof SCAN_CODES)[number];

// SPEC §8: results of void_scan().
export const VOID_CODES = ['VOIDED', 'NOT_FOUND', 'FORBIDDEN', 'ALREADY_VOIDED'] as const;

export type VoidCode = (typeof VOID_CODES)[number];
