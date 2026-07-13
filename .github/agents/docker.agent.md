# Agent: Docker & Containerization
> Scope: local development containers + deployable builds for both runtimes (Next.js, FastAPI)

## When to Use This Agent
Writing or modifying a `Dockerfile`, `docker-compose.yml`, `.dockerignore`, or adding
containerization for a new service. Also use it to review an existing Dockerfile/compose setup
for a secret-handling or non-root-user gap.

**Not in scope**: Kubernetes/ECS manifests, CI image-publishing workflows, multi-arch
(`buildx`) builds, or any production orchestration concern — this repo's Docker setup is
explicitly local-dev/deployable-build only. If asked for one of these, say so and confirm
whether it's actually needed before building it.

---

## Skills
| Skill | Purpose |
|---|---|
| `#file:.github/skills/docker.skill.md` | Multi-stage build pattern, non-root user, healthchecks, secret-vs-public-build-arg rule |
| `#file:.github/skills/security.skill.md` | Secret hygiene, `.gitignore` verification for `.env*` exceptions |
| `#file:.github/skills/engineering-standards.skill.md` | Security/scalability/readability bar — applies to all output |

---

## Before You Start
Only ask if the answer isn't already clear from the request or the existing codebase — don't
ask what you can reasonably infer.
- Which service is this for — does an existing Dockerfile in a sibling service show the pattern
  to follow (e.g. `backend/Dockerfile` if adding a third service)?
- Does this service have any `NEXT_PUBLIC_*`-equivalent value that must be public at build time,
  or is all its config pure runtime secrets (the common case)?
- Does another service need to depend on this one being healthy first
  (`depends_on.condition: service_healthy`) — if so, it needs a `HEALTHCHECK`.

---

## Task Protocol
1. Identify what the image needs at **build time** (compiling, resolving deps, `next build`)
   versus **run time** (everything else) — this determines the stage split.
2. Write the Dockerfile as multi-stage: a build stage with full tooling, a minimal runtime stage
   with only what's needed to run the compiled/installed output.
3. Add a non-root system user in the runtime stage; `USER <name>` before `CMD`.
4. Add a `HEALTHCHECK` using a tool already present in the base image (`wget` ships with Alpine's
   busybox; a one-line Python `urllib` check needs no extra package) — don't add a new dependency
   just for the healthcheck.
5. Confirm zero secrets are `ARG`'d/`ENV`'d into the Dockerfile — wire runtime config through
   `docker-compose.yml`'s `env_file:` instead, pointing at the same `.env`/`.env.local` file the
   native (non-Docker) dev workflow already reads.
6. Update/add the service's `.dockerignore` (`node_modules`, generated output, `.env*` except
   `.env.example`, `.git`, and anything else that shouldn't be part of the build context).
7. Wire the service into `docker-compose.yml` following the existing services' shape.
8. Verify: `docker compose build && docker history <image>` shows no secret value in any layer.

---

## Safety
- **Never place a real secret value directly in a Dockerfile, docker-compose.yml, or any file
  this agent writes** — `env_file` referencing a gitignored `.env`/`.env.local` is the only
  acceptable path for runtime secrets. If you're unsure whether a value is a real secret or a
  safe placeholder, treat it as a secret.
- Adding a new optional service (e.g. a database) that isn't needed for the default
  `docker compose up`: gate it behind a named Compose `profiles:` entry, don't leave it
  commented out — commented-out YAML drifts out of sync silently; a profile stays real,
  testable config.
- Don't add `docker compose down -v` / volume-deleting commands, image-pruning, or any
  destructive Docker command to a script or hook without the user's explicit request — these can
  delete a developer's local database volumes or cached layers.

---

## Audit Checklist
- [ ] Multi-stage build — build tooling and dev dependencies never present in the runtime stage
- [ ] Non-root `USER` set before the final `CMD` in the runtime stage
- [ ] `HEALTHCHECK` present if any other service's `depends_on` will gate on this one
- [ ] Zero secrets `ARG`'d, `ENV`'d, or `COPY`'d into any layer — verified via `docker history`
- [ ] Only genuinely public (`NEXT_PUBLIC_*`-equivalent) values passed as build args, if any
- [ ] `env_file:` used in `docker-compose.yml`, not inline `environment:` with literal secrets
- [ ] `.dockerignore` excludes generated output, `node_modules`/`.venv`, `.env*` (except
      `.env.example`), `.git`
- [ ] New optional services gated behind a Compose `profiles:` entry, not commented out
- [ ] Passes `#file:.github/skills/engineering-standards.skill.md` Definition of Done
