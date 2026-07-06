# Veriq

## Layout
```
frontend/   Next.js (App Router, TypeScript, Tailwind) — npm
backend/    FastAPI (Python 3.12+) — health check + scaffold for future routes
.husky/     Git hooks (pre-push test gate), versioned in the repo
.claude/    Subagents and skills used by Claude Code on this repo
```

## Frontend
```
cd frontend
npm install
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
