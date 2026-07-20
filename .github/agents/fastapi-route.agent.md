# Agent: FastAPI Route Builder
> Runtime: FastAPI · Python

## When to Use This Agent
Routes that belong in FastAPI — not in Next.js API routes:

| Task | Why FastAPI |
|---|---|
| File parsing (PDF, CSV, images) | CPU-bound — offload from Next.js |
| Embedding generation / vector search | ML libs live here |
| RAG pipelines, multi-step chains | Long-running, async-native |
| Document ingestion and chunking | Memory-intensive processing |
| Batch inference / async processing | Background task dispatch |
| Data aggregation over large datasets | Heavy DB queries, avoid blocking UI |
| Long-running computation (>500ms) — Python-portable | Don't block Next.js event loop |

**Exception**: if the heavy work depends on a **Node-only library with no Python port** (e.g.
`@react-pdf/renderer` — there's no FastAPI equivalent without rewriting the whole thing in a
different library/language, which is its own scope creep, not a genuine port), it can't move
here even past the 500ms bar. It stays in Next.js behind the `after()`-based async job pattern
instead — see `#file:.github/skills/nextjs.skill.md` and `app/api/report/route.tsx` for the real
reference. Don't assume ">500ms" alone always means "move it to FastAPI" — confirm the work is
actually portable first.

**Use `api-route.agent.md` instead** for standard CRUD that is session-gated and tightly coupled to the frontend.

---

## Ground Truth (verified against real code in this repo — not aspirational)
Every skeleton in this doc below has a real, working counterpart already in `backend/` — extend
these, don't recreate them from scratch:
- **Auth**: `app/auth.py` — `verify_service_token` / `get_current_user_id`, exactly the shape in
  "Service Token Verification" below.
- **Rate limiting**: `app/core/rate_limit.py` — `limiter` (slowapi) + `rate_limit_key` (decodes
  the caller's verified JWT `sub`, falls back to `get_remote_address` only when no/invalid token
  is present) + `rate_limit_exceeded_handler` (returns this repo's `{ error: {...} }` envelope,
  not slowapi's default body). Wired once in `main.py` (`app.state.limiter`, exception handler,
  `SlowAPIMiddleware`); apply `@limiter.limit("N/period")` per route. See
  `#file:.github/skills/security.skill.md`.
- **Structured logging + correlation id**: `app/core/logging.py` (structlog, already configured)
  + `app/core/middleware.py`'s `request_context_middleware` (binds `X-Request-Id` via
  `structlog.contextvars`, logs one `request.completed`/`request.failed` line per request). Wired
  once in `main.py`. See `#file:.github/skills/error-handling.skill.md`.
- **Sentry**: guarded on `settings.SENTRY_DSN` in `main.py` — `sentry_sdk.init(...)` with
  `StarletteIntegration()` + `FastApiIntegration()`. Unhandled exceptions are captured
  automatically; don't add manual `capture_exception` calls per route.
- **Real example route**: `app/api/debug.py`'s `POST /debug/sentry-test` — auth-gated, rate-limited,
  environment-gated (404 outside non-production) — is a complete, working small route using all
  four of the above together. Copy its shape for the next protected route rather than assembling
  the pieces from memory.

---

## Skills
| Skill | Purpose |
|---|---|
| `#file:.github/skills/python.skill.md` | Types, async patterns, error handling |
| `#file:.github/skills/sqlalchemy.skill.md` | Async ORM queries, session management |
| `#file:.github/skills/api-contracts.skill.md` | Response envelope, status codes — same shape as Next.js |
| `#file:.github/skills/security.skill.md` | Service token verification, rate limiting, CORS |
| `#file:.github/skills/error-handling.skill.md` | Exception hierarchy, structured logging |
| `#file:.github/skills/postgresql.skill.md` | Query patterns, indexes, pagination |
| `#file:.github/skills/engineering-standards.skill.md` | Security/scalability/readability bar — applies to all output |

---

## Before You Start
Only ask if the answer isn't already clear from the request or the existing codebase — don't
ask what you can reasonably infer.
- Confirmed this belongs in FastAPI, not Next.js? (see decision table above)
- Synchronous response, or background job returning `202`?
- File involved — what types are accepted and what's the max size?

---

## Task Protocol
1. Confirm the task belongs in FastAPI (see table above — if unclear, use Next.js).
2. Define the Pydantic request/response schemas before writing any route code.
3. Implement `verify_service_token` dependency — auth is never optional.
4. Write the route following the skeleton below.
5. Run the audit checklist.

---

## Directory Layout
```
app/
  routers/
    invoices.py       ← resource router
    ai_pipeline.py    ← AI processing routes
    files.py          ← file upload/parsing routes
  schemas/
    invoice.py        ← Pydantic request + response models
    common.py          ← DataResponse, ErrorResponse envelopes
  services/
    invoice.py        ← business logic (no FastAPI imports here)
  models/
    invoice.py        ← SQLAlchemy ORM models
  deps.py             ← shared FastAPI dependencies
  auth.py             ← service token verification
  main.py             ← app factory, router registration, middleware
```

---

## App Factory

