# Veriq

**Income verification for gig workers.** Veriq lets someone who earns money across Uber, DoorDash, Airbnb, Upwork, Stripe, PayPal, etc. connect those accounts and get back one lender-ready report that proves how much they actually make — the same kind of proof-of-income a landlord, mortgage broker, or lender would normally want a pay stub for.


---

## For reviewers: the workflow this repo demonstrates

> **What it does:** Every time code is written in this repo, it passes through a pipeline of specialized AI agents instead of one generic assistant. A router picks the right specialist (e.g. "auth," "database," "security-audit") based on what's being built, that specialist follows a shared rulebook of "skills" (security rules, API contracts, coding conventions), and a final security/quality agent gates the work before it merges — backed by automated CI checks (secret scanning, static analysis, end-to-end tests) and a pre-push hook that blocks broken code from ever leaving a laptop. It's the same "specialist agent + shared tools + handoff docs" pattern the job description asks for (n8n/LangGraph-style pipelines), just applied to software development instead of business-ops automation.
>
> **Who uses it:** Me, as a solo developer building Veriq. It plays the role a small engineering team would normally play — one "agent" reviews security, another writes tests, another enforces design consistency — so a single person can ship at a team's quality bar. It's written to be portable: a future engineer (or a non-technical teammate at RealEstateTaxTips.ca) could hand this same `.claude/` + `.github/` setup to a different codebase and get the same guardrails.
>
> **One thing that broke:** Early on, the "Connect" button for linking a platform (e.g. "Connect Stripe") just flipped its own label to "Connected" the instant it was clicked — it never actually checked that the person had logged into anything. Cosmetically it worked; functionally it was a lie the product was telling its own user. Rebuilding it properly (real redirect → consent screen → callback → *then* mark connected) surfaced a second failure: my first pass at the callback endpoint didn't verify the request actually came from the login step it claimed to belong to, which is a textbook CSRF hole. The security-review step in the workflow (the `security-audit` agent, plus an automated CodeRabbit pass on the PR) is what caught it — not manual testing — which is exactly why the workflow exists: to catch the class of mistake a solo builder moving fast will make and not notice. See [issue #3](https://github.com/Lam-Thai/Veriq/issues/3) and the fix in [PR #4](https://github.com/Lam-Thai/Veriq/pull/4).

---

## Tech stack

**Plain-English key:** 🟢 *Live* — built, running, and tested in this repo today. 🟡 *Planned* — designed and ticketed, not built yet.

