import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';

const auth = vi.hoisted(() => ({ refresh: false }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, options: {
    cookies: { setAll: (cookies: Array<{ name: string; value: string; options: object }>, headers: object) => void };
  }) => ({
    auth: { getUser: async () => {
      if (auth.refresh) options.cookies.setAll([{ name: 'sb-test', value: 'refreshed', options: {} }], {});
      return { data: { user: { id: 'attendee' } } };
    } },
  }),
}));

afterEach(() => { auth.refresh = false; });

describe('proxy nonce propagation', () => {
  it.each([false, true])('T-SEC-06: Next receives the enforced CSP, including after cookie refresh (%s)', async (refresh) => {
    auth.refresh = refresh;
    const response = await proxy(new NextRequest('http://localhost/me'));
    const csp = response.headers.get('content-security-policy');
    const nonce = response.headers.get('x-middleware-request-x-nonce');
    expect(nonce).toBeTruthy();
    expect(csp).toContain(`'nonce-${nonce}'`);
    expect(response.headers.get('x-middleware-request-content-security-policy')).toBe(csp);
  });
});
