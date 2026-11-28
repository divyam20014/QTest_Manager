"""ADR-149 and ADR-150 (Phase 3B, 3C): acceptance criteria, the project view and links that
know which wording they cover."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, text
from sqlalchemy.engine import Engine
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
    return {"tenant_id": tenant_id, "project": _create_project(client)["id"]}


def _requirement(client: TestClient, project: str, title: str = "Claims are validated", **extra):
    body = {"title": title, **extra}
    return _ok(client.post(f"{API}/projects/{project}/requirements", json=body))


def _case(client: TestClient, project: str, title: str = "Verify validation") -> dict:
    body = {"title": title, "priority": "Medium", "steps": [{"action": "a", "expected": "b"}]}
    return _ok(client.post(f"{API}/projects/{project}/test-cases", json=body))


def _link(client: TestClient, requirement: dict, case: dict) -> None:
    url = f"{API}/requirements/{requirement['id']}/test-cases"
    _ok(client.post(url, json={"test_case_id": case["id"]}))


def _patch(client: TestClient, requirement: dict, **changes) -> dict:
    return _ok(client.patch(f"{API}/requirements/{requirement['id']}", json=changes))


def _read(client: TestClient, requirement: dict) -> dict:
    return _ok(client.get(f"{API}/requirements/{requirement['id']}"))


def _confirm(client: TestClient, requirement: dict, case: dict, version: int):
    url = f"{API}/requirements/{requirement['id']}/test-cases/{case['id']}/confirm"
    return client.post(url, json={"version_number": version})


def _list(client: TestClient, project: str, **params) -> dict:
    return _ok(client.get(f"{API}/projects/{project}/requirements", params=params))


def _titles(client: TestClient, project: str, **params) -> list[str]:
    return sorted(r["title"] for r in _list(client, project, **params)["items"])


def _coverage(client: TestClient, project: str, **params) -> dict:
    url = f"{API}/projects/{project}/requirements/coverage"
    return _ok(client.get(url, params=params))


def _matrix(client: TestClient, project: str, suffix: str = ""):
    return client.get(f"{API}/reports/traceability-matrix{suffix}", params={"project_id": project})


# --- acceptance criteria -----------------------------------------------------------------------


def test_each_version_keeps_its_own_acceptance_criteria(client: TestClient, world: dict) -> None:
    made = _requirement(
        client, world["project"], acceptance_criteria=["  Answered in 2 days ", "Logged"]
    )
    assert made["acceptance_criteria"] == ["Answered in 2 days", "Logged"]

    kept = _patch(client, made, description="More detail")
    assert kept["acceptance_criteria"] == ["Answered in 2 days", "Logged"]
    swapped = _patch(client, made, acceptance_criteria=["Logged", "Answered in 2 days"])
    assert swapped["version_number"] == 3  # the order is part of the wording
    same = _patch(client, made, acceptance_criteria=["Logged", "Answered in 2 days"])
    assert same["version_number"] == 3
    assert _patch(client, made, acceptance_criteria=[])["acceptance_criteria"] == []

    versions = _ok(client.get(f"{API}/requirements/{made['id']}/versions"))
    by_number = {v["version_number"]: v["acceptance_criteria"] for v in versions}
    assert by_number == {
        1: ["Answered in 2 days", "Logged"],
        2: ["Answered in 2 days", "Logged"],
        3: ["Logged", "Answered in 2 days"],
        4: [],
    }


@pytest.mark.parametrize("criteria", [["   "], ["x" * 2001], ["ok"] * 51])
def test_wrong_acceptance_criteria_are_refused(
    client: TestClient, world: dict, criteria: list[str]
) -> None:
    response = client.post(
        f"{API}/projects/{world['project']}/requirements",
        json={"title": "Claims are validated", "acceptance_criteria": criteria},
    )
    assert response.status_code == 422, response.text


# --- the project view --------------------------------------------------------------------------


def test_the_project_list_filters(client: TestClient, world: dict) -> None:
    project = world["project"]
    me = _ok(client.get(f"{API}/auth/me"))["user_id"]
    _ok(client.post(f"{API}/projects/{project}/members", json={"user_id": me}))
    one = _requirement(client, project, "Alpha 100% match", priority="High", owner_id=me)
    _requirement(client, project, "Bravo rule", requirement_type="Business rule")
    three = _requirement(client, project, "Charlie rule", status="approved")
    _link(client, three, _case(client, project))

    assert _titles(client, project, q="rule") == ["Bravo rule", "Charlie rule"]
    assert _titles(client, project, q=one["display_id"]) == ["Alpha 100% match"]
    # The search is for the text typed: % is not a wildcard.
    assert _titles(client, project, q="100%") == ["Alpha 100% match"]
    assert _titles(client, project, q="1%h") == []
    assert _titles(client, project, priority="High") == ["Alpha 100% match"]
    assert _titles(client, project, owner_id=me) == ["Alpha 100% match"]
    assert _titles(client, project, requirement_type="Business rule") == ["Bravo rule"]
    assert _titles(client, project, status="approved") == ["Charlie rule"]
    assert _titles(client, project, covered=True) == ["Charlie rule"]
    assert _titles(client, project, covered=False) == ["Alpha 100% match", "Bravo rule"]
    assert _titles(client, project, covered=False, q="rule") == ["Bravo rule"]
    page = _list(client, project, page_size=2, page=2)
    assert (page["total"], len(page["items"])) == (3, 1)


# --- links and review ---------------------------------------------------------------------------


def test_new_wording_marks_linked_tests_until_someone_confirms(
    client: TestClient, world: dict
) -> None:
    project = world["project"]
    requirement = _requirement(client, project, status="approved")
    case = _case(client, project)
    _link(client, requirement, case)
    link = _read(client, requirement)["linked_test_cases"][0]
    assert (link["covers_version_number"], link["needs_review"]) == (1, False)

    # Not wording: nothing to review.
    task = _task(client, project, "Another task")
    _patch(client, requirement, priority="High", status="approved", task_id=task["id"])
    assert _read(client, requirement)["review_count"] == 0

    _patch(client, requirement, acceptance_criteria=["Within one day"])

    detail = _read(client, requirement)
    assert detail["review_count"] == 1
    assert detail["linked_test_cases"][0]["needs_review"] is True
    assert detail["linked_test_cases"][0]["covers_version_number"] == 1
    assert _titles(client, project, needs_review=True) == [requirement["title"]]
    assert _titles(client, project, needs_review=False) == []
    assert _coverage(client, project)["requirements_needing_review"] == 1
    assert _matrix(client, project).json()["data"]["entries"][0]["review_count"] == 1
    on_case = _ok(client.get(f"{API}/test-cases/{case['id']}/requirements"))
    assert on_case[0]["needs_review"] is True and on_case[0]["status"] == "draft"

    confirmed = _ok(_confirm(client, requirement, case, 2))

    assert confirmed["review_count"] == 0
    assert confirmed["linked_test_cases"][0]["covers_version_number"] == 2
    assert _titles(client, project, needs_review=True) == []
    history = _ok(client.get(f"{API}/requirements/{requirement['id']}/history"))
    assert history[-1]["action"] == "requirement.link_confirmed"


def test_wording_nobody_has_seen_cannot_be_confirmed(client: TestClient, world: dict) -> None:
    requirement = _requirement(client, world["project"])
    case = _case(client, world["project"])
    _link(client, requirement, case)
    _patch(client, requirement, title="The second wording")
    _patch(client, requirement, title="The third wording")

    stale = _confirm(client, requirement, case, 2)

    assert stale.status_code == 409, stale.text
    assert stale.json()["error"]["code"] == "stale_write"
    assert _read(client, requirement)["review_count"] == 1
    other = _case(client, world["project"], "Not linked")
    assert _confirm(client, requirement, other, 3).status_code == 404


def test_older_links_say_the_version_is_not_recorded(
    client: TestClient, world: dict, owner_engine
) -> None:
    requirement = _requirement(client, world["project"])
    case = _case(client, world["project"])
    _link(client, requirement, case)
    # As the migration leaves a link that existed before versions were recorded.
    with owner_engine.begin() as conn:
        conn.execute(
            text(
                "update requirement_test_case_links set "
                "unrecorded_baseline_version_id = requirement_version_id, "
                "requirement_version_id = null where requirement_id = :id"
            ),
            {"id": requirement["id"]},
        )
    link = _read(client, requirement)["linked_test_cases"][0]
    assert (link["covers_version_number"], link["needs_review"]) == (None, False)

    _patch(client, requirement, description="Changed after recording began")

    link = _read(client, requirement)["linked_test_cases"][0]
    assert (link["covers_version_number"], link["needs_review"]) == (None, True)
    confirmed = _ok(_confirm(client, requirement, case, 2))
    assert confirmed["linked_test_cases"][0]["covers_version_number"] == 2


def test_a_link_cannot_name_another_requirements_version(
    client: TestClient, world: dict, owner_engine
) -> None:
    first = _requirement(client, world["project"], "First requirement")
    second = _requirement(client, world["project"], "Second requirement")
    _link(client, first, _case(client, world["project"]))

    with pytest.raises(DBAPIError), owner_engine.begin() as conn:
        conn.execute(
            text(
                "update requirement_test_case_links set requirement_version_id = "
                "(select current_version_id from requirements where id = :other) "
                "where requirement_id = :id"
            ),
            {"id": first["id"], "other": second["id"]},
        )


def test_deleted_test_cases_ask_for_no_review(client: TestClient, world: dict) -> None:
    requirement = _requirement(client, world["project"])
    case = _case(client, world["project"])
    _link(client, requirement, case)
    _patch(client, requirement, title="The second wording")
    _ok(client.delete(f"{API}/test-cases/{case['id']}"))

    assert _read(client, requirement)["review_count"] == 0
    assert _titles(client, world["project"], needs_review=True) == []


def test_retired_requirements_are_left_out_of_coverage_and_review(
    client: TestClient, world: dict
) -> None:
    project = world["project"]
    task = _task(client, project, "Holds requirements")
    live = _requirement(client, project, "Still applies", task_id=task["id"])
    old = _requirement(client, project, "No longer applies", task_id=task["id"])
    case = _case(client, project)
    _link(client, live, case)
    _link(client, old, case)
    _patch(client, old, title="No longer applies at all")
    assert _coverage(client, project)["requirements_needing_review"] == 1

    _patch(client, old, status="retired")

    for summary in (False, True):
        report = _coverage(client, project, summary=summary)
        assert report["total_requirements"] == 1
        assert report["coverage_percentage"] == 100.0
        assert report["retired_requirements"] == 1
        assert report["requirements_needing_review"] == 0
    assert [e["requirement_title"] for e in _coverage(client, project)["requirements"]] == [
        "Still applies"
    ]
    matrix = _ok(_matrix(client, project))
    assert (matrix["total_requirements"], matrix["retired_requirements"]) == (2, 1)
    assert matrix["overall_requirement_coverage_percentage"] == 100.0
    assert {e["status"] for e in matrix["entries"]} == {"draft", "retired"}
    assert _read(client, old)["review_count"] == 0
    assert _ok(client.get(f"{API}/tasks/{task['id']}/rollup"))["requirements_total"] == 1


def test_the_matrix_export_carries_ids_status_and_review(client: TestClient, world: dict) -> None:
    requirement = _requirement(client, world["project"], status="approved")
    _link(client, requirement, _case(client, world["project"]))

    response = _matrix(client, world["project"], "/export")

    assert response.status_code == 200, response.text
    header, row = response.text.strip().splitlines()
    assert header.startswith("ID,Requirement,Status,Task,Linked Test Cases,Needs Review")
    assert row.startswith(f"{requirement['display_id']},Claims are validated,Approved,")


# --- who may do what ----------------------------------------------------------------------------


@pytest.mark.parametrize("role,expected", [("qa_lead", 200), ("viewer", 403)])
def test_confirming_needs_permission_to_manage_requirements(
    client: TestClient, world: dict, role: str, expected: int
) -> None:
    requirement = _requirement(client, world["project"])
    case = _case(client, world["project"])
    _link(client, requirement, case)
    _patch(client, requirement, title="The second wording")
    them = _sign_in(client, world, "who", role)

    assert _confirm(them, requirement, case, 2).status_code == expected


def test_an_archived_projects_criteria_and_links_are_read_only(
    client: TestClient, world: dict, owner_engine
) -> None:
    requirement = _requirement(client, world["project"], acceptance_criteria=["Logged"])
    case = _case(client, world["project"])
    _link(client, requirement, case)
    _patch(client, requirement, title="The second wording")
    _ok(client.post(f"{API}/projects/{world['project']}/archive"))

    assert _confirm(client, requirement, case, 2).status_code == 409
    response = client.patch(
        f"{API}/requirements/{requirement['id']}", json={"acceptance_criteria": []}
    )
    assert response.status_code == 409, response.text
    with pytest.raises(DBAPIError) as refused, owner_engine.begin() as conn:
        conn.execute(text("delete from requirement_acceptance_criteria"))
    assert "archived" in str(refused.value)


# --- at volume ------------------------------------------------------------------------------------

_MANY = 3000


def _seed_many(owner_engine, world: dict, template: dict) -> None:
    """`_MANY` requirements like `template`, each with one version and two criteria."""
    with owner_engine.begin() as conn:
        ids = {"id": template["id"], "n": _MANY}
        conn.execute(
            text(
                "insert into requirements (tenant_id, project_id, task_id, title, created_by, "
                "  display_seq, display_id) "
                "select tenant_id, project_id, task_id, 'Bulk requirement ' || g, created_by, "
                "  1000 + g, 'REQ_' || lpad((1000 + g)::text, 6, '0') "
                "from requirements, generate_series(1, :n) g where id = :id"
            ),
            ids,
        )
        conn.execute(
            text(
                "with v as (insert into requirement_versions (tenant_id, requirement_id, "
                "  version_number, title, created_by) "
                "  select tenant_id, id, 1, title, created_by from requirements "
                "  where current_version_id is null returning id, requirement_id) "
                "update requirements r set current_version_id = v.id from v "
                "where r.id = v.requirement_id"
            )
        )
        conn.execute(
            text(
                "insert into requirement_acceptance_criteria "
                "(tenant_id, requirement_version_id, position, text) "
                "select tenant_id, id, p, 'Criterion ' || p from requirement_versions, "
                "generate_series(0, 1) p where title like 'Bulk requirement %'"
            )
        )


def _queries(action) -> int:
    seen: list[str] = []

    def count(conn, cursor, statement, *args) -> None:
        seen.append(statement)

    event.listen(Engine, "before_cursor_execute", count)
    try:
        action()
    finally:
        event.remove(Engine, "before_cursor_execute", count)
    return len(seen)


def test_the_view_and_matrix_hold_up_with_thousands_of_requirements(
    client: TestClient, world: dict, owner_engine
) -> None:
    project = world["project"]
    template = _requirement(client, project, "The first requirement")
    few = _queries(lambda: _list(client, project, page_size=100))
    _seed_many(owner_engine, world, template)

    many = _queries(lambda: _list(client, project, page_size=100))

    # One page costs the same number of queries however many rows it holds.
    assert many <= few + 1, (few, many)
    page = _list(client, project, page_size=100, page=31)
    assert (page["total"], len(page["items"])) == (_MANY + 1, 1)
    found = _list(client, project, q="Bulk requirement 2999")
    assert [r["acceptance_criteria"] for r in found["items"]] == [["Criterion 0", "Criterion 1"]]
    assert _list(client, project, covered=False)["total"] == _MANY + 1
    assert _list(client, project, needs_review=True)["total"] == 0
    matrix_queries = _queries(lambda: _ok(_matrix(client, project)))
    assert matrix_queries < 40, matrix_queries
    assert _coverage(client, project, summary=True)["total_requirements"] == _MANY + 1
