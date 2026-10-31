import { describe, expect, it } from 'vitest';
import { parseProfileInput } from '@/lib/domain/profile';

const contact = { emergencyName: 'Sam Lee', emergencyPhone: '+1 (416) 555-0100', emergencyRelation: 'Parent' };

describe('parseProfileInput (SPEC F13/F14, v0.6)', () => {
  it('T-ME-04: trims and normalizes; missing fields stay unchanged, blank ones clear', () => {
    expect(parseProfileInput({}, { requireEmergency: false })).toEqual({ ok: true, value: {} });
    expect(
      parseProfileInput(
        {
          linkedin: ' linkedin.com/in/ada-l ',
          profilePublic: true,
          dietaryNotes: ' Vegan ',
          emergencyName: ' Sam Lee ',
          emergencyPhone: ' 416.555.0100 ',
          emergencyRelation: '  ',
        },
        { requireEmergency: true },
      ),
    ).toEqual({
      ok: true,
      value: {
        linkedinUrl: 'https://www.linkedin.com/in/ada-l',
        profilePublic: true,
        dietaryNotes: 'Vegan',
        emergency: { name: 'Sam Lee', phone: '416.555.0100', relation: '' },
      },
    });
    expect(parseProfileInput({ linkedin: '  ', dietaryNotes: '' }, { requireEmergency: false })).toEqual({
      ok: true,
      value: { linkedinUrl: '', dietaryNotes: '' },
    });
    expect(parseProfileInput({ ...contact, emergencyName: 'n'.repeat(100), dietaryNotes: 'd'.repeat(500) }, { requireEmergency: false })).toMatchObject({
      ok: true,
    });
  });

  it('T-ME-04: names the first invalid field and never throws', () => {
    const bad: Array<[Parameters<typeof parseProfileInput>[0], string]> = [
      [{ linkedin: 'linkedin.com/company/x' }, 'linkedin'],
      [{ dietaryNotes: 'd'.repeat(501) }, 'dietaryNotes'],
      [{ ...contact, emergencyName: '  ' }, 'emergencyName'],
      [{ ...contact, emergencyName: 'n'.repeat(101) }, 'emergencyName'],
      [{ ...contact, emergencyPhone: 'abc' }, 'emergencyPhone'],
      [{ ...contact, emergencyPhone: '12' }, 'emergencyPhone'],
      [{ ...contact, emergencyPhone: '+() --' }, 'emergencyPhone'],
      [{ ...contact, emergencyPhone: '1'.repeat(31) }, 'emergencyPhone'],
      [{ emergencyName: 'Sam Lee' }, 'emergencyPhone'],
      [{ ...contact, emergencyRelation: 'r'.repeat(61) }, 'emergencyRelation'],
    ];
    for (const [input, field] of bad) {
      expect(parseProfileInput(input, { requireEmergency: false }), JSON.stringify(input)).toEqual({ ok: false, field });
    }
    // The RSVP Yes form requires the emergency contact.
    expect(parseProfileInput({ linkedin: '' }, { requireEmergency: true })).toEqual({ ok: false, field: 'emergencyName' });
    expect(parseProfileInput(contact, { requireEmergency: true })).toMatchObject({ ok: true });
  });
});

describe('parseProfileInput: profile setup (SPEC F14, v0.9)', () => {
  const setup = { ...contact, overnight: 'unsure', teamStatus: 'looking', allergies: ' Peanuts ', allergySeverity: 'severe', accessibility: ' Step-free access ' };

  it('T-ME-09: reads the setup answers; blank allergies clear the severity too; blank accessibility clears', () => {
    expect(parseProfileInput(setup, { requireEmergency: true, requireSetup: true })).toEqual({
      ok: true,
      value: {
        emergency: { name: 'Sam Lee', phone: '+1 (416) 555-0100', relation: 'Parent' },
        overnight: 'unsure',
        teamStatus: 'looking',
        allergy: { text: 'Peanuts', severity: 'severe' },
        accessibility: 'Step-free access',
      },
    });
    expect(parseProfileInput({ allergies: ' ', allergySeverity: 'mild', accessibility: '' }, { requireEmergency: false })).toEqual({
      ok: true,
      value: { allergy: { text: '', severity: '' }, accessibility: '' },
    });
    expect(parseProfileInput({ allergies: 'a'.repeat(300), allergySeverity: 'mild', accessibility: 'x'.repeat(500) }, { requireEmergency: false })).toMatchObject({ ok: true });
    // A browser counts a line break as one character for maxLength but sends it as \r\n: 500 typed is 500 stored.
    expect(parseProfileInput({ accessibility: `${'x'.repeat(249)}\r\n${'x'.repeat(250)}` }, { requireEmergency: false })).toEqual({
      ok: true,
      value: { accessibility: `${'x'.repeat(249)}\n${'x'.repeat(250)}` },
    });
  });

  it('T-ME-09: the setup form needs overnight and team status (the contact has its own page); bad choices and lengths name their field', () => {
    const bad: Array<[Parameters<typeof parseProfileInput>[0], string]> = [
      [{ ...setup, overnight: 'maybe' }, 'overnight'],
      [{ ...setup, overnight: '' }, 'overnight'],
      [{ ...setup, overnight: undefined }, 'overnight'],
      [{ ...setup, teamStatus: 'duo' }, 'teamStatus'],
      [{ ...setup, teamStatus: undefined }, 'teamStatus'],
      [{ ...setup, allergySeverity: '' }, 'allergySeverity'],
      [{ ...setup, allergySeverity: 'deadly' }, 'allergySeverity'],
      [{ ...setup, allergies: 'a'.repeat(301) }, 'allergies'],
      [{ ...setup, accessibility: 'x'.repeat(501) }, 'accessibility'],
    ];
    for (const [input, field] of bad) {
      expect(parseProfileInput(input, { requireEmergency: false, requireSetup: true }), JSON.stringify(input)).toEqual({ ok: false, field });
    }
    // Setup without the contact leaves it unchanged; a contact that is given is still checked.
    const noContact = { ...setup, emergencyName: undefined, emergencyPhone: undefined, emergencyRelation: undefined };
    const parsed = parseProfileInput(noContact, { requireEmergency: false, requireSetup: true });
    expect(parsed).toMatchObject({ ok: true });
    expect(parsed.ok && 'emergency' in parsed.value).toBe(false);
    expect(parseProfileInput({ ...setup, emergencyPhone: '12' }, { requireEmergency: false, requireSetup: true })).toEqual({ ok: false, field: 'emergencyPhone' });
    // Outside the setup form, missing answers stay unchanged, but a given one is still checked.
    expect(parseProfileInput({ linkedin: '' }, { requireEmergency: false })).toEqual({ ok: true, value: { linkedinUrl: '' } });
    expect(parseProfileInput({ overnight: 'maybe' }, { requireEmergency: false })).toEqual({ ok: false, field: 'overnight' });
  });
});
