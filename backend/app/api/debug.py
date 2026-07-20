from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth import get_current_user_id
from app.core.config import settings
from app.core.rate_limit import limiter

router = APIRouter()


@router.post("/debug/sentry-test")
@limiter.limit("10/minute")
async def sentry_test(
    request: Request,  # required by slowapi's @limiter.limit to key the request
    user_id: str = Depends(get_current_user_id),
) -> None:
    del user_id  # auth-gated only — identity itself isn't used, just proves the token was valid
    if settings.ENVIRONMENT == "production":
        # 404, not 403 — this route shouldn't even be discoverable in production
        raise HTTPException(status_code=404)

    raise RuntimeError("Deliberate Sentry test error triggered via /debug/sentry-test")
