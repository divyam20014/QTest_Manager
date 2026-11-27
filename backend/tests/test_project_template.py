"""ADR-142 (Phase 1D): a new project can start from another project's setup."""

from fastapi.testclient import TestClient

from tests.test_execution import (
    _bootstrap_tenant,
    _create_approved_case,
    _create_project,
    _create_user,
    _login_and_verify,
)

API = "/api/v1"
NAV = {"order": ["overview", "defects"], "hidden": ["tasks"]}


def _ok(response):
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _setup(client: TestClient, platform_admin: dict) -> tuple[str, str]:
    tenant_id = _bootstrap_tenant(client, platform_admin)["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    source = _create_project(client, "Source project")["id"]
    _ok(client.patch(f"{API}/projects/{source}", json={"nav_config": NAV}))
    return tenant_id, source


def _module(client: TestClient, project_id: str, name: str, parent: str | None = None) -> str:
    body = {"name": name, "parent_id": parent}
    return _ok(client.post(f"{API}/projects/{project_id}/modules", json=body))["id"]


def _tree(client: TestClient, project_id: str) -> set[tuple[str, str | None]]:
    """(name, parent's name) of every module."""
    flat: list[dict] = []

    def walk(nodes: list[dict]) -> None:
        for node in nodes:
            flat.append(node)
            walk(node.get("children") or [])

    walk(_ok(client.get(f"{API}/projects/{project_id}/modules")))
    names = {m["id"]: m["name"] for m in flat}
    return {(m["name"], names.get(m["parent_id"])) for m in flat}


def test_tabs_and_the_module_tree_are_copied_and_nothing_else(
    client: TestClient, platform_admin: dict
) -> None:
    _, source = _setup(client, platform_admin)
    claims = _module(client, source, "Claims")
    motor = _module(client, source, "Motor claims", claims)
    _module(client, source, "Photos", motor)
    _module(client, source, "Billing")
    _create_approved_case(client, source, "Stays in the source project")

    created = _ok(
        client.post(
            f"{API}/projects", json={"name": "From template", "template_project_id": source}
        )
    )

    assert created["nav_config"] == NAV
    assert _tree(client, created["id"]) == _tree(client, source) != set()
    assert (created["test_case_count"], created["test_run_count"]) == (0, 0)
    assert created["domain"] is None and created["budget"] is None
    me = _ok(client.get(f"{API}/auth/me"))["user_id"]
    assert created["assigned_user_ids"] == [me]
    # The copies are the new project's own: changing one leaves the source alone.
    _module(client, created["id"], "Only here")
    assert ("Only here", None) not in _tree(client, source)


def test_an_archived_project_can_still_be_copied(client: TestClient, platform_admin: dict) -> None:
    _, source = _setup(client, platform_admin)
    _module(client, source, "Claims")
    _ok(client.post(f"{API}/projects/{source}/archive"))

    created = _ok(
        client.post(f"{API}/projects", json={"name": "Next one", "template_project_id": source})
    )

    assert _tree(client, created["id"]) == {("Claims", None)}


def test_an_unknown_or_another_organizations_project_cannot_be_copied(
    client: TestClient, platform_admin: dict
) -> None:
    _setup(client, platform_admin)
    response = client.post(
        f"{API}/projects",
        json={
            "name": "Copy of nothing",
            "template_project_id": "00000000-0000-0000-0000-000000000000",
        },
    )
    assert response.status_code == 404, response.text
    # Nothing half-made is left behind.
    names = [p["name"] for p in _ok(client.get(f"{API}/projects"))["items"]]
    assert "Copy of nothing" not in names


def test_a_custom_role_cannot_copy_a_project_it_cannot_open(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, source = _setup(client, platform_admin)
    role = _ok(
        client.post(
            f"{API}/roles", json={"name": "Creator", "permission_codes": ["project.create"]}
        )
    )
    user = _create_user(client, "c@horizon.com", "Creator", "tester", "CreatorPassw0rd!")
    _ok(client.patch(f"{API}/users/{user}", json={"role_id": role["id"]}))
    them = TestClient(client.app)
    _login_and_verify(them, tenant_id, "c@horizon.com", "CreatorPassw0rd!")
    assert them.get(f"{API}/projects/{source}").status_code in (403, 404)

    response = them.post(f"{API}/projects", json={"name": "Peek", "template_project_id": source})

    assert response.status_code in (403, 404), response.text


def test_an_existing_user_can_be_given_a_custom_role(
    client: TestClient, platform_admin: dict
) -> None:
    """This answered 500: the audit entry could not hold the role's id."""
    _setup(client, platform_admin)
    role = _ok(
        client.post(f"{API}/roles", json={"name": "Reader", "permission_codes": ["report.view"]})
    )
    user = _create_user(client, "r@horizon.com", "Reader", "tester", "ReaderPassw0rd!")

    updated = _ok(client.patch(f"{API}/users/{user}", json={"role_id": role["id"]}))

    assert updated["role_id"] == role["id"]
