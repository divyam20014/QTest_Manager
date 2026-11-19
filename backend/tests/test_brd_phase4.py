"""BRD gap Phase 4 (ADR-073, FR-AUTH-04): optional primary insurance domain on
tenants -- set at signup, editable by an Admin in settings, visible in the
platform tenant list, readable by every tenant member via branding."""

from fastapi.testclient import TestClient

from tests.test_execution import _create_user, _login_and_verify
from tests.test_signup_and_billing import _login_and_verify as _login_new_tenant


def _signup(client: TestClient, tenant_name: str, admin_email: str, **extra) -> dict:
    response = client.post(
        "/api/v1/auth/signup",
        json={
            "tenant_name": tenant_name,
            "admin_name": "Jamie Founder",
            "admin_email": admin_email,
            "admin_password": "FoundingAdmin1!",
            **extra,
        },
    )
    return response


def test_signup_without_domain_leaves_it_unset(client: TestClient) -> None:
    response = _signup(client, "No Domain Co", "founder@nodomain.com")
    assert response.status_code == 200, response.text
    assert response.json()["data"]["tenant"]["primary_domain"] is None


def test_signup_with_each_valid_domain_stores_it(client: TestClient) -> None:
    for index, domain in enumerate(["Motor", "Health", "Travel", "Life", "Property", "Other"]):
        response = _signup(
            client, f"Domain Co {domain}", f"founder{index}@domain.com", primary_domain=domain
        )
        assert response.status_code == 200, response.text
        assert response.json()["data"]["tenant"]["primary_domain"] == domain


def test_signup_rejects_an_unknown_domain(client: TestClient) -> None:
    response = _signup(client, "Bad Domain Co", "founder@bad.com", primary_domain="Aviation")
    assert response.status_code == 422, response.text


def test_signup_domain_does_not_weaken_password_policy(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/signup",
        json={
            "tenant_name": "Weak Co",
            "admin_name": "Jamie",
            "admin_email": "founder@weak.com",
            "admin_password": "short",
            "primary_domain": "Motor",
        },
    )
    assert response.status_code == 422, response.text


def test_admin_can_set_change_and_clear_the_domain_and_it_is_audited(client: TestClient) -> None:
    data = _signup(client, "Settings Co", "founder@settings.com").json()["data"]
    _login_new_tenant(client, data["tenant"]["id"], "founder@settings.com", "FoundingAdmin1!")

    assert client.get("/api/v1/settings").json()["data"]["primary_domain"] is None

    updated = client.patch("/api/v1/settings", json={"primary_domain": "Health"})
    assert updated.status_code == 200, updated.text
    assert updated.json()["data"]["primary_domain"] == "Health"

    # Omitting the field leaves it alone.
    other = client.patch("/api/v1/settings", json={"default_timezone": "Europe/London"})
    assert other.json()["data"]["primary_domain"] == "Health"

    # An explicit null clears it.
    cleared = client.patch("/api/v1/settings", json={"primary_domain": None})
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["data"]["primary_domain"] is None

    invalid = client.patch("/api/v1/settings", json={"primary_domain": "Aviation"})
    assert invalid.status_code == 422, invalid.text

    logs = client.get("/api/v1/audit-logs", params={"entity_type": "tenant"}).json()["data"]
    items = logs["items"] if isinstance(logs, dict) else logs
    changed = [
        item
        for item in items
        if item["action"] == "tenant.settings_updated" and "primary_domain" in str(item)
    ]
    assert len(changed) >= 2


def test_non_admin_cannot_change_the_domain_but_can_read_it_via_branding(
    client: TestClient, platform_admin: dict
) -> None:
    data = _signup(client, "Roles Co", "founder@roles.com", primary_domain="Motor").json()["data"]
    tenant_id = data["tenant"]["id"]
    _login_new_tenant(client, tenant_id, "founder@roles.com", "FoundingAdmin1!")
    _create_user(client, "tester@roles.com", "Tess Tester", "tester", "TesterPassw0rd!")
    _create_user(client, "manager@roles.com", "Mo Manager", "manager", "ManagerPassw0rd!")

    for email, password in (
        ("tester@roles.com", "TesterPassw0rd!"),
        ("manager@roles.com", "ManagerPassw0rd!"),
    ):
        _login_and_verify(client, tenant_id, email, password)
        denied = client.patch("/api/v1/settings", json={"primary_domain": "Life"})
        assert denied.status_code == 403, denied.text
        branding = client.get("/api/v1/settings/branding")
        assert branding.status_code == 200, branding.text
        assert branding.json()["data"]["primary_domain"] == "Motor"


def test_domain_is_tenant_isolated(client: TestClient) -> None:
    first = _signup(client, "First Co", "founder@first.com", primary_domain="Travel").json()["data"]
    second = _signup(client, "Second Co", "founder@second.com").json()["data"]

    _login_new_tenant(client, second["tenant"]["id"], "founder@second.com", "FoundingAdmin1!")
    assert client.get("/api/v1/settings").json()["data"]["primary_domain"] is None
    client.patch("/api/v1/settings", json={"primary_domain": "Life"})

    _login_new_tenant(client, first["tenant"]["id"], "founder@first.com", "FoundingAdmin1!")
    assert client.get("/api/v1/settings").json()["data"]["primary_domain"] == "Travel"


def test_platform_admin_can_create_a_tenant_with_a_domain_and_sees_it_in_the_list(
    client: TestClient, platform_admin: dict
) -> None:
    created = client.post(
        "/api/v1/platform/tenants",
        headers=platform_admin["headers"],
        json={
            "tenant_name": "Platform Made Co",
            "admin_name": "Admin A",
            "admin_email": "admin@platformmade.com",
            "admin_password": "AdminPassw0rd!",
            "primary_domain": "Property",
        },
    )
    assert created.status_code == 200, created.text
    assert created.json()["data"]["tenant"]["primary_domain"] == "Property"

    listing = client.get(
        "/api/v1/platform/tenants", headers=platform_admin["headers"]
    )
    assert listing.status_code == 200, listing.text
    by_name = {item["name"]: item for item in listing.json()["data"]["items"]}
    assert by_name["Platform Made Co"]["primary_domain"] == "Property"
