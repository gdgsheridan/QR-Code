import { describe, expect, it } from 'vitest';
import { sha256hex } from '@/lib/domain/token';
import { clientIpKey } from '@/lib/http/ip';
import { ipKey } from '@/lib/pass/handlers';

const h = (init?: Record<string, string>) => new Headers(init);

describe('client IP key (M2)', () => {
  it('ignores the spoofable leftmost hop, keys the rightmost platform hop', () => {
    const key = clientIpKey(h({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }), 'pass');
    expect(key).toBe(clientIpKey(h({ 'x-forwarded-for': '9.9.9.9, 5.6.7.8' }), 'pass'));
    expect(key).not.toBe(clientIpKey(h({ 'x-forwarded-for': '1.2.3.4, 6.6.6.6' }), 'pass'));
    expect(key).toBe(clientIpKey(h({ 'x-forwarded-for': '  1.2.3.4 , 5.6.7.8  ' }), 'pass'));
  });
  it('falls back to x-real-ip, then a stable unknown bucket', () => {
    expect(clientIpKey(h({ 'x-real-ip': '5.6.7.8' }), 'pass')).toBe(
      clientIpKey(h({ 'x-forwarded-for': '9.9.9.9, 5.6.7.8' }), 'pass'),
    );
    expect(clientIpKey(h(), 'pass')).toBe(clientIpKey(h(), 'pass'));
    expect(clientIpKey(h({ 'x-forwarded-for': ' , ' }), 'pass')).toBe(clientIpKey(h(), 'pass'));
  });
  it('separates scopes and never contains the raw IP', () => {
    const ip = '203.0.113.7';
    const key = clientIpKey(h({ 'x-forwarded-for': `1.1.1.1, ${ip}` }), 'pass');
    expect(key).toBe(`pass:ip:${sha256hex(ip).slice(0, 32)}`);
    expect(key).not.toContain(ip);
    expect(key).not.toContain('1.1.1.1');
    expect(clientIpKey(h({ 'x-forwarded-for': ip }), 'rsvp')).toBe(`rsvp:ip:${sha256hex(ip).slice(0, 32)}`);
  });
  it('ipKey delegates with the same key shape', () => {
    const headers = h({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' });
    expect(ipKey(headers, 'pass')).toBe(clientIpKey(headers, 'pass'));
    expect(ipKey(headers)).toBe(clientIpKey(headers, 'pass'));
  });
});
