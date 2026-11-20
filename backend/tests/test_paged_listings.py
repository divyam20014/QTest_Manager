"""ADR-078: server-side paging for the Defects list and the Test Runs overview.

`GET /defects` keeps returning a plain list unless `page_size` is given (the run,
project and test case screens depend on that); `GET /defects/status-counts` feeds
the status tabs; `GET /test-runs` pages runs across every project the caller can see.
"""

from fastapi.testclient import TestClient

from tests.test_brd_phase2 import _create_defect, _make_run
from tests.test_execution import (
    _create_approved_case,
    _create_project,
    _create_user,
    _login_and_verify,
    _setup_admin_project_and_case,
)


def _data(response) -> dict | list:
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _other_tenant_client(client: TestClient, platform_admin: dict) -> TestClient:
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
    return other_client


def _tester_client(client: TestClient, tenant_id: str, project_id: str) -> TestClient:
    """A Tester who belongs to `project_id` only."""
    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project_id}/members", json={"user_id": tester_id})
    tester = TestClient(client.app)
    _login_and_verify(tester, tenant_id, "tester@horizon.com", "TesterPassw0rd!")
    return tester


# ---------------------------------------------------------------- defects


def _defects_in_two_projects(client: TestClient, platform_admin: dict):
    tenant_id, project_a, _case = _setup_admin_project_and_case(client, platform_admin)
    project_b = _create_project(client, "Beacon Health Claims")
    defects = [_create_defect(client, project_a["id"], f"Alpha defect {i}") for i in range(3)]
    defects += [_create_defect(client, project_b["id"], f"Beacon defect {i}") for i in range(2)]
    return tenant_id, project_a, project_b, defects


def test_defects_list_is_still_a_plain_list_without_page_size(
    client: TestClient, platform_admin: dict
) -> None:
    _, _, _, defects = _defects_in_two_projects(client, platform_admin)
    everything = _data(client.get("/api/v1/defects"))
    assert isinstance(everything, list)
    assert {d["id"] for d in everything} == {d["id"] for d in defects}


def test_defects_page_returns_items_and_total_newest_first(
    client: TestClient, platform_admin: dict
) -> None:
    _, _, _, defects = _defects_in_two_projects(client, platform_admin)
    plain_order = [d["id"] for d in _data(client.get("/api/v1/defects"))]

    pages = [
        _data(client.get("/api/v1/defects", params={"page_size": 2, "page": n})) for n in (1, 2, 3)
    ]
    assert [p["total"] for p in pages] == [5, 5, 5]
    assert [len(p["items"]) for p in pages] == [2, 2, 1]
    paged_order = [d["id"] for p in pages for d in p["items"]]
    assert paged_order == plain_order  # same order, nothing repeated or lost
    assert set(paged_order) == {d["id"] for d in defects}


