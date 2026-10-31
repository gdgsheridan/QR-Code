import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { contentSecurityPolicy } from './lib/domain/security-headers';

// Next.js 16 "proxy" (formerly middleware). Refreshes the Supabase session cookie on staff pages and
// sends signed-out visitors to /login with a way back. Authorization is NOT done here: every route
// handler checks the session and requireStaff() itself.
export async function proxy(request: NextRequest) {
  // L10: fresh CSPRNG nonce per request. Next 16 reads it from the request's `x-nonce` header to
  // stamp its inline bootstrap scripts on dynamically rendered HTML, and enforces it via the
  // response CSP (`'nonce-…'` + `'strict-dynamic'`). Matcher covers dynamic routes only: static
  // prerendered pages have no per-request nonce, so a nonce CSP would block their scripts.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = contentSecurityPolicy({
    production: process.env.NODE_ENV === 'production',
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
    nonce,
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  const withCsp = (response: NextResponse) => {
    response.headers.set('Content-Security-Policy', csp);
    return response;
  };

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '', {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet, headers) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        // Recreated from the nonce-carrying headers: a plain `{ request }` here would drop x-nonce
        // and Next would render unstamped scripts that the CSP below blocks.
        response = NextResponse.next({ request: { headers: requestHeaders } });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });
  const { data } = await supabase.auth.getUser();

  // Badge profiles are public (SPEC §6.5, v0.9): the session is still refreshed there, so the holder tapping
  // their own badge is recognized, but nobody is sent to sign in.
  if (!data.user && !request.nextUrl.pathname.startsWith('/profile/')) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login);
  }
  return withCsp(response);
}

export const config = {
  // /profile: session refresh only (above). /me: the hacker menu and its pages (F14, v0.6.1). `/me/:path*` also
  // matches /me itself.
  matcher: ['/scan/:path*', '/admin/:path*', '/profile/:path*', '/me/:path*'],
};
