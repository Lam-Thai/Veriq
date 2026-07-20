import time
import uuid
from collections.abc import Awaitable, Callable

import sentry_sdk
import structlog
from fastapi import Request, Response
from fastapi.responses import JSONResponse

from app.core.logging import log


async def request_context_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """Bind a request id to every log line for this request and log one structured
    summary line per request (method, path, status_code, duration_ms).

    Reuses an incoming `X-Request-Id` header when present (so a caller — e.g. the
    Next.js service — can propagate its own id end to end), otherwise mints one.
    The id is bound via structlog's contextvars for the lifetime of the request and
    always cleared afterward, and echoed back on `X-Request-Id` so the caller can
    correlate logs across services.
    """
    request_id = request.headers.get("X-Request-Id") or str(uuid.uuid4())
    structlog.contextvars.bind_contextvars(request_id=request_id)
    start = time.perf_counter()

    try:
        response = await call_next(request)
    except Exception as exc:
        # Convert into our own response (rather than re-raising) so this middleware can attach
        # X-Request-Id below and shape the body as this repo's standard {"error": ...} envelope —
        # Starlette's default unhandled-exception handling does neither. Capturing here explicitly
        # is required precisely because we no longer let the exception propagate to Sentry's
        # automatic ASGI-level capture; without this, the error would go unreported.
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        log.exception(
            "request.failed",
            method=request.method,
            path=request.url.path,
            duration_ms=duration_ms,
        )
        sentry_sdk.capture_exception(exc)
        response = JSONResponse(
            {"error": {"code": "INTERNAL", "message": "Something went wrong"}},
            status_code=500,
        )
    finally:
        structlog.contextvars.clear_contextvars()

    duration_ms = round((time.perf_counter() - start) * 1000, 2)
    response.headers["X-Request-Id"] = request_id
    log.info(
        "request.completed",
        method=request.method,
        path=request.url.path,
        status_code=response.status_code,
        duration_ms=duration_ms,
    )
    return response