def test_defects_page_filters_by_status_and_project(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_a, project_b, defects = _defects_in_two_projects(client, platform_admin)
    moved = defects[0]["id"]
    assert (
        client.patch(f"/api/v1/defects/{moved}/status", json={"status": "Open"}).status_code == 200
    )

    only_open = _data(client.get("/api/v1/defects", params={"page_size": 10, "status": "Open"}))
    assert only_open["total"] == 1 and only_open["items"][0]["id"] == moved
    in_b = _data(
        client.get("/api/v1/defects", params={"page_size": 10, "project_id": project_b["id"]})
    )
    assert in_b["total"] == 2
    assert {d["project_id"] for d in in_b["items"]} == {project_b["id"]}
    nothing = _data(
        client.get(
            "/api/v1/defects",
            params={"page_size": 10, "project_id": project_a["id"], "status": "Closed"},
        )
    )
    assert nothing == {"items": [], "total": 0}


def test_defect_status_counts_follow_every_filter_except_status(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_a, project_b, defects = _defects_in_two_projects(client, platform_admin)
    client.patch(f"/api/v1/defects/{defects[0]['id']}/status", json={"status": "Open"})

    def counts(**params):
        return _data(client.get("/api/v1/defects/status-counts", params=params))

    assert counts() == {"counts": {"New": 4, "Open": 1}, "total": 5}
    assert counts(project_id=project_a["id"]) == {"counts": {"New": 2, "Open": 1}, "total": 3}
    assert counts(project_id=project_b["id"]) == {"counts": {"New": 2}, "total": 2}


def test_a_tester_gets_only_their_projects_defects_in_pages_and_counts(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project_a, project_b, _ = _defects_in_two_projects(client, platform_admin)
    tester = _tester_client(client, tenant_id, project_a["id"])

    paged = _data(tester.get("/api/v1/defects", params={"page_size": 10}))
    assert paged["total"] == 3
    assert {d["project_id"] for d in paged["items"]} == {project_a["id"]}
    assert _data(tester.get("/api/v1/defects/status-counts"))["total"] == 3
    # The other project is refused outright, as before.
    other = tester.get("/api/v1/defects", params={"page_size": 10, "project_id": project_b["id"]})
    assert other.status_code == 403


def test_another_tenant_sees_no_defects_and_counts_are_empty(
    client: TestClient, platform_admin: dict
) -> None:
    _defects_in_two_projects(client, platform_admin)
    other = _other_tenant_client(client, platform_admin)
    assert _data(other.get("/api/v1/defects", params={"page_size": 10})) == {
        "items": [],
        "total": 0,
    }
    assert _data(other.get("/api/v1/defects/status-counts")) == {"counts": {}, "total": 0}


def test_paged_defect_routes_need_a_session(client: TestClient) -> None:
    assert client.get("/api/v1/defects", params={"page_size": 10}).status_code == 401
    assert client.get("/api/v1/defects/status-counts").status_code == 401


# ------------------------------------------------------------------- runs


def _runs_in_two_projects(client: TestClient, platform_admin: dict):
    tenant_id, project_a, case_a = _setup_admin_project_and_case(client, platform_admin)
    project_b = _create_project(client, "Beacon Health Claims")
    case_b = _create_approved_case(client, project_b["id"], "Verify Pre-authorisation Limit")
    runs = [
        _make_run(client, project_a["id"], [case_a["id"]], name=f"Alpha run {i}") for i in range(3)
    ]
    runs += [
        _make_run(client, project_b["id"], [case_b["id"]], name=f"Beacon run {i}") for i in range(2)
    ]
    return tenant_id, project_a, project_b, runs


def test_runs_overview_pages_across_projects_newest_first(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_a, project_b, runs = _runs_in_two_projects(client, platform_admin)

    pages = [
        _data(client.get("/api/v1/test-runs", params={"page_size": 2, "page": n}))
        for n in (1, 2, 3)
    ]
    assert [p["total"] for p in pages] == [5, 5, 5]
    assert [len(p["items"]) for p in pages] == [2, 2, 1]
    ids = [r["id"] for p in pages for r in p["items"]]
    assert ids == [r["id"] for r in reversed(runs)]  # newest first, none repeated or lost
    projects = {r["project_id"] for p in pages for r in p["items"]}
    assert projects == {project_a["id"], project_b["id"]}
    assert all(r["case_count"] == 1 for p in pages for r in p["items"])


def test_runs_overview_filters_by_project_and_active_only(
    client: TestClient, platform_admin: dict
) -> None:
    _, _, project_b, runs = _runs_in_two_projects(client, platform_admin)
    in_b = _data(client.get("/api/v1/test-runs", params={"project_id": project_b["id"]}))
    assert in_b["total"] == 2 and {r["project_id"] for r in in_b["items"]} == {project_b["id"]}

    assert client.post(f"/api/v1/test-runs/{runs[0]['id']}/finish").status_code == 200
    active = _data(client.get("/api/v1/test-runs", params={"active_only": "true"}))
    assert active["total"] == 4 and runs[0]["id"] not in {r["id"] for r in active["items"]}
    assert _data(client.get("/api/v1/test-runs"))["total"] == 5


def test_runs_overview_excludes_soft_deleted_runs(client: TestClient, platform_admin: dict) -> None:
    _, _, _, runs = _runs_in_two_projects(client, platform_admin)
    assert client.delete(f"/api/v1/test-runs/{runs[1]['id']}").status_code == 200
    listing = _data(client.get("/api/v1/test-runs"))
    assert listing["total"] == 4 and runs[1]["id"] not in {r["id"] for r in listing["items"]}


def test_a_tester_sees_only_runs_in_their_projects_and_is_refused_the_rest(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project_a, project_b, _runs = _runs_in_two_projects(client, platform_admin)
    tester = _tester_client(client, tenant_id, project_a["id"])

    visible = _data(tester.get("/api/v1/test-runs"))
    assert visible["total"] == 3
    assert {r["project_id"] for r in visible["items"]} == {project_a["id"]}
    assert (
        tester.get("/api/v1/test-runs", params={"project_id": project_b["id"]}).status_code == 403
    )


def test_another_tenant_sees_no_runs_and_the_route_needs_a_session(
    client: TestClient, platform_admin: dict
) -> None:
    _runs_in_two_projects(client, platform_admin)
    other = _other_tenant_client(client, platform_admin)
    assert _data(other.get("/api/v1/test-runs")) == {"items": [], "total": 0}
    assert TestClient(client.app).get("/api/v1/test-runs").status_code == 401
