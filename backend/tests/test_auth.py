import pytest
from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient
from jose import jwt

from app.auth import get_current_user_id
from app.core.config import settings

auth_app = FastAPI()


@auth_app.get("/whoami")
async def whoami(user_id: str = Depends(get_current_user_id)) -> dict[str, str]:
    return {"data": user_id}


def _make_token(sub: str | None = "user_123", expired: bool = False) -> str:
    claims: dict[str, object] = {"exp": -1 if expired else 9_999_999_999}
    if sub is not None:
        claims["sub"] = sub
    return jwt.encode(claims, settings.INTERNAL_JWT_SECRET, algorithm="HS256")


@pytest.mark.anyio
async def test_valid_token_is_accepted() -> None:
    token = _make_token()
    transport = ASGITransport(app=auth_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/whoami", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    assert response.json() == {"data": "user_123"}


@pytest.mark.anyio
async def test_missing_token_is_rejected() -> None:
    transport = ASGITransport(app=auth_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/whoami")

    assert response.status_code == 401  # HTTPBearer itself rejects a missing header


@pytest.mark.anyio
async def test_invalid_token_is_rejected() -> None:
    transport = ASGITransport(app=auth_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/whoami", headers={"Authorization": "Bearer not-a-jwt"})

    assert response.status_code == 401


@pytest.mark.anyio
async def test_expired_token_is_rejected() -> None:
    token = _make_token(expired=True)
    transport = ASGITransport(app=auth_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/whoami", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 401


@pytest.mark.anyio
async def test_token_without_sub_is_rejected() -> None:
    token = _make_token(sub=None)
    transport = ASGITransport(app=auth_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/whoami", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 401


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"
