"""ADR-114: the full documentation is platform-admin only (/platform/docs);
tenant users get only the role-filtered User Guide (/user-guide) and the old
tenant /docs endpoints no longer serve anything."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.services import docs_service
from scripts import sync_docs

PASSWORDS = {"manager": "ManagerPassw0rd!", "tester": "TesterPassw0rd!"}


def _login(client: TestClient, tenant_id: str, email: str, password: str) -> None:
    resp = client.post(
        "/api/v1/auth/login", json={"tenant_id": tenant_id, "email": email, "password": password}
    )
    assert resp.status_code == 200, resp.text
    code = resp.json()["data"]["debug_code"]
    assert client.post("/api/v1/auth/mfa/verify", json={"code": code}).status_code == 200


@pytest.fixture
def clients(client: TestClient, platform_admin: dict) -> dict[str, TestClient]:
    created = client.post(
        "/api/v1/platform/tenants",
        headers=platform_admin["headers"],
        json={
            "tenant_name": "Docs Mutual",
            "admin_name": "Admin D",
            "admin_email": "admin@docs.com",
            "admin_password": "AdminPassw0rd!",
        },
    )
    assert created.status_code == 200, created.text
    tenant_id = created.json()["data"]["tenant"]["id"]
    _login(client, tenant_id, "admin@docs.com", "AdminPassw0rd!")
    out = {"admin": client}
    for role in ("manager", "tester"):
        r = client.post(
            "/api/v1/users",
            json={
                "email": f"{role}@docs.com",
                "name": role.title(),
                "role": role,
                "password": PASSWORDS[role],
            },
        )
        assert r.status_code in (200, 201), r.text
        other = TestClient(client.app)
        _login(other, tenant_id, f"{role}@docs.com", PASSWORDS[role])
        out[role] = other
    return out


SENSITIVE = [d.slug for d in docs_service.REGISTRY if d.audience == docs_service.ADMIN]
ALL_SLUGS = {d.slug for d in docs_service.REGISTRY}
NO_STORE = "private, no-store"


def test_registry_classifies_the_sensitive_documents() -> None:
    for slug in (
        "administrator-guide",
        "production-deployment-guide",
        "database-schema",
        "api-specification",
        "architecture-decisions",
        "known-gaps",
        "security-configuration",
    ):
        assert slug in SENSITIVE
    assert docs_service.find("user-guide").audience == docs_service.EVERYONE  # type: ignore[union-attr]


@pytest.mark.parametrize("role", ["admin", "manager", "tester"])
def test_tenant_docs_endpoints_serve_nothing(clients: dict[str, TestClient], role: str) -> None:
    c = clients[role]
    assert c.get("/api/v1/docs").status_code in (403, 404)
    for slug in ("user-guide", "administrator-guide", "architecture-decisions", "known-gaps"):
        r = c.get(f"/api/v1/docs/{slug}")
        assert r.status_code in (403, 404), (role, slug)
        assert "# " not in r.text


def test_signed_out_gets_no_docs_or_guide(client: TestClient) -> None:
    assert client.get("/api/v1/docs").status_code in (401, 403, 404)
    assert client.get("/api/v1/docs/user-guide").status_code in (401, 403, 404)
    assert client.get("/api/v1/user-guide").status_code == 401


def _ids(c: TestClient) -> list[str]:
    r = c.get("/api/v1/user-guide")
    assert r.status_code == 200, r.text
    return [s["id"] for s in r.json()["data"]["sections"]]


def test_tester_guide_has_only_getting_started_and_tester(clients: dict[str, TestClient]) -> None:
    c = clients["tester"]
    assert _ids(c) == ["getting-started", "tester"]
    text = c.get("/api/v1/user-guide").text
    # Manager/Admin-only content must not be in the payload at all.
    assert "For Managers" not in text and "For Admins" not in text
    assert "Onboarding a team" not in text and "Invite User" not in text


def test_manager_guide_adds_manager_section(clients: dict[str, TestClient]) -> None:
    c = clients["manager"]
    assert _ids(c) == ["getting-started", "tester", "manager"]
    assert "Onboarding a team" not in c.get("/api/v1/user-guide").text


def test_admin_guide_has_every_section(clients: dict[str, TestClient]) -> None:
    c = clients["admin"]
    assert _ids(c) == ["getting-started", "tester", "manager", "admin"]
    for s in c.get("/api/v1/user-guide").json()["data"]["sections"]:
        assert s["title"] and s["markdown"].strip(), s["id"]
        assert not s["markdown"].lstrip().startswith("## ")


def test_guide_never_includes_platform_only_content(clients: dict[str, TestClient]) -> None:
    text = clients["admin"].get("/api/v1/user-guide").text.lower()
    for term in ("docker compose", "production deployment", "pg_dump", "administrator guide"):
        assert term not in text, term


def test_guide_is_not_cacheable(clients: dict[str, TestClient]) -> None:
    assert clients["tester"].get("/api/v1/user-guide").headers["cache-control"] == NO_STORE


def test_platform_admin_reads_every_document(client: TestClient, platform_admin: dict) -> None:
    h = platform_admin["headers"]
    listing = client.get("/api/v1/platform/docs", headers=h)
    assert listing.status_code == 200, listing.text
    assert listing.headers["cache-control"] == NO_STORE
    assert {d["slug"] for d in listing.json()["data"]["documents"]} == ALL_SLUGS
    for slug in ALL_SLUGS:
        r = client.get(f"/api/v1/platform/docs/{slug}", headers=h)
        assert r.status_code == 200, slug
        assert len(r.json()["data"]["content"]) > 100
    assert client.get("/api/v1/platform/docs/nope", headers=h).status_code == 404


def test_platform_docs_need_a_platform_session(client: TestClient, platform_admin: dict) -> None:
    anon = TestClient(client.app)
    assert anon.get("/api/v1/platform/docs").status_code in (401, 403)
    assert anon.get("/api/v1/platform/docs/user-guide").status_code in (401, 403)


@pytest.mark.parametrize("role", ["admin", "manager", "tester"])
def test_tenant_session_cannot_read_platform_docs(
    clients: dict[str, TestClient], role: str
) -> None:
    c = clients[role]
    assert c.get("/api/v1/platform/docs").status_code in (401, 403)
    assert c.get("/api/v1/platform/docs/user-guide").status_code in (401, 403)


@pytest.mark.parametrize(
    "slug",
    [
        "..%2F..%2Fapp%2Fmain",
        "..%5C..%5Cetc",
        "%2e%2e%2fsecret",
        "user-guide.md",
        "USER-GUIDE",
        "a/b",
        "-x",
    ],
)
def test_malformed_or_traversal_slug_is_rejected(
    client: TestClient, platform_admin: dict, slug: str
) -> None:
    r = client.get(f"/api/v1/platform/docs/{slug}", headers=platform_admin["headers"])
    assert r.status_code in (404, 422), (slug, r.status_code)
    assert "import" not in r.text  # never a file's contents


def test_bundled_copies_match_docs_folder() -> None:
    """Drift between docs/ and backend/app/docs_content (run `npm run docs:sync`)."""
    if not sync_docs.DOCS_DIR.is_dir():  # api image: docs/ is not shipped
        pytest.skip("docs/ folder not present")
    assert sync_docs.main(["--check"]) == 0


def test_every_registered_document_has_a_copy_and_no_secrets() -> None:
    import re

    patterns = [
        r"BEGIN [A-Z ]*PRIVATE KEY",
        r"AKIA[0-9A-Z]{16}",
        r"\bsk-[A-Za-z0-9]{20,}",
        r"postgres(ql)?(\+\w+)?://[^\s/:]+:[^\s@]+@",
    ]
    for d in docs_service.REGISTRY:
        path = Path(docs_service.CONTENT_DIR) / f"{d.slug}.md"
        assert path.is_file(), d.slug
        text = path.read_text(encoding="utf-8")
        for p in patterns:
            assert not re.search(p, text), (d.slug, p)
