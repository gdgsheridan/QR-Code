import { NextResponse } from 'next/server';
import { supabaseForRequest } from '@/lib/auth/session';
import { route } from '@/lib/http/route';

// Logout changes state, so a cross-site POST must not reach signOut: the browser would still send
// the cookies even though the attacker can't read the response. Same-origin form posts (which send
// Origin + sec-fetch-site) and headerless non-browser clients still pass.
export function isSameOriginPost(request: Request): boolean {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite === 'same-origin' || fetchSite === 'none') return true;
  if (fetchSite) return false;
  const origin = request.headers.get('origin') ?? request.headers.get('referer');
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export const POST = route(async (request) => {
  if (!isSameOriginPost(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  await (await supabaseForRequest()).auth.signOut();
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
});
