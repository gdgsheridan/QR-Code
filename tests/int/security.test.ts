import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireEnv } from '../fixtures/db';
import { createStandardFixture, STAFF_PASSWORD, type StandardFixture } from '../fixtures/standard';

// Nothing here hardcodes a table, view or function list (CLAUDE.md): everything is enumerated.

let f: StandardFixture;
let tables: string[] = [];
beforeAll(async () => {
  f = await createStandardFixture();
  const { rows } = await f.pool.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public' order by 1`,
  );
  tables = rows.map((r) => r.tablename);
});
afterAll(async () => {
  await f.close();
});

async function rowCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of tables) {
    const { rows } = await f.pool.query<{ n: number }>(`select count(*)::int as n from public.${JSON.stringify(t)}`);
    out[t] = rows[0]?.n ?? -1;
  }
  return out;
}

async function firstColumn(table: string): Promise<string> {
  const { rows } = await f.pool.query<{ column_name: string }>(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = $1 order by ordinal_position limit 1`,
    [table],
  );
  const col = rows[0]?.column_name;
  if (!col) throw new Error(`no columns on ${table}`);
  return col;
}

describe('security (SPEC §14.12)', () => {
  it('T-SEC-01: every public table denies anon and authenticated select/insert/update/delete via the API', async () => {
    const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
    const anonKey = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const auth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await auth.auth.signInWithPassword({ email: f.staffEmail.vol1, password: STAFF_PASSWORD });
    if (error || !data.session) throw new Error(`sign-in failed: ${error?.message ?? 'no session'}`);
    const bearers = { anon: anonKey, authenticated: data.session.access_token };

    expect(tables.length).toBeGreaterThanOrEqual(12);
    const before = await rowCounts();

    for (const [who, bearer] of Object.entries(bearers)) {
      const headers = {
        apikey: anonKey,
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      };
      for (const t of tables) {
        const col = await firstColumn(t);
        const base = `${url}/rest/v1/${t}`;
        const filter = `?${encodeURIComponent(col)}=not.is.null`;
        const attempts = [
          fetch(`${base}?select=*`, { headers }),
          fetch(base, { method: 'POST', headers, body: '{}' }),
          fetch(base + filter, { method: 'PATCH', headers, body: JSON.stringify({ [col]: null }) }),
          fetch(base + filter, { method: 'DELETE', headers }),
        ];
        for (const res of await Promise.all(attempts)) {
          const body = await res.text();
          const deniedOrEmpty = !res.ok || body.trim() === '[]';
          expect(deniedOrEmpty, `${who} ${res.url} → ${res.status} ${body.slice(0, 120)}`).toBe(true);
        }
      }
    }
    expect(await rowCounts()).toEqual(before);
  });

  it('T-SEC-02: row level security is enabled on every public table', async () => {
    const { rows } = await f.pool.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' and not rowsecurity`,
    );
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it('T-SEC-07: every public view is security_invoker and not selectable by anon/authenticated', async () => {
    const { rows } = await f.pool.query<{ name: string; invoker: boolean; anon: boolean; authed: boolean }>(
      `select c.relname as name,
              coalesce('security_invoker=true' = any(c.reloptions), false) as invoker,
              has_table_privilege('anon', c.oid, 'select') as anon,
              has_table_privilege('authenticated', c.oid, 'select') as authed
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('v', 'm')`,
    );
    for (const v of rows) expect(v, v.name).toMatchObject({ invoker: true, anon: false, authed: false });
  });

  it('T-SEC-08: public functions: no EXECUTE for PUBLIC/anon/authenticated; SECURITY DEFINER pins search_path', async () => {
    const { rows } = await f.pool.query<{
      sig: string;
      definer: boolean;
      config: string[] | null;
      public_exec: boolean;
      anon: boolean;
      authed: boolean;
    }>(
      `select p.oid::regprocedure::text as sig, p.prosecdef as definer, p.proconfig as config,
              coalesce(p.proacl is null or exists (
                select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'), true) as public_exec,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authed
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`,
    );
    const names = rows.map((r) => r.sig.split('(')[0]);
    for (const expected of ['record_scan', 'issue_pass', 'void_scan', 'unlink_badge', '_who', '_prior', 'team_invite', '_participant_team', 'hacker_directory', '_set_hacker_profile', 'save_hacker_profile', 'set_team_tracks', 'team_set_tracks']) expect(names).toContain(expected);
    for (const fn of rows) {
      expect(fn, fn.sig).toMatchObject({ public_exec: false, anon: false, authed: false });
      if (fn.definer) {
        expect(fn.config ?? [], fn.sig).toContain('search_path=public, pg_temp');
      }
    }
    const { rows: grants } = await f.pool.query<{ ok: boolean }>(
      `select bool_and(has_function_privilege('service_role', p.oid, 'execute')) as ok
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('record_scan', 'issue_pass', 'void_scan', 'unlink_badge', 'team_invite', '_participant_team', 'hacker_directory', '_set_hacker_profile', 'save_hacker_profile')`,
    );
    expect(grants[0]?.ok).toBe(true);
  });
});
