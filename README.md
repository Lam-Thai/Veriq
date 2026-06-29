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
