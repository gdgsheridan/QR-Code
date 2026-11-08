// `pnpm event:create --slug datathon-2026 --name "Datathon 2026" --venue "Bahen Centre" \
//    --starts 2026-10-03T09:00 --ends 2026-10-03T18:00 --tz America/Toronto --organizer you@club.org`
// Bootstraps an event, its door checkpoint (closed), and an invite for the first organizer, who then
// signs in at /login with that email. The SPEC has no event-creation flow; this fills that gap.
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types.gen';
import { zonedToUtc } from '@/lib/domain/event-time';
import { normalizeEmail } from '@/lib/domain/normalize';

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

async function main() {
  const { values } = parseArgs({
    options: {
      slug: { type: 'string' },
      name: { type: 'string' },
      venue: { type: 'string' },
      starts: { type: 'string' },
      ends: { type: 'string' },
      tz: { type: 'string', default: 'America/Toronto' },
      organizer: { type: 'string' },
    },
  });
  const { slug, name, venue, starts, ends, tz, organizer } = values;
  if (!slug || !name || !venue || !starts || !ends || !tz || !organizer) {
    throw new Error('required: --slug --name --venue --starts --ends --organizer (optional --tz)');
  }
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) throw new Error('slug must match ^[a-z0-9-]{3,40}$');
  new Intl.DateTimeFormat('en-US', { timeZone: tz }); // throws on an unknown timezone

  const url = need('NEXT_PUBLIC_SUPABASE_URL');
  console.log(`Target Supabase: ${url}`);
  const db = createClient<Database>(url, need('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

  const event = await db
    .from('events')
    .insert({ slug, name, venue, timezone: tz, starts_at: zonedToUtc(starts, tz), ends_at: zonedToUtc(ends, tz) })
    .select('id')
    .single();
  if (event.error) throw new Error(`event insert failed: ${event.error.message}`);
  const door = await db.from('checkpoints').insert({ event_id: event.data.id, name: 'Check-in', kind: 'door', requires_checkin: false, is_open: false });
  if (door.error) throw new Error(`door insert failed: ${door.error.message}`);
  const invite = await db.from('staff_invites').insert({ event_id: event.data.id, email: normalizeEmail(organizer), role: 'organizer' });
  if (invite.error) throw new Error(`invite failed: ${invite.error.message}`);
  console.log(`Created "${name}" (${slug}) with a closed Door checkpoint. ${normalizeEmail(organizer)} can now sign in at /login.`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
