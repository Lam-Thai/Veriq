# syntax=docker/dockerfile:1
#
# Multi-stage build producing a minimal, non-root Next.js standalone image.
# No secret values are ever ARG'd or ENV'd into this file — only the public
# NEXT_PUBLIC_* build-time variables (see the `builder` stage) and inert
# placeholder DB URLs needed to satisfy Prisma's config loader during
# `npm ci`/`npm run build`. Real secrets (CLERK_SECRET_KEY, DATABASE_URL,
# DIRECT_URL, ...) are supplied at container runtime via docker-compose
# `env_file`, not baked into any layer here.

# ---- deps: install dependencies (cached separately from app source) ----
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma

# `npm ci` runs the `postinstall` script (`prisma generate`), which needs
# prisma/schema.prisma (copied above) plus DATABASE_URL/DIRECT_URL to be
# *present* (Prisma 7's config loader throws if they're unset) but never
# connects — generation is schema-to-code only, so a placeholder is
# sufficient and is not a real secret.
ENV DATABASE_URL="postgresql://placeholder@localhost/build-placeholder" \
    DIRECT_URL="postgresql://placeholder@localhost/build-placeholder"

RUN npm ci

# ---- builder: type-check, lint-free production build ----
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The Prisma client generated during `npm ci` above lives under
# lib/generated, which .dockerignore deliberately excludes from the build
# context (so a stale/host-platform copy is never used) — pull the
# container-generated one back in from the `deps` stage instead.
COPY --from=deps /app/lib/generated ./lib/generated

# Next.js inlines NEXT_PUBLIC_* variables into the client bundle at build
# time, so they must be present for `next build` to produce a working
# bundle. These are *public* by design (shipped to every browser already,
# readable from page source) — unlike server-only secrets, embedding them
# here is expected and does not violate "no secrets baked into the image".
# Provide real values via `docker compose build --build-arg` /
# docker-compose.yml `build.args`, sourced from .env.local at build time.
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
ARG NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
ARG NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_REDIRECT_URL=/dashboard
ARG NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL=/dashboard
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY \
    NEXT_PUBLIC_CLERK_SIGN_IN_URL=$NEXT_PUBLIC_CLERK_SIGN_IN_URL \
    NEXT_PUBLIC_CLERK_SIGN_UP_URL=$NEXT_PUBLIC_CLERK_SIGN_UP_URL \
    NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_REDIRECT_URL=$NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_REDIRECT_URL \
    NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL=$NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL \
    DATABASE_URL="postgresql://placeholder@localhost/build-placeholder" \
    DIRECT_URL="postgresql://placeholder@localhost/build-placeholder" \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ---- runner: minimal runtime image, no build tooling or source ----
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# `.next/standalone` already contains a pruned, self-contained node_modules
# (via Next's output file tracing) plus a `server.js` entrypoint — static
# assets and public files are not included in standalone output and must be
# copied in separately.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# `wget` ships with Alpine's busybox, so no extra package is needed.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://localhost:3000/ || exit 1

CMD ["node", "server.js"]
