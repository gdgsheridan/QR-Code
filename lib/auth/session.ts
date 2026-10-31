import 'server-only';
import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { env } from '@/lib/env';

export interface SessionUser {
  id: string;
  email: string | null;
}

// Handlers take this as a dependency so tests can authenticate with a real, verified JWT.
export type Authenticate = (request: Request) => Promise<SessionUser | null>;

// Reads the Supabase session from the request's own Cookie header (so it works in any handler), and
// verifies it with the auth server via getUser() rather than trusting the cookie's contents.
export const cookieAuthenticator: Authenticate = async (request) => {
  const jar = parseCookieHeader(request.headers.get('cookie') ?? '');
  if (!jar.some((c) => c.name.startsWith('sb-'))) return null;
  const supabase = createServerClient(env().NEXT_PUBLIC_SUPABASE_URL, env().NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => jar.map((c) => ({ name: c.name, value: c.value ?? '' })),
      setAll: () => undefined, // refreshed cookies are written by proxy.ts, not by API routes
    },
  });
  const { data } = await supabase.auth.getUser();
  return data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
};

// For server components, server actions and route handlers that may set cookies (auth callback).
export async function supabaseForRequest() {
  const store = await cookies();
  return createServerClient(env().NEXT_PUBLIC_SUPABASE_URL, env().NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) store.set(name, value, options);
        } catch {
          // Server components can't set cookies; proxy.ts refreshes them instead.
        }
      },
    },
  });
}

// v0.11.25: once per request (React cache): the layout, page and server action all ask, and each getUser()
// is a round trip to the auth server.
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const { data } = await (await supabaseForRequest()).auth.getUser();
  return data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
});
