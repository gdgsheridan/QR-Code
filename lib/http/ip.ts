import { sha256hex } from '@/lib/domain/token';

// The platform appends the real client IP, so the client controls every forwarded hop but the
// last: key on the rightmost entry, else a forged leftmost hop picks someone else's bucket.
// Keys hold hashes only, never the raw address (I-11).
export function clientIpKey(headers: Headers, scope: string): string {
  const hops = headers.get('x-forwarded-for')?.split(',').map((h) => h.trim()).filter(Boolean) ?? [];
  const ip = (hops[hops.length - 1] ?? headers.get('x-real-ip')?.trim()) || 'unknown';
  return `${scope}:ip:${sha256hex(ip).slice(0, 32)}`;
}
