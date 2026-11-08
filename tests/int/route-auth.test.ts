import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// T-SEC-04: every route handler, called without credentials, refuses. Enumerated from the file
// system so a new route can't be forgotten.
const API_DIR = join(process.cwd(), 'app', 'api');
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
// Routes with their own authentication (SPEC T-SEC-04): they must still refuse an anonymous call.
const SELF_AUTH = new Set(['/api/pass', '/api/rsvp', '/api/ingest/sheet', '/api/email/drain', '/api/catering']);

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === 'route.ts' ? [full] : [];
  });
}

type Handler = (request: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

describe('route authorization (SPEC §14.12)', () => {
  const files = routeFiles(API_DIR);

  it('T-SEC-04: finds the route handlers', () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it('T-SEC-04: every route handler refuses an unauthenticated call', async () => {
    const checked: string[] = [];
    for (const file of files) {
      const path = `/api/${relative(API_DIR, file).split(sep).slice(0, -1).join('/')}`;
      const mod: Record<string, unknown> = await import(/* @vite-ignore */ file);
      for (const method of METHODS) {
        const handler = mod[method];
        if (typeof handler !== 'function') continue;
        const url = `http://localhost${path.replace('[slug]', 'demo').replace('[id]', '00000000-0000-4000-8000-000000000000')}?q=ab`;
        const init: RequestInit = { method, headers: { 'content-type': 'application/json' } };
        if (method !== 'GET') init.body = '{}';
        const params = Promise.resolve({ slug: 'demo', id: '00000000-0000-4000-8000-000000000000' });
        const res = await (handler as Handler)(new Request(url, init), { params });
        const label = `${method} ${path} → ${res.status}`;
        if (SELF_AUTH.has(path)) expect([400, 401, 404], label).toContain(res.status);
        else expect(res.status, label).toBe(401);
        checked.push(label);
      }
    }
    expect(checked.length).toBeGreaterThanOrEqual(8);
  });
});
