"""ADR-148 (Phase 3A): requirement ids, details, safe saves and kept history."""

from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from tests.test_task_planning import (
    API,
    _bootstrap_tenant,
    _create_project,
    _login_and_verify,
    _ok,
    _sign_in,
    _task,
)


@pytest.fixture
def world(client: TestClient, platform_admin: dict) -> dict:
    tenant_id = _bootstrap_tenant(client, platform_admin)["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    return {
        "tenant_id": tenant_id,
        "project": _create_project(client)["id"],
        "other": _create_project(client, "Other project")["id"],
    }


def _requirement(client: TestClient, project: str, title: str = "Claims are validated", **extra):
    body = {"title": title, **extra}
    return _ok(client.post(f"{API}/projects/{project}/requirements", json=body))


def _patch(client: TestClient, requirement: dict, **changes):
    return client.patch(f"{API}/requirements/{requirement['id']}", json=changes)


def _read(client: TestClient, requirement: dict) -> dict:
    return _ok(client.get(f"{API}/requirements/{requirement['id']}"))


def _versions(client: TestClient, requirement: dict) -> list[int]:
    data = _ok(client.get(f"{API}/requirements/{requirement['id']}/versions"))
    return sorted(v["version_number"] for v in data)


def test_requirements_are_numbered_and_start_with_defaults(
    client: TestClient, world: dict
) -> None:
    first = _requirement(client, world["project"])
    second = _requirement(client, world["other"], "Another requirement")

    assert [first["display_id"], second["display_id"]] == ["REQ_000001", "REQ_000002"]
    assert (first["requirement_type"], first["priority"], first["status"]) == (
        "Functional",
        "Medium",
        "draft",
    )
    assert first["owner_id"] is None and first["row_version"] == 1


def test_simultaneous_creates_never_share_a_number(client: TestClient, world: dict) -> None:
    with ThreadPoolExecutor(max_workers=4) as pool:
        made = list(
            pool.map(
                lambda n: _requirement(client, world["project"], f"Requirement {n}"), range(8)
            )
        )
    assert len({r["display_id"] for r in made}) == 8


def test_details_are_set_and_changed_without_a_new_version(
    client: TestClient, world: dict
) -> None:
    me = _ok(client.get(f"{API}/auth/me"))["user_id"]
    _ok(client.post(f"{API}/projects/{world['project']}/members", json={"user_id": me}))
    made = _requirement(
        client, world["project"], requirement_type="Business rule", priority="High", owner_id=me
    )
    assert made["owner_name"]

    changed = _ok(
        _patch(client, made, requirement_type="Non-functional", priority="Low", owner_id=None)
    )

    assert (changed["requirement_type"], changed["priority"], changed["owner_id"]) == (
        "Non-functional",
        "Low",
        None,
    )
    assert changed["row_version"] == 2 and _versions(client, made) == [1]
    history = _ok(client.get(f"{API}/requirements/{made['id']}/history"))
    assert history[-1]["action"] == "requirement.details_changed"


def test_wrong_details_are_refused_and_nothing_is_saved(client: TestClient, world: dict) -> None:
    made = _requirement(client, world["project"])
    outsider = _sign_in(client, {**world, "project": world["other"]}, "out", "tester")
    outsider_id = _ok(outsider.get(f"{API}/auth/me"))["user_id"]

    for changes, field in (
        ({"requirement_type": "Epic"}, "requirement_type"),
        ({"priority": "Urgent"}, "priority"),
        ({"priority": None}, "priority"),
        ({"status": None}, "status"),
        ({"owner_id": outsider_id}, "owner_id"),
    ):
        response = _patch(client, made, title="A new title here", **changes)
        assert response.status_code == 422, response.text
        assert field in response.json()["error"]["fields"]
    assert _patch(client, made, status="done").status_code == 422
    assert _read(client, made)["title"] == "Claims are validated"
    assert _versions(client, made) == [1]


def test_a_new_version_is_made_only_when_the_wording_changes(
    client: TestClient, world: dict
) -> None:
    made = _requirement(client, world["project"], description="Within two days")

    same = _ok(_patch(client, made, title=made["title"], description="Within two days"))
    assert (same["version_number"], same["row_version"]) == (1, 1)

    reworded = _ok(_patch(client, made, description="Within one day"))
    assert (reworded["version_number"], reworded["row_version"]) == (2, 2)


def test_rewording_an_approved_requirement_returns_it_to_draft(
    client: TestClient, world: dict
) -> None:
    made = _requirement(client, world["project"])
    assert _ok(_patch(client, made, status="approved"))["status"] == "approved"

    # Details are not wording: approval stays.
    assert _ok(_patch(client, made, priority="High"))["status"] == "approved"

    # A form that sends the old status back with new wording does not keep the approval.
    reworded = _ok(_patch(client, made, title="Claims are checked twice", status="approved"))
    assert reworded["status"] == "draft"

    approved = _ok(_patch(client, made, status="approved"))
    assert approved["status"] == "approved"
    retired = _ok(_patch(client, made, title="Claims were checked", status="retired"))
    assert retired["status"] == "retired"


def test_a_save_from_an_old_copy_is_refused(client: TestClient, world: dict) -> None:
    made = _requirement(client, world["project"])
    _ok(_patch(client, made, priority="High", expected_version=1))

    stale = _patch(client, made, title="Overwrites the other change", expected_version=1)

    assert stale.status_code == 409, stale.text
    assert stale.json()["error"]["code"] == "stale_write"
    assert _read(client, made)["title"] == "Claims are validated"
    _ok(_patch(client, made, title="From the current copy", expected_version=2))


