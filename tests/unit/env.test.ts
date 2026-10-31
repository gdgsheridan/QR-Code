import { describe, expect, it } from 'vitest';
import { cronSecret, emailDrainSecret, parseServerEnv } from '@/lib/env';

const valid = {
  NEXT_PUBLIC_APP_ORIGIN: 'http://localhost:3000',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  SHEET_INGEST_SECRET: 'x'.repeat(32),
  DRAIN_SECRET: 'y'.repeat(32),
  PASS_TOKEN_SECRET: 'z'.repeat(32),
  EMAIL_PROVIDER: 'console',
};

describe('lib/env (S0 smoke)', () => {
  it('accepts a complete console-mode env', () => {
    expect(parseServerEnv(valid).EMAIL_PROVIDER).toBe('console');
  });

  it('throws listing a missing required key, without echoing secret values', () => {
    const rest: Record<string, string> = { ...valid };
    delete rest.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => parseServerEnv({ ...rest, DRAIN_SECRET: 'short-secret-value' })).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY[\s\S]*DRAIN_SECRET/,
    );
    try {
      parseServerEnv({ ...rest, DRAIN_SECRET: 'short-secret-value' });
    } catch (e) {
      expect(String(e)).not.toContain('short-secret-value');
    }
  });

  it('treats empty strings as unset', () => {
    expect(() => parseServerEnv({ ...valid, DRAIN_SECRET: '' })).toThrow(/DRAIN_SECRET/);
  });

  it('T-AUTH-06: ADMIN_EMAILS is a normalized comma list, empty when unset', () => {
    expect(parseServerEnv({ ...valid, ADMIN_EMAILS: ' Yves@X.com, b@y.com ,' }).ADMIN_EMAILS).toEqual(['yves@x.com', 'b@y.com']);
    expect(parseServerEnv(valid).ADMIN_EMAILS).toEqual([]);
  });

  it('requires RESEND_API_KEY and EMAIL_FROM when EMAIL_PROVIDER=resend', () => {
    expect(() => parseServerEnv({ ...valid, EMAIL_PROVIDER: 'resend' })).toThrow(/RESEND_API_KEY[\s\S]*EMAIL_FROM/);
  });

  it('L1: CRON_SECRET and EMAIL_DRAIN_SECRET are separate; legacy DRAIN_SECRET backs both', () => {
    expect(parseServerEnv({ ...valid, CRON_SECRET: 'c'.repeat(32), EMAIL_DRAIN_SECRET: 'e'.repeat(32) }).EMAIL_PROVIDER).toBe('console');
    expect(cronSecret(parseServerEnv(valid))).toBe(valid.DRAIN_SECRET);
    expect(emailDrainSecret(parseServerEnv(valid))).toBe(valid.DRAIN_SECRET);
    const both = parseServerEnv({ ...valid, CRON_SECRET: 'c'.repeat(32), EMAIL_DRAIN_SECRET: 'e'.repeat(32) });
    expect(cronSecret(both)).toBe('c'.repeat(32));
    expect(emailDrainSecret(both)).toBe('e'.repeat(32));
  });

  it('L1: each credential needs backing once DRAIN_SECRET is gone', () => {
    const rest: Record<string, string> = { ...valid };
    delete rest.DRAIN_SECRET;
    expect(() => parseServerEnv(rest)).toThrow(/CRON_SECRET[\s\S]*EMAIL_DRAIN_SECRET/);
  });

  it('rejects an app origin with a path or trailing slash', () => {
    expect(() => parseServerEnv({ ...valid, NEXT_PUBLIC_APP_ORIGIN: 'http://localhost:3000/' })).toThrow(/APP_ORIGIN/);
  });

  it('T-NFC-15: BADGE_ORIGIN is optional and, when set, a bare origin like the app origin', () => {
    expect(parseServerEnv(valid).BADGE_ORIGIN).toBeUndefined();
    expect(parseServerEnv({ ...valid, BADGE_ORIGIN: 'https://nfc.yvesdonato.com' }).BADGE_ORIGIN).toBe('https://nfc.yvesdonato.com');
    expect(() => parseServerEnv({ ...valid, BADGE_ORIGIN: 'https://nfc.yvesdonato.com/' })).toThrow(/BADGE_ORIGIN/);
    expect(() => parseServerEnv({ ...valid, BADGE_ORIGIN: 'https://nfc.yvesdonato.com/profile' })).toThrow(/BADGE_ORIGIN/);
  });
});
