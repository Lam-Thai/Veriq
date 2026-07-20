from typing import Any

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from app.core.config import settings

bearer = HTTPBearer()


async def verify_service_token(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
) -> dict[str, Any]:
    try:
        payload: dict[str, Any] = jwt.decode(
            credentials.credentials,
            settings.INTERNAL_JWT_SECRET,
            algorithms=["HS256"],
        )
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc

    if not payload.get("sub"):
        raise HTTPException(status_code=401, detail="Invalid token")
    return payload


async def get_current_user_id(
    token: dict[str, Any] = Depends(verify_service_token),
) -> str:
    return str(token["sub"])
