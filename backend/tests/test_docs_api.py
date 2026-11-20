"""ADR-089: the in-app documentation is served by the API behind a session,
with sensitive documents limited to Admin."""

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


GENERAL = "user-guide"
SENSITIVE = [d.slug for d in docs_service.REGISTRY if d.audience == docs_service.ADMIN]


def test_signed_out_gets_401(client: TestClient) -> None:
    assert client.get("/api/v1/docs").status_code == 401
    assert client.get(f"/api/v1/docs/{GENERAL}").status_code == 401


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
    assert docs_service.find("requirement-traceability").audience == docs_service.EVERYONE  # type: ignore[union-attr]


@pytest.mark.parametrize("role", ["manager", "tester"])
def test_non_admins_see_only_general_documents(clients: dict[str, TestClient], role: str) -> None:
    c = clients[role]
    listing = c.get("/api/v1/docs")
    assert listing.status_code == 200
    docs = listing.json()["data"]["documents"]
    assert docs and all(d["audience"] == "everyone" for d in docs)
    assert not {d["slug"] for d in docs} & set(SENSITIVE)
    ok = c.get(f"/api/v1/docs/{GENERAL}")
    assert ok.status_code == 200
    assert ok.json()["data"]["content"].lstrip().startswith("#")
    for slug in SENSITIVE:
        assert c.get(f"/api/v1/docs/{slug}").status_code == 403, slug


def test_admin_sees_every_document(clients: dict[str, TestClient]) -> None:
    c = clients["admin"]
    docs = c.get("/api/v1/docs").json()["data"]["documents"]
    assert {d["slug"] for d in docs} == {d.slug for d in docs_service.REGISTRY}
    for d in docs_service.REGISTRY:
        r = c.get(f"/api/v1/docs/{d.slug}")
        assert r.status_code == 200, d.slug
        assert len(r.json()["data"]["content"]) > 100


def test_responses_are_not_cacheable(clients: dict[str, TestClient]) -> None:
    c = clients["tester"]
    assert c.get("/api/v1/docs").headers["cache-control"] == "private, no-store"
    assert c.get(f"/api/v1/docs/{GENERAL}").headers["cache-control"] == "private, no-store"


def test_unknown_slug_is_404(clients: dict[str, TestClient]) -> None:
    r = clients["admin"].get("/api/v1/docs/no-such-doc")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "not_found"


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
def test_malformed_or_traversal_slug_is_rejected(clients: dict[str, TestClient], slug: str) -> None:
    r = clients["admin"].get(f"/api/v1/docs/{slug}")
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
