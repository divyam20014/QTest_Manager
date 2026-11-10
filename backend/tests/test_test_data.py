"""Gap-closure pass (ADR-057): synthetic test-data generation + masking
utility (GAP-75's "zero test-data-repository/masking/synthetic-data
capability")."""

from fastapi.testclient import TestClient


def _bootstrap_and_login(client: TestClient, platform_admin: dict, name: str) -> None:
    bootstrap = client.post(
        "/api/v1/platform/tenants",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={
            "tenant_name": name,
            "admin_name": "Admin A",
            "admin_email": f"admin@{name.lower().replace(' ', '')}.com",
            "admin_password": "AdminPassw0rd!",
        },
    ).json()["data"]
    tenant_id = bootstrap["tenant"]["id"]
    login = client.post(
        "/api/v1/auth/login",
        json={
            "tenant_id": tenant_id,
            "email": f"admin@{name.lower().replace(' ', '')}.com",
            "password": "AdminPassw0rd!",
        },
    )
    code = login.json()["data"]["debug_code"]
    client.post("/api/v1/auth/mfa/verify", json={"code": code})


def test_generate_produces_requested_count_and_field_types(
    client: TestClient, platform_admin: dict
) -> None:
    _bootstrap_and_login(client, platform_admin, "TestData Co")
    response = client.post(
        "/api/v1/test-data/generate",
        json={
            "fields": [
                {"name": "full_name", "type": "name"},
                {"name": "contact_email", "type": "email"},
                {"name": "phone_number", "type": "phone"},
            ],
            "count": 5,
        },
    )
    assert response.status_code == 200, response.text
    rows = response.json()["data"]["rows"]
    assert len(rows) == 5
    for row in rows:
        assert "full_name" in row and "contact_email" in row and "phone_number" in row
        assert "@" in row["contact_email"]
        assert "555-" in row["phone_number"]


def test_generate_rejects_unknown_field_type(client: TestClient, platform_admin: dict) -> None:
    _bootstrap_and_login(client, platform_admin, "TestData Bad Type Co")
    response = client.post(
        "/api/v1/test-data/generate",
        json={"fields": [{"name": "x", "type": "not_a_real_type"}], "count": 1},
    )
    assert response.status_code == 422, response.text


def test_generate_is_deterministic_given_same_count(
    client: TestClient, platform_admin: dict
) -> None:
    _bootstrap_and_login(client, platform_admin, "TestData Deterministic Co")
    body = {"fields": [{"name": "n", "type": "name"}], "count": 3}
    first = client.post("/api/v1/test-data/generate", json=body).json()["data"]["rows"]
    second = client.post("/api/v1/test-data/generate", json=body).json()["data"]["rows"]
    assert first == second


def test_masking_is_deterministic_and_salt_sensitive(
    client: TestClient, platform_admin: dict
) -> None:
    _bootstrap_and_login(client, platform_admin, "TestData Masking Co")
    values = ["Jane Doe", "123-45-6789"]

    first = client.post(
        "/api/v1/test-data/mask", json={"values": values, "salt": "env-a"}
    ).json()["data"]["masked"]
    second = client.post(
        "/api/v1/test-data/mask", json={"values": values, "salt": "env-a"}
    ).json()["data"]["masked"]
    different_salt = client.post(
        "/api/v1/test-data/mask", json={"values": values, "salt": "env-b"}
    ).json()["data"]["masked"]

    # Same salt -> same masked output every time (referential consistency).
    assert first == second
    # Different salt -> different masked output for the same real value.
    assert first != different_salt
    # Never just echoes the real value back.
    assert "Jane Doe" not in first
    assert "123-45-6789" not in first


def test_list_field_types_requires_authentication(client: TestClient) -> None:
    response = client.get("/api/v1/test-data/field-types")
    assert response.status_code == 401, response.text
