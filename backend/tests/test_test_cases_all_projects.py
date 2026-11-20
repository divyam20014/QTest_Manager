"""ADR-077: GET /test-cases -- the per-project test case listing, across every
project the caller may see (the Test Repository used to ask each project
separately whenever a filter was on)."""

from fastapi.testclient import TestClient

from tests.test_execution import (
    _create_approved_case,
    _create_project,
    _create_user,
    _login_and_verify,
    _setup_admin_project_and_case,
)


def _ids(response) -> set[str]:
    assert response.status_code == 200, response.text
    return {c["id"] for c in response.json()["data"]["items"]}


def _two_projects(client: TestClient, platform_admin: dict):
    tenant_id, project_a, case_a = _setup_admin_project_and_case(client, platform_admin)
    project_b = _create_project(client, "Beacon Health Claims")
    case_b = _create_approved_case(client, project_b["id"], "Verify Pre-authorisation Limit")
    return tenant_id, project_a, case_a, project_b, case_b


def test_lists_every_project_and_matches_the_per_project_listings(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_a, case_a, project_b, case_b = _two_projects(client, platform_admin)

    everything = client.get("/api/v1/test-cases")
    assert _ids(everything) == {case_a["id"], case_b["id"]}
    body = everything.json()["data"]
    assert body["total"] == 2
    assert {c["project_id"] for c in body["items"]} == {project_a["id"], project_b["id"]}

    per_project = set()
    for project in (project_a, project_b):
        per_project |= _ids(client.get(f"/api/v1/projects/{project['id']}/test-cases"))
    assert per_project == _ids(everything)


def test_filters_sorting_and_paging_apply_across_projects(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_a, case_a, project_b, case_b = _two_projects(client, platform_admin)
    low = client.post(
        f"/api/v1/projects/{project_b['id']}/test-cases",
        json={
            "title": "Verify Salvage Valuation",
            "priority": "Low",
            "steps": [{"action": "Open", "expected": "Opens"}],
        },
    ).json()["data"]

    # search, priority and status filters
    assert _ids(client.get("/api/v1/test-cases", params={"search": "salvage"})) == {low["id"]}
    assert _ids(client.get("/api/v1/test-cases", params={"priority": "Low"})) == {low["id"]}
    assert _ids(client.get("/api/v1/test-cases", params={"priority": "High"})) == {
        case_a["id"],
        case_b["id"],
    }
    drafts = client.get("/api/v1/test-cases", params={"status": "draft"})
    assert _ids(drafts) == {low["id"]}
    assert drafts.json()["data"]["total"] == 1

    # sorting is by the same keys as the per-project list; paging keeps `total`
    newest_first = client.get("/api/v1/test-cases", params={"sort": "-created_at"}).json()["data"]
    assert [c["id"] for c in newest_first["items"]][0] == low["id"]
    page_one = client.get("/api/v1/test-cases", params={"page_size": 2, "page": 1}).json()["data"]
    page_two = client.get("/api/v1/test-cases", params={"page_size": 2, "page": 2}).json()["data"]
    assert page_one["total"] == page_two["total"] == 3
    assert len(page_one["items"]) == 2 and len(page_two["items"]) == 1
    assert {c["id"] for c in page_one["items"]}.isdisjoint({c["id"] for c in page_two["items"]})


def test_a_tester_only_gets_cases_from_projects_they_belong_to(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project_a, case_a, project_b, case_b = _two_projects(client, platform_admin)
    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project_a['id']}/members", json={"user_id": tester_id})

    tester = TestClient(client.app)
    _login_and_verify(tester, tenant_id, "tester@horizon.com", "TesterPassw0rd!")

    visible = tester.get("/api/v1/test-cases")
    assert _ids(visible) == {case_a["id"]}
    assert visible.json()["data"]["total"] == 1
    # A filter that would match the other project's case must not leak it.
    assert _ids(tester.get("/api/v1/test-cases", params={"search": "Pre-authorisation"})) == set()
    # Exactly what the per-project endpoint allows: the other project is refused.
    assert tester.get(f"/api/v1/projects/{project_b['id']}/test-cases").status_code == 403


def test_another_tenant_sees_none_of_these_cases(
    client: TestClient, platform_admin: dict
) -> None:
    _two_projects(client, platform_admin)
    other = client.post(
        "/api/v1/platform/tenants",
        headers=platform_admin["headers"],
        json={
            "tenant_name": "Other Mutual",
            "admin_name": "Other Admin",
            "admin_email": "admin@other.com",
            "admin_password": "AdminPassw0rd!",
        },
    ).json()["data"]
    other_client = TestClient(client.app)
    _login_and_verify(other_client, other["tenant"]["id"], "admin@other.com", "AdminPassw0rd!")
    response = other_client.get("/api/v1/test-cases")
    assert response.status_code == 200
    assert response.json()["data"] == {"items": [], "total": 0}


def test_requires_a_signed_in_session(client: TestClient) -> None:
    assert client.get("/api/v1/test-cases").status_code == 401
