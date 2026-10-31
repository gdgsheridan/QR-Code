import { createHmac, timingSafeEqual } from 'node:crypto';

// SPEC §9.2: X-Station-Signature (X-Passline-Signature from older scripts) = hex(HMAC_SHA256(secret, timestamp + "." + rawBody)).
export const MAX_SKEW_SECONDS = 300;

export function signSheetBody(rawBody: string, timestamp: string, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');
}

export function verifySheetSignature(input: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  secret: string;
  nowSeconds: number;
}): boolean {
  const { timestamp, signature } = input;
  if (!timestamp || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(input.nowSeconds - Number(timestamp)) > MAX_SKEW_SECONDS) return false;
  if (!signature || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = Buffer.from(signSheetBody(input.rawBody, timestamp, input.secret), 'hex');
  const provided = Buffer.from(signature, 'hex');
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
