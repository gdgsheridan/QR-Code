// SPEC T-SEC-06. Pure: the caller says whether this is production and where Supabase lives.
//
// Nonce CSP (L10): Next 16 only stamps a nonce onto dynamically rendered HTML, reading it from
// the request's CSP header (set by proxy.ts). Static `headers()` in next.config.ts cannot
// see a per-request value, so every response gets this nonce-less CSP from next.config.ts and
// proxy.ts adds a stricter nonce CSP on its dynamic routes. Browsers intersect multiple CSP
// headers, so those pages get the nonce policy while prerendered pages keep a real (static) CSP.
// 'wasm-unsafe-eval' is for the self-hosted zxing decoder (public/zxing).
// style-src keeps 'unsafe-inline': Tailwind sets runtime style attributes and Next inlines its own
// styles without a nonce, so a nonce-only style-src would break rendering for no attacker gain.
// No trusted-types `require-trusted-types-for`: Next's bootstrap and React 19 assign string sinks
// during hydration, so an enforcing policy would break the app before it protects anything.
export function contentSecurityPolicy(opts: { production: boolean; supabaseUrl: string; nonce?: string }): string {
  const supabase = new URL(opts.supabaseUrl).origin;
  const script = opts.nonce
    ? `script-src 'self' 'nonce-${opts.nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${opts.production ? '' : " 'unsafe-eval'"}`
    : `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${opts.production ? '' : " 'unsafe-eval'"}`;
  return [
    "default-src 'self'",
    script,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: ${supabase}`,
    "font-src 'self'",
    `connect-src 'self' ${supabase}${opts.production ? '' : ' ws:'}`,
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(opts.production ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

// Pass `nonce` for the per-request proxy CSP; omit it for the static /api/* fallback in
// next.config.ts. next.config.ts strips the CSP for `/:path*` (proxy.ts owns it there).
export function securityHeaders(opts: { production: boolean; supabaseUrl: string; nonce?: string }): Array<{ key: string; value: string }> {
  return [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(opts) },
    { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    // No Cross-Origin-Embedder-Policy: img-src allows the Supabase storage origin, which does not
    // send matching Cross-Origin-Resource-Policy headers, so require-corp would break badge and
    // storage images. Revisit only if every cross-origin source opts in.
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
    // Tokens only ever live in the fragment, which browsers never send; this is belt and braces. Not
    // 'no-referrer': that makes a form posted before hydration carry `Origin: null`, which the
    // server-action CSRF check rejects. 'same-origin' still sends nothing to other sites.
    { key: 'Referrer-Policy', value: 'same-origin' },
    // preload: only effective once the domain is submitted to the HSTS preload list, which requires
    // every subdomain to serve https. Until then the max-age/includeSubDomains part still applies.
    ...(opts.production ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }] : []),
  ];
}
