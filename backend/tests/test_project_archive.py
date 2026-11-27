"""ADR-140 (Phase 1B): an archived project is read-only until it is restored."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from tests.test_execution import (
    _bootstrap_tenant,
    _create_approved_case,
    _create_project,
    _create_user,
    _login_and_verify,
    _sample_steps,
)

API = "/api/v1"


def _ok(response):
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _refused(response, what: str = "") -> None:
    assert response.status_code == 409, (what, response.status_code, response.text[:300])
    assert response.json()["error"]["code"] == "project_archived", (what, response.text[:300])


@pytest.fixture
def world(client: TestClient, platform_admin: dict) -> dict:
    """A project with one of everything people write to, plus a second active project."""
    tenant_id = _bootstrap_tenant(client, platform_admin)["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project = _create_project(client, "To be archived")["id"]
    other = _create_project(client, "Still active")["id"]
    case = _create_approved_case(client, project, "Case in the project")
    run = _ok(
        client.post(
            f"{API}/projects/{project}/test-runs",
            json={"name": "Run one", "run_type": "Smoke", "test_case_ids": [case["id"]]},
        )
    )
    run_case = run["cases"][0]["id"]
    step = _ok(client.get(f"{API}/test-run-cases/{run_case}/steps"))[0]["id"]
    defect = _ok(
        client.post(
            f"{API}/defects",
            json={"project_id": project, "title": "Defect in the project", "severity": "Major"},
        )
    )["id"]
    task = _ok(client.post(f"{API}/projects/{project}/tasks", json={"title": "A task"}))["id"]
    return {
        "tenant_id": tenant_id,
        "project": project,
        "other": other,
        "case": case["id"],
        "run": run["id"],
        "step": step,
        "defect": defect,
        "task": task,
    }


def _archive(client: TestClient, project_id: str) -> dict:
    return _ok(client.post(f"{API}/projects/{project_id}/archive"))


def _writes(client: TestClient, w: dict) -> dict:
    p = w["project"]
    return {
        "edit project": lambda: client.patch(f"{API}/projects/{p}", json={"name": "Renamed"}),
        "create case": lambda: client.post(
            f"{API}/projects/{p}/test-cases",
            json={"title": "Too late to add", "priority": "Low", "steps": _sample_steps()},
        ),
        "edit case": lambda: client.patch(
            f"{API}/test-cases/{w['case']}", json={"priority": "Low"}
        ),
        "deprecate case": lambda: client.post(f"{API}/test-cases/{w['case']}/deprecate"),
        "comment on case": lambda: client.post(
            f"{API}/test-cases/{w['case']}/comments", json={"body": "Hello"}
        ),
        "create defect": lambda: client.post(
            f"{API}/defects",
            json={"project_id": p, "title": "Too late to report", "severity": "Major"},
        ),
        "edit defect": lambda: client.patch(
            f"{API}/defects/{w['defect']}", json={"priority": "Low"}
        ),
        "move defect": lambda: client.patch(
            f"{API}/defects/{w['defect']}/status", json={"status": "Open"}
        ),
        "attach to defect": lambda: client.post(
            f"{API}/defects/{w['defect']}/attachments",
            files={"file": ("note.txt", b"hello", "text/plain")},
        ),
        "record a verdict": lambda: client.post(
            f"{API}/execution-steps/{w['step']}/verdict", json={"verdict": "pass"}
        ),
        "new run": lambda: client.post(
            f"{API}/projects/{p}/test-runs",
            json={"name": "Run two", "run_type": "Smoke", "test_case_ids": [w["case"]]},
        ),
        "delete run": lambda: client.delete(f"{API}/test-runs/{w['run']}"),
        "new task": lambda: client.post(f"{API}/projects/{p}/tasks", json={"title": "Another"}),
        "comment on task": lambda: client.post(
            f"{API}/tasks/{w['task']}/comments", json={"body": "Hello"}
        ),
        "new module": lambda: client.post(f"{API}/projects/{p}/modules", json={"name": "Late"}),
        "new release": lambda: client.post(f"{API}/projects/{p}/releases", json={"name": "R9"}),
        "new suite": lambda: client.post(f"{API}/projects/{p}/test-suites", json={"name": "S9"}),
    }


def test_every_kind_of_write_is_refused_and_reading_still_works(
    client: TestClient, world: dict
) -> None:
    before = _ok(client.get(f"{API}/test-cases/{world['case']}"))
    archived = _archive(client, world["project"])
    assert archived["archived_at"]

    for what, write in _writes(client, world).items():
        _refused(write(), what)

    assert _ok(client.get(f"{API}/test-cases/{world['case']}")) == before
    for path in (
        f"/projects/{world['project']}",
        f"/projects/{world['project']}/test-cases",
        f"/projects/{world['project']}/test-runs",
        f"/projects/{world['project']}/tasks",
        f"/projects/{world['project']}/requirements",
        f"/projects/{world['project']}/dashboard",
        f"/test-runs/{world['run']}",
        f"/defects/{world['defect']}",
        f"/tasks/{world['task']}",
        f"/test-cases/{world['case']}/comments",
    ):
        assert client.get(API + path).status_code == 200, path


def test_the_database_refuses_even_without_the_application_check(
    client: TestClient, world: dict, owner_engine
) -> None:
    _archive(client, world["project"])
    for statement in (
        "update defects set title = 'Changed behind the back' where id = :defect",
        "delete from execution_steps where id = :step",
        "update tasks set title = 'Changed behind the back' where id = :task",
    ):
        with pytest.raises(DBAPIError, match="archived"):
            with owner_engine.begin() as conn:
                conn.execute(text(statement), world)


def test_other_projects_are_unaffected_and_records_cannot_be_moved_in(
    client: TestClient, world: dict
) -> None:
    _archive(client, world["project"])
    created = _ok(
        client.post(
            f"{API}/projects/{world['other']}/test-cases",
            json={"title": "Work goes on here", "priority": "Low", "steps": _sample_steps()},
        )
    )
    assert _ok(client.patch(f"{API}/test-cases/{created['id']}", json={"priority": "High"}))


def test_archived_projects_leave_the_active_list_and_can_be_listed(
    client: TestClient, world: dict
) -> None:
    _archive(client, world["project"])

    active = _ok(client.get(f"{API}/projects"))
    assert [p["name"] for p in active["items"]] == ["Still active"]
    assert active["total"] == 1
    archived = _ok(client.get(f"{API}/projects", params={"archived": "true"}))
    assert [p["name"] for p in archived["items"]] == ["To be archived"]
    # Its records stay in history that spans projects.
    assert world["defect"] in {d["id"] for d in _ok(client.get(f"{API}/defects"))}


def test_restoring_makes_it_writable_again(client: TestClient, world: dict) -> None:
    _archive(client, world["project"])
    assert client.post(f"{API}/projects/{world['project']}/archive").status_code == 409

    restored = _ok(client.post(f"{API}/projects/{world['project']}/restore"))

    assert restored["archived_at"] is None
    assert client.post(f"{API}/projects/{world['project']}/restore").status_code == 409
    assert _ok(client.patch(f"{API}/defects/{world['defect']}", json={"priority": "Low"}))
    events = _ok(client.get(f"{API}/audit-logs", params={"page_size": 100}))
    actions = [e["action"] for e in events]
    assert {"project.archived", "project.restored"} <= set(actions)


@pytest.mark.parametrize(
    "role,assigned,expected",
    [("manager", True, 200), ("manager", False, 403), ("tester", True, 403)],
)
def test_only_an_admin_or_assigned_manager_may_archive(
    client: TestClient, world: dict, role: str, assigned: bool, expected: int
) -> None:
    user = _create_user(client, "who@horizon.com", "Who", role, "WhoPassw0rd!!")
    if assigned:
        _ok(client.post(f"{API}/projects/{world['project']}/members", json={"user_id": user}))
    them = TestClient(client.app)
    _login_and_verify(them, world["tenant_id"], "who@horizon.com", "WhoPassw0rd!!")

    response = them.post(f"{API}/projects/{world['project']}/archive")

    assert response.status_code == expected, response.text


def test_organization_wide_housekeeping_still_works(client: TestClient, world: dict) -> None:
    """These reach into every project, archived ones included."""
    member = _create_user(client, "leaver@horizon.com", "Leaver", "tester", "LeaverPassw0rd!")
    _ok(client.post(f"{API}/projects/{world['project']}/members", json={"user_id": member}))
    field = _ok(
        client.post(
            f"{API}/custom-fields/definitions",
            json={
                "entity_type": "defect",
                "field_key": "ticket",
                "label": "Ticket",
                "field_type": "text",
            },
        )
    )
    values = f"{API}/custom-fields/values/defect/{world['defect']}"
    _ok(client.put(values, json={"values": {"ticket": "OPS-1"}}))
    _archive(client, world["project"])

    # Writing a value is a change to the project; removing the whole field is not.
    _refused(client.put(values, json={"values": {"ticket": "OPS-2"}}), "custom value")
    deleted = client.delete(f"{API}/custom-fields/definitions/{field['id']}")
    assert deleted.status_code == 200, deleted.text
    erased = client.post(
        f"{API}/users/{member}/erase",
        json={"dry_run": False, "confirm_email": "leaver@horizon.com"},
    )
    assert erased.status_code == 200, erased.text


def test_the_sla_sweep_skips_archived_projects(
    client: TestClient, world: dict, owner_engine, db_session
) -> None:
    from app.services import defect_service

    with owner_engine.begin() as conn:
        conn.execute(
            text("update defects set created_at = now() - interval '400 days' where id = :defect"),
            world,
        )
    _archive(client, world["project"])

    assert defect_service.sweep_sla_breaches(db_session) == 0


def test_an_empty_archived_project_can_still_be_deleted(client: TestClient, world: dict) -> None:
    empty = _ok(client.post(f"{API}/projects", json={"name": "Never used"}))["id"]
    _archive(client, empty)
    deleted = client.delete(f"{API}/projects/{empty}")
    assert deleted.status_code == 200, deleted.text