```python
# app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import invoices, ai_pipeline, files
from app.core.config import settings

def create_app() -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None)  # disable docs in prod

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.NEXT_PUBLIC_URL],  # never "*"
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    app.include_router(invoices.router, prefix="/invoices")
    app.include_router(ai_pipeline.router, prefix="/ai")
    app.include_router(files.router, prefix="/files")

    return app

app = create_app()
```

---

## Service Token Verification

```python
# app/auth.py (already exists — this is what it looks like)
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from app.core.config import settings

bearer = HTTPBearer()

async def verify_service_token(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
) -> dict:
    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.INTERNAL_JWT_SECRET,
            algorithms=["HS256"],
        )
        if not payload.get("sub"):
            raise HTTPException(status_code=401, detail="Invalid token")
        return payload
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

# Reusable dep — extracts user_id from verified token
async def get_current_user_id(
    token: dict = Depends(verify_service_token),
) -> str:
    return token["sub"]
```

---

## Implementation Skeleton

```python
# app/routers/invoices.py
from fastapi import APIRouter, Depends, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth import get_current_user_id
from app.db import get_session
from app.schemas.invoice import CreateInvoiceRequest, InvoiceResponse
from app.schemas.common import DataResponse
from app.services.invoice import InvoiceService
from app.core.errors import NotFoundError

router = APIRouter(tags=["invoices"])


@router.get("/{invoice_id}", response_model=DataResponse[InvoiceResponse])
async def get_invoice(
    invoice_id: str,
    user_id: str = Depends(get_current_user_id),   # auth first — always
    db: AsyncSession = Depends(get_session),
) -> DataResponse[InvoiceResponse]:
    invoice = await InvoiceService(db).get(invoice_id, user_id)
    return DataResponse(data=InvoiceResponse.model_validate(invoice))


@router.post("/", response_model=DataResponse[InvoiceResponse], status_code=201)
async def create_invoice(
    body: CreateInvoiceRequest,                     # Pydantic validates automatically
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_session),
) -> DataResponse[InvoiceResponse]:
    invoice = await InvoiceService(db).create(body, user_id)
    return DataResponse(data=InvoiceResponse.model_validate(invoice))


@router.delete("/{invoice_id}", status_code=204)
async def delete_invoice(
    invoice_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_session),
) -> None:
    await InvoiceService(db).soft_delete(invoice_id, user_id)
```

---

## Background Task Pattern

For long-running work — return `202` immediately, process async.

```python
@router.post("/embed", response_model=DataResponse[EmbedResponse], status_code=202)
async def embed_document(
    body: EmbedRequest,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_session),
) -> DataResponse[EmbedResponse]:
    background_tasks.add_task(generate_embeddings, body.document_id, user_id, db)
    return DataResponse(data=EmbedResponse(status="queued", document_id=body.document_id))
```

---

## File Upload Pattern

```python
from fastapi import UploadFile, File
import magic  # python-magic — validate by bytes, not content-type header

ALLOWED_TYPES = {"application/pdf", "text/csv"}
MAX_SIZE_BYTES = 10 * 1024 * 1024  # 10MB

@router.post("/upload", response_model=DataResponse[FileResponse], status_code=201)
async def upload_file(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
) -> DataResponse[FileResponse]:
    content = await file.read()

    if len(content) > MAX_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="File too large")

    mime = magic.from_buffer(content, mime=True)
    if mime not in ALLOWED_TYPES:
        raise HTTPException(status_code=422, detail="Unsupported file type")

    # derive storage key from hash — never use file.filename directly
    key = hashlib.sha256(content).hexdigest()
    ...
```

---

## Common Response Schemas

```python
# app/schemas/common.py
from pydantic import BaseModel
from typing import Generic, TypeVar

T = TypeVar("T")

class DataResponse(BaseModel, Generic[T]):
    data: T

class PaginationMeta(BaseModel):
    page: int
    per_page: int
    total: int
    total_pages: int

class PaginatedResponse(BaseModel, Generic[T]):
    data: list[T]
    meta: PaginationMeta

class ErrorDetail(BaseModel):
    code: str
    message: str
    fields: dict[str, list[str]] | None = None

class ErrorResponse(BaseModel):
    error: ErrorDetail
```

---

## Non-Negotiable Rules
- `verify_service_token` / `get_current_user_id` on every route — no exceptions.
- Never accept `user_id` from the request body — only from the verified token.
- All DB queries scoped to `user_id` — never bare ID lookups.
- Return `404` for ownership failures — never `403`.
- File uploads: validate magic bytes, not `content-type` header.
- `202` for background jobs — never block the HTTP response on long work.
- Response envelope always `{ data: T }` or `{ error: { code, message } }` — matches Next.js.
- CORS `allow_origins` is an explicit list — never `"*"`.

## Audit Checklist
- [ ] `get_current_user_id` dep on every route
- [ ] No `user_id` accepted from request body
- [ ] All DB queries scoped to `user_id`
- [ ] `404` for ownership failures (not `403`)
- [ ] Pydantic schemas defined for all request/response shapes
- [ ] File uploads: size limit + magic bytes check
- [ ] Background jobs return `202` immediately
- [ ] Response matches `{ data }` / `{ error }` envelope
- [ ] CORS explicit origins — no wildcard
- [ ] No secrets in logs — PII stripped from structlog output
- [ ] Passes `engineering-standards.skill.md` Definition of Done
