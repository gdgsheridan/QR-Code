import { createAdminApi, type AdminDeps } from '@/lib/admin/handlers';
import { drainUntilIdle } from '@/lib/email/drain';
import { requireEnv } from './db';
import { mockProvider, serviceClient } from './mail';
import { asBearer, bearerAuth } from './staff';

type Handler = (request: Request, params: Record<string, string>) => Promise<Response>;

export function adminClient(over: Partial<AdminDeps> = {}) {
  const db = serviceClient();
  const mail = mockProvider();
  const scheduled: Array<() => Promise<unknown>> = [];
  // Until idle: other files' leftover due rows must not crowd this test's row out of a batch.
  const drain = () =>
    drainUntilIdle({ db, provider: mail.provider, appOrigin: 'http://localhost:3100', from: 'Station <p@localhost>', passSecret: requireEnv('PASS_TOKEN_SECRET') });
  const api = createAdminApi({
    db,
    authenticate: bearerAuth,
    scheduleDrain: (t) => scheduled.push(t),
    drain,
    appOrigin: 'http://localhost:3100',
    ...over,
  });

  async function call(
    handler: keyof typeof api,
    jwt: string | null,
    params: Record<string, string>,
    init: { method?: string; body?: unknown; query?: Record<string, string> } = {},
  ) {
    const url = new URL('http://localhost/api/admin/x');
    for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
    const request = new Request(url, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: { 'content-type': 'application/json', ...asBearer(jwt) },
      ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
    });
    const res = await (api[handler] as Handler)(request, params);
    const type = res.headers.get('content-type') ?? '';
    // Raw bytes for non-JSON: Response.text() would silently strip the CSV's UTF-8 BOM.
    const body: unknown = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()).toString('utf8');
    return { status: res.status, body, headers: res.headers };
  }

  return { db, mail, scheduled, drain, api, call };
}

export const obj = (v: unknown) => v as Record<string, unknown>;
