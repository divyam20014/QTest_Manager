"""Security QA engagement pass (no new business features): privilege
escalation, IDOR-as-its-own-class, a systematic unauthenticated/wrong-role
API sweep, audit-manipulation route-enumeration, and documentation tests
for two accepted-risk postures (CSRF via SameSite=Lax cookies, and the
extension-only file-upload allowlist). Complements the existing
cross-tenant RLS sweep in test_rls_isolation.py and the DB-level
insert-only audit test in test_audit_integrity.py rather than duplicating
them."""

from uuid import uuid4

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app

settings = get_settings()


def _bootstrap_tenant(client: TestClient, platform_admin: dict, name: str, email: str) -> dict:
    response = client.post(
        "/api/v1/platform/tenants",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={
            "tenant_name": name,
            "admin_name": "Admin",
            "admin_email": email,
            "admin_password": "AdminPassw0rd!",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _login_and_verify(client: TestClient, tenant_id: str, email: str, password: str) -> None:
    login_response = client.post(
        "/api/v1/auth/login", json={"tenant_id": tenant_id, "email": email, "password": password}
    )
    assert login_response.status_code == 200, login_response.text
    code = login_response.json()["data"]["debug_code"]
    verify_response = client.post("/api/v1/auth/mfa/verify", json={"code": code})
    assert verify_response.status_code == 200, verify_response.text


def _create_user(client: TestClient, email: str, name: str, role: str, password: str) -> str:
    response = client.post(
        "/api/v1/users", json={"email": email, "name": name, "role": role, "password": password}
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]["id"]


# ---------------------------------------------------------------------------
# 1. Privilege escalation
# ---------------------------------------------------------------------------


def test_tester_cannot_self_escalate_to_admin(client: TestClient, platform_admin: dict) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin, "Escalation Co", "admin@escalation.com")
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@escalation.com", "AdminPassw0rd!")
    tester_id = _create_user(
        client, "tester@escalation.com", "Tester One", "tester", "TesterPassw0rd!"
    )

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@escalation.com", "TesterPassw0rd!")

    # Tester has no user.manage permission at all -- cannot touch
    # PATCH /users/{id} even to self-escalate their own role.
    response = tester_client.patch(f"/api/v1/users/{tester_id}", json={"role": "admin"})
    assert response.status_code == 403, response.text

    # Role must be unchanged.
    me = tester_client.get("/api/v1/auth/me").json()["data"]
    assert me["role"] == "tester"


def test_manager_cannot_self_escalate_to_admin(client: TestClient, platform_admin: dict) -> None:
    bootstrap = _bootstrap_tenant(
        client, platform_admin, "Escalation Co 2", "admin@escalation2.com"
    )
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@escalation2.com", "AdminPassw0rd!")
    manager_id = _create_user(
        client, "manager@escalation2.com", "Manager One", "manager", "ManagerPassw0rd!"
    )

    manager_client = TestClient(client.app)
    _login_and_verify(manager_client, tenant_id, "manager@escalation2.com", "ManagerPassw0rd!")

    # Manager has project.members.manage (grants GET /users) but not
    # user.manage -- PATCH is still out of reach.
    response = manager_client.patch(f"/api/v1/users/{manager_id}", json={"role": "admin"})
    assert response.status_code == 403, response.text

    me = manager_client.get("/api/v1/auth/me").json()["data"]
    assert me["role"] == "manager"


# ---------------------------------------------------------------------------
# 2. IDOR -- direct-fetch-by-ID of another tenant's resource, distinct from
# list-scoping (test_rls_isolation.py's cross-tenant sweep already covers
# GET; this adds PATCH/DELETE direct-object-reference probes).
# ---------------------------------------------------------------------------


def test_idor_cross_tenant_mutation_attempts_404_not_leak(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_a = _bootstrap_tenant(client, platform_admin, "IDOR Tenant A", "admin@idor-a.com")
    tenant_a_id = tenant_a["tenant"]["id"]
    _login_and_verify(client, tenant_a_id, "admin@idor-a.com", "AdminPassw0rd!")

    project = client.post(
        "/api/v1/projects",
        json={
            "name": "IDOR Target Project",
            "domain": "Motor",
            "priority": "High",
            "manager_name": "Manager",
            "start_date": "2026-01-01",
            "end_date": "2026-12-31",
            "budget": "1000",
            "region": "NA",
        },
    ).json()["data"]
    case = client.post(
        f"/api/v1/projects/{project['id']}/test-cases",
        json={
            "title": "IDOR Target Case",
            "priority": "High",
            "steps": [{"action": "A", "expected": "B"}],
        },
    ).json()["data"]
    defect = client.post(
        "/api/v1/defects",
        json={"project_id": project["id"], "title": "IDOR Target Defect", "severity": "Critical"},
    ).json()["data"]

    tenant_b_client = TestClient(client.app)
    tenant_b = _bootstrap_tenant(
        tenant_b_client, platform_admin, "IDOR Tenant B", "admin@idor-b.com"
    )
    _login_and_verify(
        tenant_b_client, tenant_b["tenant"]["id"], "admin@idor-b.com", "AdminPassw0rd!"
    )

    # Direct mutation attempts against Tenant A's real object ids, using a
    # fully-authenticated (but wrong-tenant) Admin session. RLS makes these
    # rows invisible, so every one must 404 -- never 200 (leak) and never
    # a 403 that confirms the object's existence.
    probes = [
        ("PATCH", f"/api/v1/projects/{project['id']}", {"name": "Hijacked"}),
        ("DELETE", f"/api/v1/projects/{project['id']}", None),
        ("PATCH", f"/api/v1/test-cases/{case['id']}", {"title": "Hijacked"}),
        ("DELETE", f"/api/v1/test-cases/{case['id']}", None),
        ("PATCH", f"/api/v1/defects/{defect['id']}/status", {"status": "Open"}),
    ]
    for method, path, body in probes:
        response = tenant_b_client.request(method, path, json=body)
        assert response.status_code == 404, (
            f"{method} {path} returned {response.status_code} (expected 404 — any other "
            f"code either leaks existence or mutates another tenant's data): {response.text}"
        )

    # Sanity: the same requests succeed under the correct tenant.
    own_patch = client.patch(f"/api/v1/projects/{project['id']}", json={"name": "Renamed Fine"})
    assert own_patch.status_code == 200, own_patch.text


def test_idor_random_uuid_on_every_get_by_id_route_404s(
    client: TestClient, platform_admin: dict
) -> None:
    """A lighter-weight IDOR probe: a UUID that belongs to nobody at all
    must behave identically to one belonging to another tenant (404), never
    distinguishing "doesn't exist" from "exists but isn't yours."""
    bootstrap = _bootstrap_tenant(client, platform_admin, "IDOR Tenant C", "admin@idor-c.com")
    _login_and_verify(client, bootstrap["tenant"]["id"], "admin@idor-c.com", "AdminPassw0rd!")

    random_id = str(uuid4())
    probes = [
        f"/api/v1/projects/{random_id}",
        f"/api/v1/test-cases/{random_id}",
        f"/api/v1/test-runs/{random_id}",
        f"/api/v1/defects/{random_id}",
    ]
    for path in probes:
        response = client.get(path)
        assert response.status_code == 404, f"GET {path} returned {response.status_code}"


# ---------------------------------------------------------------------------
# 3. Systematic unauthorized API access sweep
# ---------------------------------------------------------------------------

# Every (method, path-template) pair FastAPI has registered under /api/v1,
# excluding the three routes that are *meant* to be reachable pre-session
# (login, mfa/verify) or use a wholly separate auth scheme (platform/*
# HTTP Basic) -- built from the live route table, not a hand-maintained
# list, so it can never silently drift out of sync with app/api/*.py.
_PUBLIC_OR_SEPARATE_AUTH_PREFIXES = (
    "/api/v1/platform",
    "/api/v1/health",
    "/api/v1/ready",
    # Tier 4 / ADR-054: SSO login/callback/status are deliberately public
    # (the OIDC flow itself IS the auth mechanism); SCIM uses its own
    # per-tenant bearer token, a wholly separate scheme from the session
    # cookie this sweep is built to check.
    "/api/v1/auth/sso",
    "/api/v1/scim/v2",
)
_PRE_SESSION_ROUTES = {
    ("POST", "/api/v1/auth/login"),
    ("POST", "/api/v1/auth/mfa/verify"),
    # Tier 1 / ADR-053: deliberately public, like login/mfa-verify above --
    # the invite token itself (unguessable, hashed at rest) is the
    # credential, the same trust model a password-reset link uses.
    ("POST", "/api/v1/users/invite/{token}/accept"),
}


def _all_protected_routes() -> list[tuple[str, str]]:
    routes: list[tuple[str, str]] = []
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        if not route.path.startswith("/api/v1"):
            continue
        if route.path.startswith(_PUBLIC_OR_SEPARATE_AUTH_PREFIXES):
            continue
        for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
            if (method, route.path) in _PRE_SESSION_ROUTES:
                continue
            routes.append((method, route.path))
    return routes


def _fill_path_params(path: str) -> str:
    dummy = str(uuid4())
    out = path
    while "{" in out:
        start = out.index("{")
        end = out.index("}", start)
        out = out[:start] + dummy + out[end + 1 :]
    return out


_PROTECTED_ROUTES = _all_protected_routes()


def test_every_protected_route_is_actually_protected() -> None:
    """Confirms the route inventory itself isn't empty / didn't silently
    collapse to nothing (which would make the parametrized sweep below a
    false-positive no-op)."""
    assert len(_PROTECTED_ROUTES) >= 50, (
        f"Expected the live FastAPI route table to have >=50 protected /api/v1 "
        f"routes; found {len(_PROTECTED_ROUTES)} -- route discovery may be broken."
    )


@pytest.mark.parametrize("method,path_template", _PROTECTED_ROUTES)
def test_no_session_cookie_rejects_every_protected_route(
    method: str, path_template: str
) -> None:
    anon_client = TestClient(app)  # fresh client, no cookies ever set
    path = _fill_path_params(path_template)
    response = anon_client.request(method, path, json={} if method in ("POST", "PATCH") else None)
    assert response.status_code == 401, (
        f"{method} {path} returned {response.status_code} with no session cookie "
        f"(expected 401): {response.text}"
    )


def test_tester_gets_403_on_a_sample_of_admin_and_manager_only_routes(
    client: TestClient, platform_admin: dict
) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin, "Sweep Co", "admin@sweep.com")
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@sweep.com", "AdminPassw0rd!")
    project = client.post(
        "/api/v1/projects",
        json={
            "name": "Sweep Project",
            "domain": "Motor",
            "priority": "High",
            "manager_name": "Manager",
            "start_date": "2026-01-01",
            "end_date": "2026-12-31",
            "budget": "1000",
            "region": "NA",
        },
    ).json()["data"]
    _create_user(client, "tester@sweep.com", "Tester One", "tester", "TesterPassw0rd!")

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@sweep.com", "TesterPassw0rd!")

    # Representative sample of routes a Tester's seeded permission set
    # (testcase.*, testrun.create, executionstep.record, defect.create,
    # report.view) does NOT include.
    admin_or_manager_only = [
        (
            "POST",
            "/api/v1/users",
            {"email": "x@sweep.com", "name": "X", "role": "tester", "password": "Whatever123!"},
        ),
        ("GET", "/api/v1/audit-logs/export", None),
        ("DELETE", f"/api/v1/projects/{project['id']}", None),
        ("POST", f"/api/v1/projects/{project['id']}/members", {"user_id": str(uuid4())}),
        ("POST", "/api/v1/projects", {
            "name": "Tester Should Not Create This",
            "domain": "Motor",
            "priority": "Low",
            "manager_name": "M",
            "start_date": "2026-01-01",
            "end_date": "2026-12-31",
            "budget": "100",
            "region": "NA",
        }),
    ]
    for method, path, body in admin_or_manager_only:
        response = tester_client.request(method, path, json=body)
        assert response.status_code == 403, f"{method} {path} returned {response.status_code}"


# ---------------------------------------------------------------------------
# 4. Audit manipulation via the API surface
# ---------------------------------------------------------------------------


def test_audit_logs_router_exposes_zero_mutation_routes() -> None:
    """Regression guard distinct from test_audit_integrity.py's DB-level
    REVOKE test: proves the *HTTP API surface itself* has no PUT/PATCH/
    DELETE route under /audit-logs at all, so there's nothing to even
    attempt tampering through -- not just that such an attempt would fail."""
    mutating_methods = {"PUT", "PATCH", "DELETE", "POST"}
    offending: list[str] = []
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        if not route.path.startswith("/api/v1/audit-logs"):
            continue
        found = route.methods & mutating_methods
        if found:
            offending.append(f"{found} {route.path}")
    assert offending == [], f"Mutation route(s) found under /audit-logs: {offending}"


def test_unregistered_mutation_methods_on_audit_logs_are_rejected(
    client: TestClient, platform_admin: dict
) -> None:
    """No GET-by-id route exists under /audit-logs either (list returns the
    collection; there is no single-record read route) -- so a mutation
    attempt at /audit-logs/{id} 404s (no route matches that path for any
    method), which is actually a stronger guarantee than a 405 would be:
    there's no routable path to even target for tampering, not just a
    rejected method on an existing one."""
    bootstrap = _bootstrap_tenant(client, platform_admin, "Audit Guard Co", "admin@auditguard.com")
    _login_and_verify(client, bootstrap["tenant"]["id"], "admin@auditguard.com", "AdminPassw0rd!")

    logs = client.get("/api/v1/audit-logs").json()["data"]
    assert len(logs) >= 1
    log_id = logs[0]["id"]

    for method in ("PUT", "PATCH", "DELETE"):
        response = client.request(method, f"/api/v1/audit-logs/{log_id}", json={})
        assert response.status_code == 404, (
            f"{method} /api/v1/audit-logs/{{id}} returned {response.status_code}"
        )


# ---------------------------------------------------------------------------
# 5. CSRF posture -- documents the actual, accepted mitigation (SameSite=Lax
# cookies; no CSRF token mechanism exists and none is added by this pass).
# ---------------------------------------------------------------------------


def test_session_cookie_is_httponly_and_samesite_lax(
    client: TestClient, platform_admin: dict
) -> None:
    """CSRF mitigation in this system is SameSite=Lax on the session cookie,
    not a CSRF token. SameSite=Lax blocks the browser from attaching the
    cookie to cross-site state-changing requests (form POSTs, fetch/XHR
    from a third-party origin), which covers the standard CSRF attack
    shape. This is a deliberate, accepted design choice (no token scheme
    exists anywhere in this codebase -- confirmed via repo-wide grep for
    "csrf", zero hits) -- this test locks in the cookie attributes that
    provide that protection so a future change can't silently weaken it."""
    bootstrap = _bootstrap_tenant(client, platform_admin, "CSRF Co", "admin@csrf.com")
    login_response = client.post(
        "/api/v1/auth/login",
        json={
            "tenant_id": bootstrap["tenant"]["id"],
            "email": "admin@csrf.com",
            "password": "AdminPassw0rd!",
        },
    )
    code = login_response.json()["data"]["debug_code"]
    verify_response = client.post("/api/v1/auth/mfa/verify", json={"code": code})

    set_cookie_header = verify_response.headers.get("set-cookie", "")
    assert settings.session_cookie_name in set_cookie_header
    assert "httponly" in set_cookie_header.lower()
    assert "samesite=lax" in set_cookie_header.lower()
    # Not asserting Secure here: this test suite runs with ENVIRONMENT=
    # development (conftest.py), under which set_session_cookie()
    # deliberately omits Secure so TestClient can exercise the cookie over
    # plain HTTP -- in any real deployment ENVIRONMENT != "development" and
    # Secure is set (see app/core/auth.py::set_session_cookie).


# ---------------------------------------------------------------------------
# 6. File upload content-sniffing (GAP-66, fixed)
# ---------------------------------------------------------------------------


def test_attachment_content_sniffing_rejects_mismatched_payload(
    client: TestClient, platform_admin: dict
) -> None:
    """GAP-66 FIXED: attachment_service.py now checks the file's actual
    bytes against a magic-byte signature (or a "looks like text" check for
    .csv/.txt/.log) in addition to the extension allowlist. A file named
    with an allowed extension (.txt here) whose actual bytes are an
    unrelated binary payload is now REJECTED (422), where it was
    previously accepted."""
    bootstrap = _bootstrap_tenant(client, platform_admin, "Upload Co", "admin@upload.com")
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@upload.com", "AdminPassw0rd!")
    project = client.post(
        "/api/v1/projects",
        json={
            "name": "Upload Project",
            "domain": "Motor",
            "priority": "High",
            "manager_name": "Manager",
            "start_date": "2026-01-01",
            "end_date": "2026-12-31",
            "budget": "1000",
            "region": "NA",
        },
    ).json()["data"]
    case = client.post(
        f"/api/v1/projects/{project['id']}/test-cases",
        json={
            "title": "Upload Case",
            "priority": "High",
            "steps": [{"action": "A", "expected": "B"}],
        },
    ).json()["data"]

    # An ELF/script-style binary payload disguised with an allowed
    # extension and a benign declared content-type.
    disguised_payload = b"\x7fELF" + b"\x00" * 60 + b"#!/bin/sh\nrm -rf /\n"
    response = client.post(
        f"/api/v1/test-cases/{case['id']}/attachments",
        files={"file": ("innocuous.txt", disguised_payload, "text/plain")},
    )
    assert response.status_code == 422, response.text
    assert "content" in response.json()["error"]["message"].lower()

    # A genuinely plain-text file with the same extension is still accepted.
    legit = client.post(
        f"/api/v1/test-cases/{case['id']}/attachments",
        files={"file": ("notes.txt", b"These are real plain-text notes.\n", "text/plain")},
    )
    assert legit.status_code == 200, legit.text

    # A genuine PNG (real magic bytes) with a .png extension is accepted.
    png_bytes = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
    real_image = client.post(
        f"/api/v1/test-cases/{case['id']}/attachments",
        files={"file": ("screenshot.png", png_bytes, "image/png")},
    )
    assert real_image.status_code == 200, real_image.text

    # The same PNG bytes under a mismatched .pdf extension are rejected.
    mismatched = client.post(
        f"/api/v1/test-cases/{case['id']}/attachments",
        files={"file": ("fake.pdf", png_bytes, "application/pdf")},
    )
    assert mismatched.status_code == 422, mismatched.text
