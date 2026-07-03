# Veriq

## Layout
```
frontend/   Next.js (App Router, TypeScript, Tailwind) — npm
backend/    FastAPI (Python 3.12+) — health check + scaffold for future routes
.claude/    Subagents and skills used by Claude Code on this repo
```

## Frontend
```
cd frontend
npm install
npm run dev      # http://localhost:3000
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

## CI: Secret scanning

Every pull request is scanned for committed secrets by [GitGuardian](https://www.gitguardian.com/) (`.github/workflows/gitguardian.yml`). The check fails the PR if a secret is detected in the diff.

To enable it on this repo, add a repo secret with a GitGuardian API key (scope: `scan`):

1. Create/retrieve an API key from your [GitGuardian dashboard](https://dashboard.gitguardian.com/).
2. In GitHub, go to **Settings → Secrets and variables → Actions → New repository secret**.
3. Name it `GITGUARDIAN_API_KEY` and paste the key as the value.

The workflow only runs on `pull_request` (never `pull_request_target`), so the secret is never exposed to code checked out from an untrusted fork.
