import { describe, expect, it } from 'vitest';
import { ANONYMISED_NAME, anonymisedEmail, anonymisedPatch, needsAnonymisation } from '@/lib/privacy/retention';

// A04: 12-month participant-PII anonymisation helpers (pure; the int run needs live Supabase).
describe('retention PII anonymisation (SPEC §15, A04)', () => {
  it('T-PRIV-04 (A04): anonymised email is deterministic and tombstone-shaped', () => {
    expect(anonymisedEmail('abc')).toBe('deleted+abc@invalid');
    expect(anonymisedEmail('abc')).toBe(anonymisedEmail('abc'));
  });

  it('T-PRIV-04 (A04): rows already tombstoned or anonymised are not selected again', () => {
    expect(needsAnonymisation({ email: 'rae@example.test' })).toBe(true);
    expect(needsAnonymisation({ email: null })).toBe(true);
    expect(needsAnonymisation({ email: 'deleted+abc@invalid' })).toBe(false);
    expect(needsAnonymisation({ email: 'Deleted+abc@invalid' })).toBe(true); // tombstones are lowercase
  });

  it('T-PRIV-04 (A04): patch clears PII, keeps identity/membership, satisfies NOT NULL checks', () => {
    const patch = anonymisedPatch('abc', '2026-10-31T00:00:00.000Z');
    // Cleared: contact, names-into-tombstone, photo, health, emergency, directory, token.
    expect(patch).toMatchObject({
      email: 'deleted+abc@invalid',
      first_name: ANONYMISED_NAME,
      last_name: '',
      search_text: '',
      photo_path: null,
      dietary_notes: null,
      emergency_name: null,
      emergency_phone: null,
      allergies: null,
      accessibility: null,
      linkedin_url: null,
      discord_username: null,
      website_url: null,
      bio: null,
      pace: null,
      directory_opt_in: false,
      rsvp_token_hash: null,
    });
    // Kept out of the patch (untouched): id, event_id, status, team_id, scans, external_id.
    for (const kept of ['id', 'event_id', 'status', 'team_id', 'external_id'] as const) {
      expect(patch).not.toHaveProperty(kept);
    }
    // NOT NULL columns still validate: lowercase-trimmed email, 1–100 char first name.
    expect(patch.email).toBe(patch.email?.toLowerCase().trim());
    expect(patch.first_name?.length).toBeGreaterThanOrEqual(1);
  });
});
