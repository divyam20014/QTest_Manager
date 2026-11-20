"""ADR-088 / GAP-89 follow-up: a malformed id must never surface as a 5xx.

Sweeps every tenant route that has a UUID path parameter (and every list route
with a UUID query filter), calls it as a tenant Admin with a malformed id, and
asserts a 4xx with the standard `{data, error}` envelope.
"""

import uuid

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.main import app
from tests.test_execution import _setup_admin_project_and_case

BAD_ID = "not-a-uuid"
SKIP_PREFIXES = ("/api/v1/platform",)  # platform session auth, covered separately
# Routes that cannot be driven with a plain JSON call as an Admin session.
# Each entry is justified; keep this list short.
ALLOWLIST = {
    # SCIM uses bearer-token auth, not a user session: a session gets 401/403,
    # which is still a 4xx, so no entry is needed. (Kept empty on purpose.)
}


def _is_uuid_param(field) -> bool:
    return getattr(field, "type_", None) is uuid.UUID or "UUID" in str(
        getattr(field, "annotation", "")
    )


def _cases() -> list[tuple[str, str, str]]:
    cases = []
    for route in app.routes:
        if not isinstance(route, APIRoute) or route.path.startswith(SKIP_PREFIXES):
            continue
        uuid_paths = [p.name for p in route.dependant.path_params if _is_uuid_param(p)]
        uuid_queries = [q.alias for q in route.dependant.query_params if _is_uuid_param(q)]
        for method in route.methods - {"HEAD", "OPTIONS"}:
            if uuid_paths:
                path = route.path
                for name in uuid_paths:
                    path = path.replace("{" + name + "}", BAD_ID)
                cases.append((method, path, "path"))
            for q in uuid_queries:
                path = route.path
                for p in route.dependant.path_params:
                    path = path.replace("{" + p.name + "}", str(uuid.uuid4()))
                if method == "GET":
                    cases.append((method, f"{path}?{q}={BAD_ID}", "query"))
    return cases


CASES = _cases()


def test_sweep_enumerates_routes() -> None:
    assert len(CASES) > 100


def test_malformed_ids_never_5xx(client: TestClient, platform_admin: dict) -> None:
    _setup_admin_project_and_case(client, platform_admin)
    failures = []
    for method, path, kind in CASES:
        if (method, path) in ALLOWLIST:
            continue
        response = client.request(method, path, json={} if method != "GET" else None)
        ok = 400 <= response.status_code < 500
        if ok and "application/json" in response.headers.get("content-type", ""):
            body = response.json()
            ok = (
                isinstance(body, dict)
                and body.get("data") is None
                and isinstance(body.get("error"), dict)
                and {"code", "message"} <= set(body["error"])
            )
        if not ok:
            failures.append(
                f"{method} {path} [{kind}] -> {response.status_code} {response.text[:120]}"
            )
    assert not failures, "\n".join(failures)


@pytest.mark.parametrize("field", ["test_case_ids"])
def test_malformed_ids_in_body_are_4xx(
    client: TestClient, platform_admin: dict, field: str
) -> None:
    _, project, _ = _setup_admin_project_and_case(client, platform_admin)
    response = client.post(
        f"/api/v1/projects/{project['id']}/test-runs",
        json={"name": "R", "run_type": "Regression", field: [BAD_ID]},
    )
    assert response.status_code == 422
    body = response.json()
    assert body["data"] is None and body["error"]["code"] == "validation_error"


def test_db_data_error_is_enveloped_422_not_500() -> None:
    from sqlalchemy.exc import DataError

    def boom() -> None:
        raise DataError("SELECT 1", {}, ValueError("invalid input syntax for type uuid"))

    app.add_api_route("/__test_data_error", boom)
    try:
        response = TestClient(app).get("/__test_data_error")
    finally:
        app.router.routes.pop()
    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "invalid_value" and "uuid" not in response.text
