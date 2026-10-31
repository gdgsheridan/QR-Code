import { randomBytes } from 'node:crypto';
import { createPassHandler, createPassProfileHandler } from '@/lib/pass/handlers';
import { serviceClient } from './mail';

// Each client gets its own fake IP so per-IP rate limits never leak between tests.
export function passClient() {
  const db = serviceClient();
  const ip = `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
  const pass = createPassHandler({ db });
  const profile = createPassProfileHandler({ db });

  const patch = (body: unknown) =>
    profile(
      new Request('http://localhost/api/pass', {
        method: 'PATCH',
        // M2: the platform appends the real client IP last, so that rightmost hop is the trusted one;
        // the first entry stands in for a client-supplied (spoofable) hop.
        headers: { 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.9, ${ip}` },
        body: JSON.stringify(body),
      }),
    );

  const lookup = (body: unknown, headers: Record<string, string> = {}) =>
    pass(
      new Request('http://localhost/api/pass', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.9, ${ip}`, ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    );

  return { db, ip, lookup, patch };
}
