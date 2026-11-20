"""ADR-079: the Dashboard can be narrowed to one project.

`GET /dashboard/summary` and `GET /dashboard/activity-stream` take an optional
`project_id`. The property that matters is that nothing is lost or double counted:
the tenant-wide summary equals the sum of the per-project summaries.
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


def _two_projects_with_different_data(client: TestClient, platform_admin: dict):
    """Project A: 2 cases, 1 run, 2 defects. Project B: 1 case, 2 runs, 1 defect."""
    tenant_id, project_a, case_a1 = _setup_admin_project_and_case(client, platform_admin)
    case_a2 = _create_approved_case(client, project_a["id"], "Verify Salvage Valuation")
    project_b = _create_project(client, "Beacon Health Claims")
    case_b1 = _create_approved_case(client, project_b["id"], "Verify Pre-authorisation Limit")

    _make_run(client, project_a["id"], [case_a1["id"], case_a2["id"]], name="Alpha run")
    run_b1 = _make_run(client, project_b["id"], [case_b1["id"]], name="Beacon run 1")
    _make_run(client, project_b["id"], [case_b1["id"]], name="Beacon run 2")
    assert client.post(f"/api/v1/test-runs/{run_b1['id']}/finish").status_code == 200

    defects_a = [_create_defect(client, project_a["id"], f"Alpha defect {i}") for i in range(2)]
    defect_b = _create_defect(client, project_b["id"], "Beacon defect")
    return tenant_id, project_a, project_b, defects_a, defect_b


def _summary(client: TestClient, **params) -> dict:
    return _data(client.get("/api/v1/dashboard/summary", params=params))  # type: ignore[return-value]


def test_a_project_summary_counts_only_that_project(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_a, project_b, _, _ = _two_projects_with_different_data(client, platform_admin)

    a = _summary(client, project_id=project_a["id"])
    assert a["projects"]["total"] == 1
    assert a["test_cases"]["total"] == 2
    assert a["test_runs"]["active"] == 1
    assert sum(a["defects"]["open_by_severity"].values()) == 2

    b = _summary(client, project_id=project_b["id"])
    assert b["projects"]["total"] == 1
    assert b["test_cases"]["total"] == 1
    assert b["test_runs"]["active"] == 1  # the other Beacon run was finished
    assert sum(b["defects"]["open_by_severity"].values()) == 1


def test_the_tenant_wide_summary_is_the_sum_of_the_project_summaries(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_a, project_b, _, _ = _two_projects_with_different_data(client, platform_admin)
    everything = _summary(client)
    a = _summary(client, project_id=project_a["id"])
    b = _summary(client, project_id=project_b["id"])

    assert everything["projects"]["total"] == a["projects"]["total"] + b["projects"]["total"] == 2
    assert everything["test_cases"]["total"] == a["test_cases"]["total"] + b["test_cases"]["total"]
    assert everything["test_runs"]["active"] == a["test_runs"]["active"] + b["test_runs"]["active"]
    for severity, count in everything["defects"]["open_by_severity"].items():
        per_project = a["defects"]["open_by_severity"].get(severity, 0) + b["defects"][
            "open_by_severity"
        ].get(severity, 0)
        assert count == per_project, severity
    # A project filter never changes the unfiltered answer.
    assert everything == _summary(client)


def test_an_unknown_or_other_tenants_project_gives_an_empty_summary(
    client: TestClient, platform_admin: dict
) -> None:
    _two_projects_with_different_data(client, platform_admin)
    nothing = _summary(client, project_id="00000000-0000-0000-0000-000000000000")
    assert nothing["projects"]["total"] == 0
    assert nothing["test_cases"]["total"] == 0
    assert nothing["test_runs"]["active"] == 0
    assert nothing["defects"]["open_by_severity"] == {}


def test_a_tester_only_gets_numbers_for_projects_they_belong_to(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project_a, project_b, _, _ = _two_projects_with_different_data(
        client, platform_admin
    )
    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project_a['id']}/members", json={"user_id": tester_id})
    tester = TestClient(client.app)
    _login_and_verify(tester, tenant_id, "tester@horizon.com", "TesterPassw0rd!")

    mine = _summary(tester, project_id=project_a["id"])
    assert mine["test_cases"]["total"] == 2
    theirs = _summary(tester, project_id=project_b["id"])
    assert theirs["projects"]["total"] == 0 and theirs["test_cases"]["total"] == 0
    assert theirs["defects"]["open_by_severity"] == {}
    # And without a filter they still see only their own project.
    assert _summary(tester)["projects"]["total"] == 1


def _stream(client: TestClient, **params) -> list[dict]:
    return _data(client.get("/api/v1/dashboard/activity-stream", params=params))  # type: ignore[return-value]


def test_the_activity_stream_can_be_narrowed_to_a_project(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_a, project_b, defects_a, defect_b = _two_projects_with_different_data(
        client, platform_admin
    )
    in_a = _stream(client, project_id=project_a["id"])
    in_a_entities = {e["entity_id"] for e in in_a}
    assert {d["id"] for d in defects_a} <= in_a_entities
    assert defect_b["id"] not in in_a_entities

    in_b = _stream(client, project_id=project_b["id"])
    assert defect_b["id"] in {e["entity_id"] for e in in_b}
    assert not ({d["id"] for d in defects_a} & {e["entity_id"] for e in in_b})
    assert len(in_a) <= 10 and len(in_b) <= 10
    # Newest first, like the unfiltered stream.
    stamps = [e["created_at"] for e in in_a]
    assert stamps == sorted(stamps, reverse=True)


def test_activity_for_a_project_a_tester_cannot_see_is_empty_and_the_routes_need_a_session(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project_a, project_b, _, _ = _two_projects_with_different_data(
        client, platform_admin
    )
    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project_a['id']}/members", json={"user_id": tester_id})
    tester = TestClient(client.app)
    _login_and_verify(tester, tenant_id, "tester@horizon.com", "TesterPassw0rd!")

    assert _stream(tester, project_id=project_b["id"]) == []
    anonymous = TestClient(client.app)
    assert anonymous.get("/api/v1/dashboard/summary").status_code == 401
    assert anonymous.get("/api/v1/dashboard/activity-stream").status_code == 401
