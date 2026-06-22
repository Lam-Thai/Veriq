---
name: python
description: Python conventions for the FastAPI runtime — ruff/mypy strict config, type/Pydantic/enum patterns, async rules (no blocking I/O, asyncio.gather), error handling, dependency injection, automatic blockers, and the toolbelt. Use when writing or reviewing Python/FastAPI code.
---

# Skill: Python (FastAPI Runtime)

## Config (non-negotiable)
```toml
# pyproject.toml
[tool.ruff]
target-version = "py312"
select = ["E", "F", "I", "UP", "B", "S", "ASYNC"]

[tool.mypy]
strict = true
python_version = "3.12"
```

---

## Type Patterns

### Always annotate — no untyped params
```python
# WRONG
async def get_invoice(invoice_id, user_id):
    ...

# RIGHT
async def get_invoice(invoice_id: str, user_id: str) -> InvoiceResponse:
    ...
```

### Pydantic for all I/O shapes — infer, never duplicate
```python
from pydantic import BaseModel, Field
from decimal import Decimal

class CreateInvoiceRequest(BaseModel):
    amount: Decimal = Field(gt=0, le=1_000_000)
    currency: str = Field(min_length=3, max_length=3, pattern="^[A-Z]{3}$")
    note: str | None = Field(None, max_length=1000)

class InvoiceResponse(BaseModel):
    id: str
    amount: Decimal
    currency: str
    status: InvoiceStatus
    created_at: datetime

    model_config = {"from_attributes": True}  # ORM → Pydantic
```

### Enums for fixed value sets
```python
import enum

class InvoiceStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    SENT  = "SENT"
    PAID  = "PAID"
    VOID  = "VOID"
```

### `Any` only with a comment
```python
# Any: external webhook payload — validated by WebhookSchema below
async def handle_webhook(payload: Any) -> None:
    parsed = WebhookSchema.model_validate(payload)
```

---

## Async Rules

### Never block inside `async def`
```python
# WRONG — blocks the event loop
import requests
import time

async def fetch_data():
    res = requests.get("https://api.example.com")  # blocking
    time.sleep(2)                                   # blocking

# RIGHT
import httpx
import asyncio

async def fetch_data():
    async with httpx.AsyncClient() as client:
        res = await client.get("https://api.example.com")
    await asyncio.sleep(2)
```

### Use `asyncio.gather` for concurrent I/O
```python
invoice, user = await asyncio.gather(
    get_invoice(invoice_id),
    get_user(user_id),
)
```

---

## Error Handling

### Never swallow silently
```python
# WRONG
try:
    result = await service.create(data)
except Exception:
    pass

# RIGHT
try:
    result = await service.create(data)
except ConflictError:
    raise  # let global handler map to 409
except Exception:
    log.exception("create_invoice failed", user_id=user_id)
    raise  # never swallow unknowns
```

### Global FastAPI exception handlers
```python
# app/main.py
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from app.core.errors import NotFoundError, ConflictError, ForbiddenError

app = FastAPI()

@app.exception_handler(NotFoundError)
async def not_found_handler(req: Request, exc: NotFoundError):
    return JSONResponse(status_code=404, content={"error": {"code": "NOT_FOUND", "message": str(exc)}})

@app.exception_handler(ConflictError)
async def conflict_handler(req: Request, exc: ConflictError):
    return JSONResponse(status_code=409, content={"error": {"code": "CONFLICT", "message": str(exc)}})
```

---

## Dependency Injection Pattern

```python
# app/deps.py
from fastapi import Depends, HTTPException
from app.auth import verify_service_token
from app.db import AsyncSession, get_session

async def get_current_user_id(
    token_data: dict = Depends(verify_service_token),
) -> str:
    return token_data["sub"]

# Usage in router
@router.get("/invoices/{invoice_id}")
async def get_invoice(
    invoice_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_session),
) -> DataResponse[InvoiceResponse]:
    ...
```

---

## Automatic Blockers

- `pickle` / `marshal` deserialization of user-supplied data
- `subprocess` / `os.system` with user-supplied arguments
- Blocking I/O (`requests.get`, `time.sleep`) inside `async def`
- `except Exception: pass` — always log and re-raise
- `Any` param type without an explanatory comment
- Secrets in code, env vars logged, PII in structlog output
- `print()` in production code paths — use `structlog`

---

## Toolbelt

| Purpose | Library |
|---|---|
| Web framework | `fastapi` |
| Validation | `pydantic` v2 |
| Async ORM | `sqlalchemy[asyncio]` + `asyncpg` |
| HTTP client | `httpx` |
| Auth / JWT | `python-jose[cryptography]` |
| Rate limiting | `slowapi` |
| Password hashing | `passlib[bcrypt]` |
| Env config | `pydantic-settings` |
| Logging | `structlog` |
| Testing | `pytest` + `pytest-anyio` + `httpx` |
| Linting | `ruff` |
| Type checking | `mypy --strict` |
