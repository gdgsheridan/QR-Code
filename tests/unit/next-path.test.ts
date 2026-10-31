import { describe, expect, it } from 'vitest';
import { safeNextPath } from '@/lib/auth/next-path';

describe('post-login redirect target', () => {
  it('T-SCUI-10: keeps same-site paths (back to the same slug) and rejects open redirects', () => {
    expect(safeNextPath('/scan/demo')).toBe('/scan/demo');
    expect(safeNextPath('/scan/demo?x=1')).toBe('/scan/demo?x=1');
    for (const bad of ['https://evil.test', '//evil.test', '/\\evil.test', 'scan/demo', '', null, undefined]) {
      expect(safeNextPath(bad)).toBe('/');
    }
  });
  it('M1: control characters and backslashes cannot smuggle an off-site redirect', () => {
    // The premise: WHATWG parsing strips the tab, so this resolves to https://example.invalid/.
    expect(new URL('/\t//example.invalid', 'https://app.invalid').origin).toBe('https://example.invalid');
    for (const bad of [
      '/\t//example.invalid',
      '/\n//example.invalid',
      '/\r//example.invalid',
      '/\x00//example.invalid',
      '/\x7f//example.invalid',
      '/\t/example.invalid',
      '\t/scan/demo',
      '/scan/demo?q=\n',
      '/ /example.invalid',
      '/\\example.invalid',
    ]) {
      expect(safeNextPath(bad)).toBe('/');
    }
    expect(safeNextPath('/scan/demo', '/me')).toBe('/scan/demo');
  });
});
