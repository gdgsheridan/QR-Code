# L16/A13: multi-stage production image for Coolify (Dockerfile build pack).
# deps -> build -> runtime. The runtime stage ships only the Next standalone
# server (no node_modules, devDependencies, tests, or .git).
#
# Base image is pinned to an exact Node 24 tag (24.22.2 = latest 24.x on
# Docker Hub as of 2026-10-31; bookworm variant to match the original).
# A sha256 digest pin would be stronger but cannot be verified without a
# Docker daemon here, so it is deliberately left as an exact tag.

# ---- deps: full install (devDependencies needed to build) ----
FROM node:24.22.2-bookworm-slim AS deps
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---- build: compile the app + self-hosted zxing wasm ----
FROM node:24.22.2-bookworm-slim AS build
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Public values only: inlined into the client bundle, and the Supabase URL into the CSP header
# (next.config.ts). Server secrets (service-role key, Resend key) are runtime env, never build args.
ARG NEXT_PUBLIC_APP_ORIGIN
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_APP_ORIGIN=$NEXT_PUBLIC_APP_ORIGIN \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
# prebuild copies public/zxing/zxing_reader.wasm from node_modules (gitignored, see .dockerignore)
RUN pnpm build

# ---- runtime: standalone server as non-root, no build tools or source ----
FROM node:24.22.2-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000 NEXT_TELEMETRY_DISABLED=1
# standalone output bundles traced deps; public/ + .next/static are served by
# server.js when present (see Next docs for `output: 'standalone'`)
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