def test_simultaneous_edits_from_one_copy_save_only_once(client: TestClient, world: dict) -> None:
    made = _requirement(client, world["project"])
    with ThreadPoolExecutor(max_workers=4) as pool:
        codes = list(
            pool.map(
                lambda n: _patch(
                    client, made, title=f"Wording number {n}", expected_version=1
                ).status_code,
                range(4),
            )
        )
    assert sorted(codes) == [200, 409, 409, 409]
    assert _versions(client, made) == [1, 2]


# --- deleting ---------------------------------------------------------------------------------


def test_a_deleted_requirement_is_hidden_everywhere_and_keeps_its_history(
    client: TestClient, world: dict, owner_engine
) -> None:
    project = world["project"]
    task = _task(client, project, "Holds requirements")
    gone = _requirement(client, project, "Soon to be deleted", task_id=task["id"])
    kept = _requirement(client, project, "Stays in the project", task_id=task["id"])
    case = _ok(
        client.post(
            f"{API}/projects/{project}/test-cases",
            json={
                "title": "Verify the requirement",
                "priority": "Medium",
                "steps": [{"action": "a", "expected": "b"}],
            },
        )
    )
    _ok(client.post(f"{API}/requirements/{gone['id']}/test-cases", json={"test_case_id": case["id"]}))

    _ok(client.delete(f"{API}/requirements/{gone['id']}"))

    for path in ("", "/versions", "/history"):
        assert client.get(f"{API}/requirements/{gone['id']}{path}").status_code == 404
    assert _patch(client, gone, priority="High").status_code == 404
    assert client.delete(f"{API}/requirements/{gone['id']}").status_code == 404
    listed = _ok(client.get(f"{API}/projects/{project}/requirements"))
    assert [r["id"] for r in listed["items"]] == [kept["id"]] and listed["total"] == 1
    coverage = _ok(client.get(f"{API}/projects/{project}/requirements/coverage"))
    assert (coverage["total_requirements"], coverage["covered_requirements"]) == (1, 0)
    summary = _ok(
        client.get(f"{API}/projects/{project}/requirements/coverage", params={"summary": True})
    )
    assert (summary["total_requirements"], summary["covered_requirements"]) == (1, 0)
    assert _ok(client.get(f"{API}/tasks/{task['id']}"))["requirement_count"] == 1
    rollup = _ok(client.get(f"{API}/tasks/{task['id']}/rollup"))
    assert (rollup["requirements_total"], rollup["requirements_covered"]) == (1, 0)
    assert rollup["test_cases_total"] == 0
    found = client.get(f"{API}/search", params={"q": "Soon to be deleted"})
    assert gone["id"] not in found.text
    linked = client.get(f"{API}/test-cases/{case['id']}/requirements")
    assert gone["id"] not in linked.text

    with owner_engine.connect() as conn:
        counts = conn.execute(
            text(
                "select (select count(*) from requirement_versions where requirement_id = :id), "
                "(select count(*) from requirement_test_case_links where requirement_id = :id), "
                "(select count(*) from requirements where id = :id and deleted_at is not null)"
            ),
            {"id": gone["id"]},
        ).one()
    assert tuple(counts) == (1, 1, 1)


def test_deleting_a_task_whose_only_requirement_was_deleted(
    client: TestClient, world: dict
) -> None:
    task = _task(client, world["project"], "Emptied task")
    gone = _requirement(client, world["project"], task_id=task["id"])
    _ok(client.delete(f"{API}/requirements/{gone['id']}"))

    _ok(client.delete(f"{API}/tasks/{task['id']}"))


def test_a_deleted_requirement_number_is_not_used_again(client: TestClient, world: dict) -> None:
    gone = _requirement(client, world["project"])
    _ok(client.delete(f"{API}/requirements/{gone['id']}"))
    assert _requirement(client, world["project"])["display_id"] == "REQ_000002"


def test_the_number_cannot_be_changed(client: TestClient, world: dict, owner_engine) -> None:
    made = _requirement(client, world["project"])
    with pytest.raises(DBAPIError), owner_engine.begin() as conn:
        conn.execute(
            text("update requirements set display_id = 'REQ_999999' where id = :id"),
            {"id": made["id"]},
        )


# --- lists and permissions ---------------------------------------------------------------------


def test_an_organization_edits_its_types_and_priorities(client: TestClient, world: dict) -> None:
    def options(key: str) -> list[dict]:
        return _ok(client.get(f"{API}/field-options", params={"field_key": key}))

    assert [o["code"] for o in options("requirement_type")] == [
        "Functional",
        "Non-functional",
        "Business rule",
    ]
    assert [o["code"] for o in options("requirement_priority")] == [
        "Critical",
        "High",
        "Medium",
        "Low",
    ]
    made = _requirement(client, world["project"])
    in_use = next(o for o in options("requirement_priority") if o["code"] == "Medium")
    assert client.delete(f"{API}/field-options/{in_use['id']}").status_code == 409
    unused = next(o for o in options("requirement_type") if o["code"] == "Business rule")
    _ok(client.delete(f"{API}/field-options/{unused['id']}"))
    assert _patch(client, made, requirement_type="Business rule").status_code == 422


@pytest.mark.parametrize("role,expected", [("qa_lead", 200), ("viewer", 403)])
def test_changing_status_needs_permission_to_manage_requirements(
    client: TestClient, world: dict, role: str, expected: int
) -> None:
    made = _requirement(client, world["project"])
    them = _sign_in(client, world, "who", role)

    response = _patch(them, made, status="approved")

    assert response.status_code == expected, response.text
    assert them.get(f"{API}/requirements/{made['id']}").status_code == 200
