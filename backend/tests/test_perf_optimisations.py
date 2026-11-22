"""ADR-113: keyset paging, the report cache, and the batched serializers.

Offset paging stays the default and keeps its exact response shape; `cursor` is an
opt-in. The report cache is off in the rest of the suite (conftest sets
REPORT_CACHE_TTL_SECONDS=0), so these tests switch it on explicitly.
"""

import pytest
from fastapi.testclient import TestClient

from app.core import ttl_cache
from app.core.config import get_settings
from tests.test_execution import _create_approved_case, _setup_admin_project_and_case
from tests.test_paged_listings import _data, _defects_in_two_projects, _other_tenant_client


def _walk(client: TestClient, path: str, page_size: int, extra: dict | None = None) -> list[dict]:
    """Follow `next_cursor` from the empty cursor until it is null."""
    items: list[dict] = []
    cursor = ""
    for _ in range(50):
        body = _data(
            client.get(path, params={"cursor": cursor, "page_size": page_size, **(extra or {})})
        )
        items += body["items"]
        cursor = body["next_cursor"]
        if cursor is None:
            return items
    raise AssertionError("cursor never ended")


# ---------------------------------------------------------------- keyset paging


def test_defects_keyset_walk_matches_offset_order_and_offset_shape_is_unchanged(
    client: TestClient, platform_admin: dict
) -> None:
    _, _, _, defects = _defects_in_two_projects(client, platform_admin)
    plain_order = [d["id"] for d in _data(client.get("/api/v1/defects"))]

    walked = _walk(client, "/api/v1/defects", 2)
    assert [d["id"] for d in walked] == plain_order
    assert len(walked) == len(defects)

    offset_page = _data(client.get("/api/v1/defects", params={"page_size": 2}))
    assert set(offset_page) == {"items", "total"}  # no next_cursor without a cursor

    no_total = _data(
        client.get(
            "/api/v1/defects", params={"cursor": "", "include_total": False, "page_size": 100}
        )
    )
    assert no_total["total"] == -1 and len(no_total["items"]) == len(defects)


def test_test_cases_keyset_walk_covers_every_case_once(
    client: TestClient, platform_admin: dict
) -> None:
    _, project, _case = _setup_admin_project_and_case(client, platform_admin)
    for i in range(4):
        _create_approved_case(client, project["id"], f"Keyset case number {i}")
    offset_ids = [
        c["id"] for c in _data(client.get("/api/v1/test-cases", params={"page_size": 100}))["items"]
    ]
    assert len(offset_ids) == 5

    for path in ("/api/v1/test-cases", f"/api/v1/projects/{project['id']}/test-cases"):
        walked = _walk(client, path, 2)
        assert [c["id"] for c in walked] == offset_ids
        newest_first = _walk(client, path, 2, {"sort": "-created_at"})
        assert {c["id"] for c in newest_first} == set(offset_ids)

    unsupported = client.get("/api/v1/test-cases", params={"cursor": "", "sort": "title"})
    assert unsupported.status_code == 422
    assert client.get("/api/v1/test-cases", params={"cursor": "not-a-cursor"}).status_code == 422


def test_audit_log_keyset_walk_uses_the_next_cursor_header(
    client: TestClient, platform_admin: dict
) -> None:
    _defects_in_two_projects(client, platform_admin)
    everything = _data(client.get("/api/v1/audit-logs", params={"limit": 200}))
    assert len(everything) > 5

    walked: list[dict] = []
    cursor = ""
    for _ in range(100):
        response = client.get("/api/v1/audit-logs", params={"cursor": cursor, "limit": 4})
        assert response.status_code == 200
        walked += response.json()["data"]
        cursor = response.headers.get("X-Next-Cursor")
        if cursor is None:
            break
    assert [r["id"] for r in walked] == [r["id"] for r in everything]
    assert "X-Next-Cursor" not in client.get("/api/v1/audit-logs").headers


# ---------------------------------------------------------------- report cache


@pytest.fixture
def report_cache_on(monkeypatch):
    monkeypatch.setattr(get_settings(), "report_cache_ttl_seconds", 30.0)
    ttl_cache.invalidate_all()
    yield
    ttl_cache.invalidate_all()


def test_dashboard_cache_is_invalidated_by_a_write_and_never_crosses_tenants(
    client: TestClient, platform_admin: dict, report_cache_on
) -> None:
    _, project, _case = _setup_admin_project_and_case(client, platform_admin)
    first = _data(client.get("/api/v1/dashboard/summary"))
    assert first["test_cases"]["total"] == 1
    # A repeat is served from the cache (same answer) ...
    assert _data(client.get("/api/v1/dashboard/summary")) == first

    # ... and a write drops it at once, not after the TTL.
    _create_approved_case(client, project["id"], "A second approved case")
    assert _data(client.get("/api/v1/dashboard/summary"))["test_cases"]["total"] == 2

    # Another tenant has its own, empty, numbers even though the cache is warm.
    other = _other_tenant_client(client, platform_admin)
    assert _data(other.get("/api/v1/dashboard/summary"))["test_cases"]["total"] == 0
    assert _data(client.get("/api/v1/dashboard/summary"))["test_cases"]["total"] == 2


def test_cached_report_key_separates_role_user_and_arguments() -> None:
    from uuid import uuid4

    calls: list[tuple] = []

    @ttl_cache.cached_report("unit")
    def report(db, tenant_id, role_code, user_id, project_id=None):
        calls.append((tenant_id, role_code, user_id, project_id))
        return object()

    tenant, user_a, user_b, project = uuid4(), uuid4(), uuid4(), uuid4()
    settings = get_settings()
    original = settings.report_cache_ttl_seconds
    settings.report_cache_ttl_seconds = 30.0
    try:
        ttl_cache.invalidate_all()
        report(None, tenant, "admin", user_a, project)
        report(None, tenant, "admin", user_a, project)  # hit
        assert len(calls) == 1
        report(None, tenant, "tester", user_a, project)  # other role
        report(None, tenant, "admin", user_b, project)  # other user
        report(None, tenant, "admin", user_a, None)  # other argument
        report(None, uuid4(), "admin", user_a, project)  # other tenant
        assert len(calls) == 5
        ttl_cache.cache.invalidate_tenant(tenant)
        report(None, tenant, "admin", user_a, project)
        assert len(calls) == 6
    finally:
        settings.report_cache_ttl_seconds = original
        ttl_cache.invalidate_all()


def test_cache_is_off_when_ttl_is_zero() -> None:
    from uuid import uuid4

    calls: list[int] = []

    @ttl_cache.cached_report("unit_off")
    def report(db, tenant_id, role_code, user_id):
        calls.append(1)
        return None

    assert get_settings().report_cache_ttl_seconds == 0  # tests run with the cache off
    tenant, user = uuid4(), uuid4()
    report(None, tenant, "admin", user)
    report(None, tenant, "admin", user)
    assert len(calls) == 2
