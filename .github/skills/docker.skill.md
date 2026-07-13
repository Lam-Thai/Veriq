# Skill: Docker

> Local development and deployable-build containers only. Does not cover production
> orchestration (Kubernetes/ECS), CI image publishing, or multi-arch builds — those are
> explicitly out of scope until a real deployment target requires them.

This skill documents the real, working pattern in this repo (`frontend/Dockerfile`,
`backend/Dockerfile`, `docker-compose.yml`) — read those files for the ground truth.

---

## The One Rule Everything Else Follows
**No secret value is ever `ARG`'d or `ENV`'d into a Dockerfile, and no secret is ever copied into
an image layer.** All runtime configuration (`CLERK_SECRET_KEY`, `DATABASE_URL`,
`STRIPE_SECRET_KEY`, ...) is supplied at container *start* via `docker-compose.yml`'s
`env_file:`, reading the exact same `.env`/`.env.local` files the native (non-Docker) dev
workflow already uses — never a value baked into the image at build time.

The one narrow exception: `NEXT_PUBLIC_*` variables. Next.js inlines these into the client
JavaScript bundle at `next build` time (standard Next.js behavior, not Docker-specific), so they
genuinely must be available when the image is *built*. They're passed as Docker build args
instead — this is fine because they're *public by design*, already shipped to every visitor's
browser in plain text. A build arg is only acceptable for a value that's already public; anything
actually secret always goes through `env_file` at runtime, never `ARG`.

Verify no secret leaked into a built image:
```sh
docker compose build
docker history veriq-frontend:local   # should show only public NEXT_PUBLIC_* build args
docker history veriq-backend:local    # should show none of your .env values at all
```

---

## Multi-Stage Build Pattern (Next.js)

```dockerfile
# syntax=docker/dockerfile:1

# ---- deps: install dependencies (cached separately from app source) ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Prisma-specific: `npm ci` runs `postinstall` (`prisma generate`), which needs the schema
# present and DATABASE_URL/DIRECT_URL to be *set* (even to a placeholder) — Prisma's config
# loader throws if they're unset, but generation is schema-to-code only and never connects.
ENV DATABASE_URL="postgresql://placeholder@localhost/build-placeholder" \
    DIRECT_URL="postgresql://placeholder@localhost/build-placeholder"
RUN npm ci

# ---- builder: production build ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Only genuinely public NEXT_PUBLIC_* values as build args — see "The One Rule" above.
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY \
    DATABASE_URL="postgresql://placeholder@localhost/build-placeholder" \
    DIRECT_URL="postgresql://placeholder@localhost/build-placeholder"
RUN npm run build   # requires next.config.ts `output: "standalone"` — see below

# ---- runner: minimal runtime, no build tooling or source ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://localhost:3000/ || exit 1
CMD ["node", "server.js"]
```

Requires `output: "standalone"` in `next.config.ts` — this emits a self-contained
`.next/standalone` (pruned `node_modules` + a `server.js` entrypoint via output file tracing) so
the runtime stage never needs the full `node_modules` tree or dev dependencies. Static assets and
`public/` are **not** included in standalone output and must be copied in as a separate step.

## Multi-Stage Build Pattern (FastAPI)

```dockerfile
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

FROM base AS builder
WORKDIR /app
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY pyproject.toml ./
COPY app ./app
RUN pip install --upgrade pip && pip install .

FROM base AS runtime
WORKDIR /app
RUN addgroup --system app && adduser --system --ingroup app app
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
USER app
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=2)" || exit 1
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```
A venv copied wholesale from the builder stage into a fresh `base` image keeps compilers/build
tooling out of the runtime image entirely.

---

## Non-Negotiable Rules
- **Non-root runtime user, always** — create a dedicated system user/group and `USER <name>`
  before the final `CMD`. Never run the app as root in the runtime stage.
- **Multi-stage, always** — a `deps`/`builder` stage with build tooling, a separate minimal
  `runner`/`runtime` stage with only what's needed to run. Never ship dev dependencies or a
  compiler toolchain in the image that actually runs.
- **`HEALTHCHECK` on every service image** — `docker-compose.yml`'s
  `depends_on.<service>.condition: service_healthy` reads this; a service with no `HEALTHCHECK`
  can't gate another service's startup on it actually being ready.
- **`.dockerignore` excludes anything generated or environment-specific** — `node_modules`,
  `.next`, `.env*` (except `.env.example`), `.git`, and (Prisma-specific) any generated client
  output directory, so a stale/host-platform-built artifact is never accidentally baked in as
  build context instead of being freshly generated inside the container.
- **`env_file:` in `docker-compose.yml`, never inline `environment:` with literal secret
  values** — an inline `environment: DATABASE_URL: postgresql://user:realpassword@...` line is
  exactly the shape a secret scanner is built to catch, even for a throwaway local credential.
  Reference a gitignored `.env` file instead.
- **Placeholder build-time DB URLs are not secrets** — a value like
  `postgresql://placeholder@localhost/build-placeholder` used only to satisfy a config loader
  during dependency install/build (never actually connected to) is fine to inline in a
  Dockerfile; it carries no real credential.

---

## docker-compose.yml Conventions
```yaml
services:
  backend:
    build: { context: ./backend }
    image: veriq-backend:local
    env_file: [./backend/.env]
    ports: ["8000:8000"]
    # No healthcheck block needed here — the Dockerfile's own HEALTHCHECK is what
    # `depends_on.condition: service_healthy` reads.

  frontend:
    build:
      context: ./frontend
      args:
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: ${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:-}
    image: veriq-frontend:local
    env_file: [./frontend/.env.local]
    ports: ["3000:3000"]
    depends_on:
      backend: { condition: service_healthy }
```
Services resolve each other by service name on the default compose network
(`http://backend:8000`, not `localhost:8000`, from inside another container) — the
host-published ports are for the developer's browser/tools only.

An optional service not needed for a plain `docker compose up` (e.g. a local Postgres reserved
for a paused persistence effort) belongs behind a named `profiles:` gate
(`docker compose --profile <name> up`), not commented out with a note to "uncomment later" —
profiles keep it real, runnable config instead of stale prose.

---

## Rules
- No secret ever `ARG`'d, `ENV`'d, or `COPY`'d into an image — `env_file` at container start only.
- `NEXT_PUBLIC_*` build args are the sole exception, because they're already public by design.
- Non-root `USER` in every runtime stage.
- Multi-stage build separating build tooling from the runtime image.
- `HEALTHCHECK` on every service that another service's `depends_on` gates on.
- `.dockerignore` excludes `node_modules`, generated output, `.env*` (except `.env.example`), `.git`.
- Verify with `docker history <image>` that no `.env`/`.env.local` value appears in any layer.
