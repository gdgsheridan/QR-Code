import type { NextConfig } from 'next';
import { securityHeaders } from './lib/domain/security-headers';

// Local dev only: the stable tunnel host (e.g. "brownsons-macbook-air.tail1234.ts.net") so a phone can
// load pages like /p#… through it. Next 16 blocks dev assets requested from unlisted hosts. A full URL
// is accepted too. Ignored by production builds. See README "A tunnel URL that never changes".
function devPublicHosts(): string[] {
  const raw = process.env.DEV_PUBLIC_HOST?.trim();
  if (!raw) return [];
  return [raw.includes('://') ? new URL(raw).hostname : raw];
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // L16: minimal runtime image — build emits .next/standalone (no node_modules
  // needed at runtime). public/ and .next/static are copied manually in the Dockerfile.
  output: 'standalone',
  allowedDevOrigins: devPublicHosts(),
  poweredByHeader: false,
  // forbidden() in the admin layout returns a real 403 (T-ADM-01). Experimental in Next 16.
  experimental: { authInterrupts: true },
  // T-SEC-06: every response gets these static headers, including a nonce-less CSP fallback. Proxy
  // routes (all dynamic) additionally get a per-request nonce CSP from proxy.ts; browsers intersect
  // multiple CSP headers, so those pages get the stricter policy while prerendered pages and /api/*
  // keep the static one instead of losing CSP entirely.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders({
          production: process.env.NODE_ENV === 'production',
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
        }),
      },
    ];
  },
};

export default nextConfig;