| Layer | Tool | Status | What it's for |
|---|---|---|---|
| Frontend | [Next.js](https://nextjs.org/) (App Router) + TypeScript | 🟢 Live | The website itself — pages, routing |
| Frontend | [Tailwind CSS](https://tailwindcss.com/) | 🟢 Live | Styling / design system |
| Backend | [FastAPI](https://fastapi.tiangolo.com/) (Python 3.12+) | 🟢 Live | API service for heavier work (file parsing, data processing) that doesn't belong in the website layer |
| Testing | [Playwright](https://playwright.dev/) | 🟢 Live | Automated end-to-end tests — simulates a real user clicking through the site |
| Testing | pytest, ruff, mypy | 🟢 Live | Backend tests, linting, and type-checking |
| CI/CD | GitHub Actions + [Husky](https://typicode.github.io/husky/) pre-push hook | 🟢 Live | Runs tests/checks automatically on every push and pull request |
| Security | [GitGuardian](https://www.gitguardian.com/) secret scanning | 🟢 Live | Blocks a PR if an API key or password is accidentally committed |
| Security | [CodeQL](https://codeql.github.com/) static analysis | 🟢 Live | Scans code for known vulnerability patterns on every PR |
| Payments | **[Stripe](https://stripe.com/) Checkout** | 🟢 Live | Public `/pricing` page, Checkout Session creation, signature-verified webhook syncing subscription status — [issue #1](https://github.com/Lam-Thai/Veriq/issues/1) |
| Auth | **[Clerk](https://clerk.com/)** | 🟢 Live | Sign-in/sign-up pages and account/route protection — [issue #2](https://github.com/Lam-Thai/Veriq/issues/2) |

---

## The agentic workflow, explained simply

Think of it like a small studio of specialists instead of one generalist doing everything:

1. **A request comes in** — e.g. "build the login page."
2. **A router hands it to the right specialist.** There's an agent for authentication, one for database work, one for building UI, one for AI features, one that only writes tests, one whose only job is to hunt for security bugs, and one that drafts well-structured GitHub issues.
3. **Every specialist reads from the same shared rulebook** ("skills") — so the auth agent and the database agent agree on the same API response format, the same error-handling style, the same security baseline, even though they never talk to each other directly.
4. **Nothing ships without a gate.** A security/quality agent reviews the diff, an automated bot (CodeRabbit) reviews the pull request, GitHub Actions runs the test suite and scans for leaked secrets, and a pre-push hook refuses to let broken code leave the machine in the first place.

This exists in **two parallel, identical copies** — one for [Claude Code](https://claude.com/claude-code) (`.claude/`) and one for [GitHub Copilot](https://github.com/features/copilot) (`.github/`) — so the same guardrails apply no matter which AI tool is doing the writing.

### The specialists ("agents")

| Agent | What it's responsible for | Claude Code | Copilot |
|---|---|:---:|:---:|
| `auth` | Login, sessions, route protection, permissions | ✅ | ✅ |
| `api-route` | Standard create/read/update/delete endpoints on the website | ✅ | ✅ |
| `fastapi-route` | Heavier backend work: file parsing, uploads, long-running jobs | ✅ | ✅ |
| `database` | Table design, queries, keeping the two databases in sync | ✅ | ✅ |
| `migration` | Safely changing the database schema without breaking production | ✅ | ✅ |
| `ui-component` | Building web pages/components that look and behave consistently | ✅ | ✅ |
| `ai-feature` | Any feature that calls an LLM (chat, extraction, summarization) | ✅ | ✅ |
| `payments` | Stripe Checkout, webhooks, subscription/billing status | ✅ | ✅ |
| `docker` | Dockerfiles, docker-compose, containerizing a service | ✅ | ✅ |
| `testing` | Writing unit, integration, and end-to-end tests | ✅ | ✅ |
| `security-audit` | Final security review before anything touching auth/payments/user data ships | ✅ | ✅ |
| `code-review` | General "is this good enough to merge" review | ✅ | ✅ |
| `github-issue` | Drafts well-structured GitHub issues (goal/scope/acceptance criteria) | ✅ | — |

### The shared rulebook ("skills")

Skills aren't code — they're the *standards* every agent is required to follow, so ten different agents don't invent ten different conventions.

| Skill | What it standardizes |
|---|---|
| `engineering-standards` | The non-negotiable quality bar every agent checks its own work against before calling anything "done" |
| `security` | Input validation, safe cookies, rate limiting, file-upload safety, and hardening for CI/CD itself |
| `api-contracts` | One consistent shape for every API response and error, across both the website and the backend |
| `error-handling` | How failures are caught, logged, and surfaced — never silently swallowed |
| `design-system` | Spacing, color, typography, and accessibility rules so the UI looks like one product |
| `nextjs` | Conventions for the website framework (routing, caching, data-fetching) |
| `typescript` / `python` | Language-level conventions and strict type-checking rules |
| `prisma` / `sqlalchemy` / `postgresql` | Database schema and query conventions, kept identical across both backends |
| `ai-integration` | Rules for safely calling Claude/LLMs — prompt handling, structured output, input sanitization |
| `payments` | Stripe Checkout/webhook conventions — server-resolved price IDs, signature verification, double-billing prevention |
| `docker` | Multi-stage builds, non-root users, healthchecks, secret-vs-public-build-arg rules |
| `github-issues` | Template and safety rules for filing issues via the GitHub CLI (Claude Code only) |

Full mapping of which agents rely on which skills lives in [.claude/README.md](.claude/README.md).

---

## Where new work goes: Next.js vs. FastAPI

**Default to Next.js API routes** for anything session-gated, CRUD-shaped, or tightly coupled to
the frontend — that's nearly everything today (Stripe checkout, the connect flow, dashboard
data). This also covers heavy work that depends on a **Node-only library with no Python
equivalent** (e.g. `@react-pdf/renderer`, which has no FastAPI port without rewriting the report
template) — but once that work is genuinely CPU/latency-heavy, it must run through an async job
pattern (see `app/api/report/route.tsx` / `app/api/report/[jobId]/route.ts`: create a job row,
do the work in `after()` so it never blocks the request/response, poll for the result) — never
synchronously inside the request handler.

**Default to FastAPI** for CPU/latency-heavy work that's Python-native or file/data-processing
heavy: file parsing (PDF/CSV/image), embeddings/vector search, RAG pipelines, document ingestion,
batch inference, heavy aggregation — see `.claude/agents/fastapi-route.md`'s routing table, which
this defers to. Calls from Next.js authenticate with a short-lived service-token JWT
(`lib/service-token.ts` → FastAPI's `verify_service_token`/`get_current_user_id` in
`backend/app/auth.py`), never talking to Clerk directly.

As of this writing, no feature actually needs FastAPI for real production traffic yet — the
service-token auth, rate limiting, structured logging, and Sentry wiring exist so the next
genuinely heavy, Python-appropriate feature has a validated home instead of reflexively landing
in another Next.js API route.

## Repo layout

```
frontend/           Next.js (App Router, TypeScript, Tailwind) — npm
backend/            FastAPI (Python 3.12+) — health check + scaffold for future routes
docker-compose.yml  Runs frontend + backend together in containers — see "Docker" below
.husky/             Git hooks (pre-push test gate), versioned in the repo
.claude/            Agents & skills used by Claude Code on this repo
.github/            Agents, skills, and CI workflows used by GitHub Copilot / Actions
```

## Frontend

```
cd frontend
npm install
cp .env.example .env.local   # fill in Clerk API keys — see frontend/README.md
npm run dev      # http://localhost:3000

npx playwright install --with-deps chromium   # first time only
npm run test:e2e     # run the Playwright e2e suite headlessly
npm run test:e2e:ui  # run it in the interactive UI mode
```

## Backend

```
cd backend
python -m venv .venv
.venv/Scripts/activate    # .venv/bin/activate on macOS/Linux
pip install -e ".[dev]"
cp .env.example .env
uvicorn app.main:app --reload --port 8000   # http://localhost:8000/health

ruff check .
mypy app
pytest -q
```

## Docker: running the full stack

The frontend and backend can also be run as containers via a single `docker compose up`, without touching the native `npm run dev` / `.venv` workflows above — both continue to work unchanged. This is for local development and deployable builds only; it does not cover production orchestration (Kubernetes/ECS), CI image publishing, or multi-arch builds.

```
cp backend/.env.example backend/.env         # same file uvicorn reads natively
cp frontend/.env.example frontend/.env.local  # same file `next dev`/`next build` read natively
cp .env.example .env                          # NEXT_PUBLIC_* build args only, see below

docker compose up --build
# frontend → http://localhost:3000
# backend  → http://localhost:8000/health
```

**How configuration flows in:** `docker-compose.yml` sources runtime configuration for both services from `backend/.env` and `frontend/.env.local` via `env_file` — the exact same files the native workflows already use. Nothing is hardcoded into `frontend/Dockerfile` or `backend/Dockerfile`, and neither file is copied into an image; they're mounted in as environment variables when each container starts.

The one exception is `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (and the related `NEXT_PUBLIC_CLERK_*_URL` values): Next.js inlines `NEXT_PUBLIC_*` variables into the client JavaScript bundle at build time — this is standard Next.js behavior for any app, not specific to this one — so they must be available when the image is *built*, not just when the container starts. They're passed as Docker build args (`docker-compose.yml` → `frontend.build.args`, sourced from the root `.env` file created above) rather than baked into `frontend/Dockerfile` as literal values. These particular keys are *publishable*/public by design (already shipped to every visitor's browser in plain text) — unlike `CLERK_SECRET_KEY` or database URLs, embedding them at build time isn't a secret-handling concern.

**Verifying no secrets leak into an image:**

```
docker compose build
docker history veriq-frontend:local
docker history veriq-backend:local
```

Neither should show `CLERK_SECRET_KEY`, `DATABASE_URL`, `ALLOWED_ORIGINS`, or any other value from `.env`/`.env.local` — only the public Clerk build args described above.

**Verifying the frontend can reach the backend over the compose network:**

```
docker compose exec frontend wget -qO- http://backend:8000/health
```

Both services join the default compose network and resolve each other by service name (`backend`, `frontend`); `backend:8000` is only reachable from inside that network; the host-published `localhost:8000`/`localhost:3000` ports are for your browser/tools, not how the containers talk to each other.

A commented-out `postgres` service is included in `docker-compose.yml`, gated behind a `postgres` Compose profile so it never starts on a plain `docker compose up`. It's a placeholder for the currently-paused Prisma/PostgreSQL persistence effort and isn't required for anything in this section. Its credentials come from `postgres.env` (`cp postgres.env.example postgres.env`, then fill in your own values), the same `env_file` pattern as the frontend/backend services above — kept out of `docker-compose.yml` itself and out of git, so no password of any kind (real or throwaway) is ever committed to the repo.

## Git hooks: pre-push test gate

A [Husky](https://typicode.github.io/husky/) `pre-push` hook (`.husky/pre-push`) runs the test suite before any push leaves your machine, so failures are caught locally instead of on the remote:

1. Backend `pytest` (via `backend/.venv` if present, falling back to `python` on `PATH`).
2. Frontend `npm run lint` and `npm run build` (a frontend unit-test runner will be added to this step once one exists).

If any check fails, the hook exits non-zero and **blocks the push**. The hook only invokes locally installed, version-controlled tooling — it never downloads or executes remote scripts.

The hook is installed automatically the first time you run `npm install` in `frontend/` (via the `prepare` script), which points Git's `core.hooksPath` at the repo-root `.husky/` directory.

To run the same checks manually at any time:

```sh
sh .husky/pre-push
```

To skip the hook for a single push (use sparingly, e.g. for a docs-only change already verified by CI):

```sh
git push --no-verify
```

## CI: Secret scanning

Every pull request is scanned for committed secrets by [GitGuardian](https://www.gitguardian.com/) (`.github/workflows/gitguardian.yml`). The check fails the PR if a secret is detected in the diff.

To enable it on this repo, add a repo secret with a GitGuardian API key (scope: `scan`):

1. Create/retrieve an API key from your [GitGuardian dashboard](https://dashboard.gitguardian.com/).
2. In GitHub, go to **Settings → Secrets and variables → Actions → New repository secret**.
3. Name it `GITGUARDIAN_API_KEY` and paste the key as the value.

The workflow only runs on `pull_request` (never `pull_request_target`), so the secret is never exposed to code checked out from an untrusted fork.

## CI: End-to-end tests

Every pull request runs the Playwright e2e suite (`.github/workflows/playwright.yml`) against a production build of the frontend. The workflow installs dependencies and Chromium reproducibly (`npm ci`, `npx playwright install --with-deps chromium`), builds the app (`npm run build`), then runs `npm run test:e2e`. The HTML report is uploaded as a build artifact on every run except when the job is cancelled, so both passing and failing runs can be inspected.

Tests live under `frontend/e2e/` and are configured in `frontend/playwright.config.ts`. Add new smoke/e2e specs there as coverage grows.

**Required secrets:** the frontend is wrapped in Clerk's `ClerkProvider`/`clerkMiddleware`, which throw on every request in production mode (`next start`, used by this workflow) unless given real API keys — Clerk's zero-config "keyless mode" only works in local `next dev`. Without these secrets, the workflow fails on every PR:

1. Create a free Clerk application (or reuse an existing test instance) at the [Clerk dashboard](https://dashboard.clerk.com).
2. In GitHub, go to **Settings → Secrets and variables → Actions → New repository secret**.
3. Add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (the `pk_test_...` value) and `CLERK_SECRET_KEY` (the `sk_test_...` value) — names must match exactly, since the workflow reads them by name.

Use test-mode keys only — never a production Clerk instance's keys — since this workflow runs on every pull request, including from anyone with write access to the repo.
