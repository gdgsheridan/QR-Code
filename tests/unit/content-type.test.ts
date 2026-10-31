import { describe, expect, it } from 'vitest';
import { isJsonContentType } from '@/lib/http/content-type';

describe('content-type guard (L13/A07)', () => {
  it('L13/A07: accepts application/json with charset parameters', () => {
    expect(isJsonContentType('application/json')).toBe(true);
    expect(isJsonContentType('application/json; charset=utf-8')).toBe(true);
    expect(isJsonContentType('Application/JSON; Charset=UTF-8')).toBe(true);
  });

  it('L13/A07: rejects text/plain, missing, application/x-www-form-urlencoded', () => {
    expect(isJsonContentType('text/plain')).toBe(false);
    expect(isJsonContentType('text/plain;charset=UTF-8')).toBe(false);
    expect(isJsonContentType('application/x-www-form-urlencoded')).toBe(false);
    expect(isJsonContentType('multipart/form-data; boundary=----x')).toBe(false);
    expect(isJsonContentType(null)).toBe(false);
    expect(isJsonContentType(undefined)).toBe(false);
    expect(isJsonContentType('')).toBe(false);
  });
});
