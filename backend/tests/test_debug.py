import pytest
from httpx import ASGITransport, AsyncClient
from jose import jwt

from app.core.config import settings
from app.main import app


def _make_token(sub: str = "user_123") -> str:
    return jwt.encode(
        {"sub": sub, "exp": 9_999_999_999}, settings.INTERNAL_JWT_SECRET, algorithm="HS256"
    )


@pytest.mark.anyio
async def test_debug_route_requires_auth() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/debug/sentry-test")

    assert response.status_code == 401  # HTTPBearer itself rejects a missing header


@pytest.mark.anyio
async def test_debug_route_is_404_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    token = _make_token()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/debug/sentry-test", headers={"Authorization": f"Bearer {token}"}
        )

    assert response.status_code == 404


@pytest.mark.anyio
async def test_debug_route_raises_outside_production() -> None:
    token = _make_token()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        with pytest.raises(RuntimeError, match="Deliberate Sentry test error"):
            await client.post("/debug/sentry-test", headers={"Authorization": f"Bearer {token}"})


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"
