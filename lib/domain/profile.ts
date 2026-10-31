import { normalizeDiscord, normalizeLinkedIn, normalizeWebsite } from './badge';

// SPEC F13/F14 (v0.6): what a hacker types on the RSVP Yes form and in their menu. A missing field is left
// unchanged; a blank LinkedIn or dietary note clears it. The emergency contact is all-or-nothing.
// v0.9: the profile setup answers (overnight, allergies with their severity, team status, accessibility).
// v0.9.2: a Discord username and a website, cleared by a blank like LinkedIn.
export interface ProfileInput {
  linkedin?: string;
  discord?: string;
  website?: string;
  directoryOptIn?: boolean;
  bio?: string;
  pace?: string;
  profilePublic?: boolean;
  dietaryNotes?: string;
  emergencyName?: string;
  emergencyPhone?: string;
  emergencyRelation?: string;
  overnight?: string;
  allergies?: string;
  allergySeverity?: string;
  teamStatus?: string;
  accessibility?: string;
}

export const PACE = { competitive: 'Going for the win', balanced: 'Balanced', casual: 'Here to learn and meet people' } as const;

export const OVERNIGHT = ['yes', 'no', 'unsure'] as const;
export const ALLERGY_SEVERITY = ['mild', 'moderate', 'severe'] as const;
export const TEAM_STATUS = ['team', 'looking', 'solo'] as const;

export interface ProfileFields {
  linkedinUrl?: string; // normalized, or '' to clear
  discordUsername?: string; // normalized, or '' to clear
  websiteUrl?: string; // normalized, or '' to clear
  directoryOptIn?: boolean;
  bio?: string; // '' clears
  pace?: keyof typeof PACE | '';
  profilePublic?: boolean;
  dietaryNotes?: string; // '' clears
  emergency?: { name: string; phone: string; relation: string }; // relation '' = none
  overnight?: (typeof OVERNIGHT)[number];
  allergy?: { text: string; severity: (typeof ALLERGY_SEVERITY)[number] | '' }; // text '' clears both
  teamStatus?: (typeof TEAM_STATUS)[number];
  accessibility?: string; // '' clears
}

export type ProfileField =
  | 'bio'
  | 'pace'
  | 'linkedin'
  | 'discord'
  | 'website'
  | 'dietaryNotes'
  | 'emergencyName'
  | 'emergencyPhone'
  | 'emergencyRelation'
  | 'overnight'
  | 'allergies'
  | 'allergySeverity'
  | 'teamStatus'
  | 'accessibility';

const oneOf = <T extends string>(choices: readonly T[], v: string): v is T => (choices as readonly string[]).includes(v);

// The same character set as the participants check; at least 3 digits is checked only here.
const PHONE_RE = /^[0-9+() .-]{3,30}$/;
// The same rule as an HTML pattern (v-flag syntax), so the browser catches a typo before the form is sent.
export const PHONE_PATTERN = '(?=(?:\\D*\\d){3})[0-9+\\(\\) .\\-]{3,30}';

export function parseProfileInput(
  raw: ProfileInput,
  // requireSetup: the profile setup form, which also needs overnight and team status. The contact is required too,
  // but set on its own page (/me/emergency), so setup only checks one that is given.
  opts: { requireEmergency: boolean; requireSetup?: boolean },
): { ok: true; value: ProfileFields } | { ok: false; field: ProfileField } {
  const value: ProfileFields = {};
  if (raw.directoryOptIn !== undefined) value.directoryOptIn = raw.directoryOptIn;
  if (raw.bio !== undefined) {
    const bio = raw.bio.replace(/\r\n/g, '\n').trim();
    if (bio.length > 280) return { ok: false, field: 'bio' };
    value.bio = bio;
  }
  if (raw.pace !== undefined) {
    const pace = raw.pace.trim();
    if (pace !== '' && !oneOf(Object.keys(PACE) as Array<keyof typeof PACE>, pace)) return { ok: false, field: 'pace' };
    value.pace = pace as keyof typeof PACE | '';
  }
  if (raw.linkedin !== undefined) {
    const linkedin = raw.linkedin.trim() === '' ? '' : normalizeLinkedIn(raw.linkedin);
    if (linkedin === null) return { ok: false, field: 'linkedin' };
    value.linkedinUrl = linkedin;
  }
  if (raw.discord !== undefined) {
    const discord = raw.discord.trim() === '' ? '' : normalizeDiscord(raw.discord);
    if (discord === null) return { ok: false, field: 'discord' };
    value.discordUsername = discord;
  }
  if (raw.website !== undefined) {
    const website = raw.website.trim() === '' ? '' : normalizeWebsite(raw.website);
    if (website === null) return { ok: false, field: 'website' };
    value.websiteUrl = website;
  }
  if (raw.profilePublic !== undefined) value.profilePublic = raw.profilePublic;
  if (raw.dietaryNotes !== undefined) {
    const dietary = raw.dietaryNotes.trim();
    if (dietary.length > 500) return { ok: false, field: 'dietaryNotes' };
    value.dietaryNotes = dietary;
  }
  const given = [raw.emergencyName, raw.emergencyPhone, raw.emergencyRelation].some((v) => v !== undefined);
  if (given || opts.requireEmergency) {
    const name = (raw.emergencyName ?? '').trim();
    const phone = (raw.emergencyPhone ?? '').trim();
    const relation = (raw.emergencyRelation ?? '').trim();
    if (name.length < 1 || name.length > 100) return { ok: false, field: 'emergencyName' };
    if (!PHONE_RE.test(phone) || (phone.match(/\d/g) ?? []).length < 3) return { ok: false, field: 'emergencyPhone' };
    if (relation.length > 60) return { ok: false, field: 'emergencyRelation' };
    value.emergency = { name, phone, relation };
  }
  if (raw.overnight !== undefined || opts.requireSetup) {
    const overnight = raw.overnight ?? '';
    if (!oneOf(OVERNIGHT, overnight)) return { ok: false, field: 'overnight' };
    value.overnight = overnight;
  }
  if (raw.allergies !== undefined) {
    const text = raw.allergies.trim();
    const severity = raw.allergySeverity ?? '';
    if (text.length > 300) return { ok: false, field: 'allergies' };
    if (text === '') value.allergy = { text: '', severity: '' };
    else if (oneOf(ALLERGY_SEVERITY, severity)) value.allergy = { text, severity };
    else return { ok: false, field: 'allergySeverity' };
  }
  if (raw.teamStatus !== undefined || opts.requireSetup) {
    const teamStatus = raw.teamStatus ?? '';
    if (!oneOf(TEAM_STATUS, teamStatus)) return { ok: false, field: 'teamStatus' };
    value.teamStatus = teamStatus;
  }
  if (raw.accessibility !== undefined) {
    // A browser counts a line break as one character for maxLength but sends \r\n: count it as the browser does.
    const accessibility = raw.accessibility.replace(/\r\n/g, '\n').trim();
    if (accessibility.length > 500) return { ok: false, field: 'accessibility' };
    value.accessibility = accessibility;
  }
  return { ok: true, value };
}
