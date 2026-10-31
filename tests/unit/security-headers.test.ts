import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, securityHeaders } from '@/lib/domain/security-headers';

const SUPABASE = 'https://abc.supabase.co';
const get = (headers: Array<{ key: string; value: string }>, key: string) => headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;
const directive = (csp: string | undefined, name: string) =>
  csp
    ?.split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `) || d === name);

describe('security headers (SPEC §14.12)', () => {
  const prod = securityHeaders({ production: true, supabaseUrl: SUPABASE });
  const dev = securityHeaders({ production: false, supabaseUrl: 'http://127.0.0.1:54321' });

  it("T-SEC-06: CSP forbids framing, plugins and foreign scripts", () => {
    const csp = get(prod, 'Content-Security-Policy');
    expect(directive(csp, 'frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive(csp, 'object-src')).toBe("object-src 'none'");
    expect(directive(csp, 'base-uri')).toBe("base-uri 'self'");
    expect(directive(csp, 'default-src')).toBe("default-src 'self'");
  });

  it('T-SEC-06: static fallback CSP (no nonce, e.g. /api/*) keeps unsafe-inline script-src', () => {
    const csp = get(prod, 'Content-Security-Policy');
    expect(directive(csp, 'script-src')).toBe("script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'");
  });

  it("L10: nonce CSP carries the nonce plus strict-dynamic and drops unsafe-inline", () => {
    const csp = contentSecurityPolicy({ production: true, supabaseUrl: SUPABASE, nonce: 'test-nonce' });
    expect(directive(csp, 'script-src')).toBe("script-src 'self' 'nonce-test-nonce' 'strict-dynamic' 'wasm-unsafe-eval'");
    expect(directive(csp, 'script-src')).not.toContain("'unsafe-inline'");
    // Tailwind runtime style attributes stay allowed; every other lockdown matches the fallback.
    expect(directive(csp, 'style-src')).toBe("style-src 'self' 'unsafe-inline'");
    expect(directive(csp, 'frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive(csp, 'object-src')).toBe("object-src 'none'");
    expect(securityHeaders({ production: true, supabaseUrl: SUPABASE, nonce: 'test-nonce' })[0]).toEqual({
      key: 'Content-Security-Policy',
      value: csp,
    });
  });

  it('T-SEC-06: Supabase is reachable for auth (connect) and storage images (img), nothing else', () => {
    const csp = get(prod, 'Content-Security-Policy');
    expect(directive(csp, 'connect-src')).toBe(`connect-src 'self' ${SUPABASE}`);
    expect(directive(csp, 'img-src')).toBe(`img-src 'self' blob: data: ${SUPABASE}`);
  });

  it('T-SEC-06: camera only for our own origin; no microphone or geolocation', () => {
    expect(get(prod, 'Permissions-Policy')).toBe('camera=(self), microphone=(), geolocation=()');
  });

  it('L11: HSTS has preload; COOP/CORP are same-origin and COEP stays off', () => {
    expect(get(prod, 'Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains; preload');
    expect(get(dev, 'Strict-Transport-Security')).toBeUndefined();
    expect(get(prod, 'Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(get(prod, 'Cross-Origin-Resource-Policy')).toBe('same-origin');
    // require-corp would break Supabase-hosted images, which send no CORP headers.
    expect(get(prod, 'Cross-Origin-Embedder-Policy')).toBeUndefined();
  });

  it('T-SEC-06: dev allows eval + websocket for the dev server; prod does not', () => {
    const devCsp = get(dev, 'Content-Security-Policy');
    expect(directive(devCsp, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(devCsp, 'connect-src')).toContain('ws:');
    expect(get(prod, 'Content-Security-Policy')).not.toContain("'unsafe-eval'");
    expect(get(prod, 'Content-Security-Policy')).not.toContain('ws:');
  });

  it('T-SEC-06: nosniff, DENY framing and no referrer to other sites', () => {
    expect(get(prod, 'X-Content-Type-Options')).toBe('nosniff');
    expect(get(prod, 'X-Frame-Options')).toBe('DENY');
    // same-origin, not no-referrer: forms posted before hydration need a real Origin (T-AUTH-01).
    expect(get(prod, 'Referrer-Policy')).toBe('same-origin');
  });
});
