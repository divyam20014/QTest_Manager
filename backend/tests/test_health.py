from fastapi import APIRouter
from fastapi.testclient import TestClient

from app.main import app


def test_health_ok() -> None:
    client = TestClient(app)
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"data": {"status": "ok"}, "error": None}


def test_ready_ok_when_database_reachable() -> None:
    """SAAS-GAP-16: /ready does a real DB round trip, not just a liveness
    check -- this test runs against the real test-session Postgres, so a
    200 here is a genuine confirmation the query succeeded."""
    client = TestClient(app)
    response = client.get("/api/v1/ready")
    assert response.status_code == 200
    assert response.json() == {"data": {"status": "ready"}, "error": None}


def test_unhandled_exception_returns_enveloped_500(monkeypatch) -> None:
    """SAAS-GAP-15: a genuine unhandled bug must still return the app's
    consistent {"data": null, "error": {...}} envelope, not Starlette's
    default error shape. Mounts a throwaway route that always raises."""
    probe_router = APIRouter()

    @probe_router.get("/api/v1/__test-unhandled-error")
    def _boom() -> None:
        raise RuntimeError("deliberate failure for SAAS-GAP-15 test")

    app.include_router(probe_router)
    client = TestClient(app, raise_server_exceptions=False)

    response = client.get("/api/v1/__test-unhandled-error")

    assert response.status_code == 500
    body = response.json()
    assert body["data"] is None
    assert body["error"]["code"] == "internal_error"
    # The real exception message must never leak to the client.
    assert "deliberate failure" not in body["error"]["message"]
