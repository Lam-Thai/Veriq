from fastapi import Request
from fastapi.responses import JSONResponse, Response
from jose import JWTError, jwt
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.config import settings


def _subject_from_bearer_token(request: Request) -> str | None:
    """Best-effort extraction of the `sub` claim from an `Authorization: Bearer` header.

    Never raises — an absent, malformed, or expired token just falls through to
    IP-based keying. This is a rate-limit *key*, not an auth check; real auth is
    still enforced by `verify_service_token` on the route itself.
    """
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        return None

    token = auth_header.removeprefix("Bearer ")
    try:
        payload = jwt.decode(
            token,
            settings.INTERNAL_JWT_SECRET,
            algorithms=["HS256"],
        )
    except JWTError:
        return None

    sub = payload.get("sub")
    return str(sub) if sub else None


def rate_limit_key(request: Request) -> str:
    """Rate-limit per authenticated identity when available, else fall back to IP."""
    subject = _subject_from_bearer_token(request)
    if subject is not None:
        return f"user:{subject}"
    return get_remote_address(request)


# `headers_enabled=True` so a 429 always carries Retry-After / X-RateLimit-* headers,
# per this repo's api-contracts convention (Retry-After derived from the limiter's own
# window, never a guessed constant).
limiter = Limiter(key_func=rate_limit_key, headers_enabled=True)


async def rate_limit_exceeded_handler(request: Request, exc: Exception) -> Response:
    """Same {error} envelope as every other error response in this API.

    slowapi's built-in `_rate_limit_exceeded_handler` returns a bare
    `{"error": "..."}` string, which doesn't match this repo's
    `{"error": {"code", "message"}}` contract — so we reuse its header-injection
    behavior but shape the body ourselves.
    """
    del exc  # unused — FastAPI's handler signature requires it; details live on request.state
    response = JSONResponse(
        {"error": {"code": "RATE_LIMITED", "message": "Too many requests"}},
        status_code=429,
    )
    limiter: Limiter = request.app.state.limiter
    injected: Response = limiter._inject_headers(response, request.state.view_rate_limit)
    return injected
