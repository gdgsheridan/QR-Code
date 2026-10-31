import { describe, expect, it } from 'vitest';
import { isSameOriginPost } from '@/app/auth/signout/route';

const post = (url: string, init?: Record<string, string>) =>
  new Request(url, { method: 'POST', headers: init });

describe('signout CSRF guard (L9)', () => {
  it('allows same-origin posts, the no-JS flow and headerless clients', () => {
    expect(isSameOriginPost(post('https://app.invalid/auth/signout', { origin: 'https://app.invalid' }))).toBe(true);
    expect(isSameOriginPost(post('https://app.invalid/auth/signout', { 'sec-fetch-site': 'same-origin' }))).toBe(true);
    expect(isSameOriginPost(post('https://app.invalid/auth/signout', { referer: 'https://app.invalid/login' }))).toBe(true);
    expect(isSameOriginPost(post('https://app.invalid/auth/signout'))).toBe(true);
  });
  it('rejects cross-site posts before signing out', () => {
    expect(isSameOriginPost(post('https://app.invalid/auth/signout', { origin: 'https://evil.invalid' }))).toBe(false);
    expect(isSameOriginPost(post('https://app.invalid/auth/signout', { referer: 'https://evil.invalid/' }))).toBe(false);
    expect(isSameOriginPost(post('https://app.invalid/auth/signout', { 'sec-fetch-site': 'cross-site' }))).toBe(false);
    expect(isSameOriginPost(post('https://app.invalid/auth/signout', { origin: 'not a url' }))).toBe(false);
  });
});
