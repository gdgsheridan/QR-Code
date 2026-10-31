import { describe, expect, it } from 'vitest';
import { parseScannedText } from '@/lib/domain/scanned-text';

const ORIGIN = 'https://station.example.com';
const TOKEN = 'Ab3_-xYz0123456789abcdefGHIJKLMN';

function malformed(raw: string, origin = ORIGIN) {
  let result: ReturnType<typeof parseScannedText> | undefined;
  expect(() => {
    result = parseScannedText(raw, origin);
  }).not.toThrow();
  expect(result).toEqual({ ok: false, reason: 'MALFORMED' });
}

describe('parseScannedText (SPEC §6.4)', () => {
  it('T-TOK-02: parses ${APP_ORIGIN}/p#<token>', () => {
    expect(TOKEN).toHaveLength(32);
    expect(parseScannedText(`${ORIGIN}/p#${TOKEN}`, ORIGIN)).toEqual({ ok: true, token: TOKEN });
  });

  it('T-TOK-03: parses a bare 32-char token, with or without surrounding whitespace', () => {
    expect(parseScannedText(TOKEN, ORIGIN)).toEqual({ ok: true, token: TOKEN });
    expect(parseScannedText(`  \n${TOKEN}\t `, ORIGIN)).toEqual({ ok: true, token: TOKEN });
    expect(parseScannedText(` ${ORIGIN}/p#${TOKEN}\n`, ORIGIN)).toEqual({ ok: true, token: TOKEN });
  });

  it('T-TOK-04: other origins, http in prod, wrong paths, wrong lengths, bad chars, extra params are MALFORMED', () => {
    malformed(`https://evil.example.com/p#${TOKEN}`);
    malformed(`https://station.example.com.evil.com/p#${TOKEN}`);
    malformed(`http://station.example.com/p#${TOKEN}`);
    malformed(`${ORIGIN}/p?t=${TOKEN}`);
    malformed(`${ORIGIN}/pass#${TOKEN}`);
    malformed(`${ORIGIN}/p#${TOKEN.slice(1)}`);
    malformed(`${ORIGIN}/p#${TOKEN}x`);
    malformed(TOKEN.slice(1));
    malformed(`${TOKEN}x`);
    malformed(`${TOKEN.slice(1)}+`);
    malformed(`${TOKEN.slice(1)}/`);
    malformed(`${ORIGIN}/p#${TOKEN}&x=1`);
    malformed(`${ORIGIN}/p#${TOKEN}#x`);
    // Regex metacharacters in the origin are literal: '.' must not match any char.
    malformed(`https://stationXexample.com/p#${TOKEN}`);
  });

  it('T-TOK-05: Wi-Fi codes, vCards, empty strings, 5 KB strings and emoji are MALFORMED without throwing', () => {
    malformed('WIFI:S:x;;');
    malformed('BEGIN:VCARD\nVERSION:3.0\nFN:Ada\nEND:VCARD');
    malformed('');
    malformed('   ');
    malformed('a'.repeat(5 * 1024));
    malformed(`${' '.repeat(3000)}${TOKEN}`);
    malformed('😀'.repeat(32));
    malformed(`${ORIGIN}/p#${'😀'.repeat(16)}`);
  });

  it('T-TOK-02: passes emailed before the domain moved (v0.11.15) still parse; only over https', () => {
    expect(parseScannedText(`https://nfc.yvesdonato.com/p#${TOKEN}`, ORIGIN)).toEqual({ ok: true, token: TOKEN });
    malformed(`http://nfc.yvesdonato.com/p#${TOKEN}`);
    malformed(`https://nfc.yvesdonato.com.evil.com/p#${TOKEN}`);
  });

  it('T-TOK-02: a dev http origin works when APP_ORIGIN is http', () => {
    expect(parseScannedText(`http://localhost:3000/p#${TOKEN}`, 'http://localhost:3000')).toEqual({ ok: true, token: TOKEN });
  });
});
