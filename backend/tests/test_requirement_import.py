"""ADR-151 (Phase 3D): importing requirements through the standard import."""

import csv
import io

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook, load_workbook

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.core.import_columns import REQUIREMENT_COLUMNS
from app.services import job_service
from tests.test_execution import _create_user
from tests.test_task_planning import (
    API,
    PASSWORD,
    _bootstrap_tenant,
    _create_project,
    _login_and_verify,
    _ok,
    _sign_in,
    _task,
)

BASE = f"{API}/requirements"
HEADER = {c.key: c.header for c in REQUIREMENT_COLUMNS}


@pytest.fixture
def world(client: TestClient, platform_admin: dict) -> dict:
    tenant_id = _bootstrap_tenant(client, platform_admin)["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    return {"tenant_id": tenant_id, "project": _create_project(client)["id"]}


def _row(n: int = 1, **over) -> dict:
    return {"title": f"Imported requirement {n:04d}", **over}


def _table(rows: list[dict]) -> list[list[str]]:
    keys: list[str] = []
    for row in rows:
        keys.extend(k for k in row if k not in keys)
    return [[HEADER[k] for k in keys], *[[row.get(k, "") for k in keys] for row in rows]]


def _csv(rows: list[dict]) -> bytes:
    buffer = io.StringIO()
    csv.writer(buffer).writerows(_table(rows))
    return buffer.getvalue().encode("utf-8")


def _xlsx(rows: list[dict]) -> bytes:
    workbook = Workbook()
    for line in _table(rows):
        workbook.active.append(line)
    out = io.BytesIO()
    workbook.save(out)
    return out.getvalue()


def _preview(client: TestClient, project: str, content: bytes, name: str = "r.csv"):
    return client.post(
        f"{BASE}/import/preview",
        data={"project_id": project},
        files={"file": (name, io.BytesIO(content), "application/octet-stream")},
    )


def _commit(client: TestClient, token: str, mode: str = "all_or_nothing"):
    return client.post(f"{BASE}/import/commit", json={"token": token, "mode": mode})


def _import(client: TestClient, project: str, rows: list[dict]) -> dict:
    token = _ok(_preview(client, project, _csv(rows)))["token"]
    return _ok(_commit(client, token))


def _all(client: TestClient, project: str) -> dict[str, dict]:
    data = _ok(client.get(f"{API}/projects/{project}/requirements", params={"page_size": 100}))
    return {r["title"]: r for r in data["items"]}


@pytest.mark.parametrize("make,name", [(_csv, "r.csv"), (_xlsx, "r.xlsx")])
def test_a_preview_writes_nothing_and_a_commit_creates_everything(
    client: TestClient, world: dict, make, name: str
) -> None:
    project = world["project"]
    task = _task(client, project, "Holds imports")
    me = _ok(client.get(f"{API}/auth/me"))
    _ok(client.post(f"{API}/projects/{project}/members", json={"user_id": me["user_id"]}))
    rows = [
        _row(
            1,
            description="Shown to the customer",
            requirement_type="business rule",
            priority="HIGH",
            status="Approved",
            owner=me["email"],
            criteria="1. Shows each deduction\n- Can be downloaded\n\n2.5 seconds at most",
            task=task["display_id"],
        ),
        _row(2),
    ]

    preview = _ok(_preview(client, project, make(rows), name))

    assert preview["totals"]["importable"] == 2 and preview["totals"]["errors"] == 0
    assert preview["rows"][0]["data"]["criteria"] == "3 criteria"
    assert preview["rows"][1]["data"]["task"] == "Unassigned requirements"
    assert _all(client, project) == {}

    summary = _ok(_commit(client, preview["token"]))

    assert summary["created"] == 2
    made = _all(client, project)
    first, second = made["Imported requirement 0001"], made["Imported requirement 0002"]
    assert first["acceptance_criteria"] == [
        "Shows each deduction",
        "Can be downloaded",
        "2.5 seconds at most",
    ]
    assert (first["requirement_type"], first["priority"], first["status"]) == (
        "Business rule",
        "High",
        "approved",
    )
    assert first["owner_id"] == me["user_id"] and first["task_id"] == task["id"]
    assert (second["requirement_type"], second["priority"], second["status"]) == (
        "Functional",
        "Medium",
        "draft",
    )
    assert second["task_title"] == "Unassigned requirements"
    assert {first["display_id"], second["display_id"]} == {"REQ_000001", "REQ_000002"}
    assert first["version_number"] == 1
    history = _ok(client.get(f"{API}/requirements/{first['id']}/history"))
    assert [h["action"] for h in history] == ["requirement.created"]


def test_an_import_never_changes_an_existing_requirement(client: TestClient, world: dict) -> None:
    project = world["project"]
    _import(client, project, [_row(1, display_id="REQ_000040", description="The original")])
    deleted = _all(client, project)["Imported requirement 0001"]
    _import(client, project, [_row(2, display_id="REQ_000007")])
    _ok(client.delete(f"{API}/requirements/{deleted['id']}"))

    preview = _ok(
        _preview(
            client,
            project,
            _csv([_row(3, display_id="REQ_000007"), _row(4, display_id="REQ_000040")]),
        )
    )

    # Both numbers are taken, the second by a deleted requirement: new ones are given.
    assert preview["totals"]["warnings"] == 2
    summary = _ok(_commit(client, preview["token"]))
    assert [r["display_id"] for r in summary["ids"]] == ["REQ_000041", "REQ_000042"]
    assert _all(client, project)["Imported requirement 0002"]["version_number"] == 1
    # And the next one made by hand does not collide.
    made = _ok(
        client.post(f"{API}/projects/{project}/requirements", json={"title": "Made by hand later"})
    )
    assert made["display_id"] == "REQ_000043"


def test_rows_with_problems_are_reported_by_column(client: TestClient, world: dict) -> None:
    project = world["project"]
    other = _create_project(client, "Other project")["id"]
    elsewhere = _task(client, other, "Not in this project")
    rows = [
        {"title": "Bad"},
        _row(2, requirement_type="Epic"),
        _row(3, priority="Urgent"),
        _row(4, status="Done"),
        _row(5, owner="nobody@horizon.com"),
        _row(6, task=elsewhere["display_id"]),
        _row(7, task="TASK_000001;TASK_000002"),
        _row(8, criteria="\n".join(f"criterion {n}" for n in range(51))),
        _row(9, criteria="x" * 2001),
        _row(10, display_id="REQ_000500"),
        _row(11, display_id="REQ_000500"),
    ]

    preview = _ok(_preview(client, project, _csv(rows)))

    failed = {i["row_number"]: i["column"] for i in preview["issues"] if i["severity"] == "error"}
    assert failed == {
        2: "Title",
        3: "Type",
        4: "Priority",
        5: "Status",
        6: "Owner Email",
        7: "Task",
        8: "Task",
        9: "Acceptance Criteria",
        10: "Acceptance Criteria",
        12: "Requirement ID",
    }
    assert _commit(client, preview["token"]).status_code == 422
    assert _all(client, project) == {}
    assert _ok(_commit(client, preview["token"], "skip_invalid"))["created"] == 1


def test_a_missing_title_column_is_one_clear_error(client: TestClient, world: dict) -> None:
    response = _preview(client, world["project"], _csv([{"description": "No titles here"}]))
    assert response.status_code == 422, response.text
    assert "Title" in response.json()["error"]["message"]


def test_the_templates_list_the_organizations_values(client: TestClient, world: dict) -> None:
    sheet = client.get(f"{BASE}/import-template.xlsx")
    assert sheet.status_code == 200, sheet.text
    assert "requirement_import_template.xlsx" in sheet.headers["content-disposition"]
    book = load_workbook(io.BytesIO(sheet.content))
    assert [c.value for c in book["Requirements"][1]] == [c.header for c in REQUIREMENT_COLUMNS]
    allowed = {cell.value for row in book["Allowed values"] for cell in row}
    assert {"Functional", "Business rule", "Critical", "Retired"} <= allowed
    text = " ".join(str(c.value) for row in book["Instructions"] for c in row if c.value)
    assert "only creates requirements" in text

    plain = client.get(f"{BASE}/import-template.csv")
    assert plain.status_code == 200, plain.text
    # The example row of an unchanged template is not imported.
    response = _preview(client, world["project"], plain.content)
    assert response.status_code == 422
    assert "no data rows" in response.json()["error"]["message"]


def test_a_large_import_runs_as_a_background_job(
    client: TestClient, world: dict, monkeypatch
) -> None:
    monkeypatch.setattr(get_settings(), "import_async_threshold", 5)
    rows = [_row(n) for n in range(1, 13)]
    preview = _ok(_preview(client, world["project"], _csv(rows)))
    assert preview["async_commit"] is True

    queued = _ok(_commit(client, preview["token"]))
    assert queued["async"] is True
    with SessionLocal() as worker:
        assert job_service.run_once(worker) is True

    job = _ok(client.get(f"{BASE}/import/status/{queued['job_id']}"))
    assert job["status"] == "succeeded", job
    assert job["result"]["created"] == 12
    assert len(_all(client, world["project"])) == 12


@pytest.mark.parametrize("role,expected", [("qa_lead", 200), ("viewer", 403), ("developer", 403)])
def test_importing_needs_permission_to_manage_requirements(
    client: TestClient, world: dict, role: str, expected: int
) -> None:
    them = _sign_in(client, world, "who", role)

    response = _preview(them, world["project"], _csv([_row(1)]))

    assert response.status_code == expected, response.text


def test_the_import_is_limited_to_projects_the_person_may_see(
    client: TestClient, world: dict
) -> None:
    """A role that may not see every project (a custom one, or a Tester) needs to be a member;
    QA Lead holds `project.view.all`, so it sees all of them by design (ADR-143)."""
    _ok(
        client.post(
            f"{API}/roles",
            json={"name": "Requirement editor", "permission_codes": ["requirement.manage"]},
        )
    )
    roles = {r["name"]: r["id"] for r in _ok(client.get(f"{API}/roles"))}
    user = _create_user(client, "editor@horizon.com", "Editor", "tester", PASSWORD)
    _ok(client.patch(f"{API}/users/{user}", json={"role_id": roles["Requirement editor"]}))
    _ok(client.post(f"{API}/projects/{world['project']}/members", json={"user_id": user}))
    them = TestClient(client.app)
    _login_and_verify(them, world["tenant_id"], "editor@horizon.com", PASSWORD)
    other = _create_project(client, "Not theirs")["id"]

    assert _preview(them, world["project"], _csv([_row(1)])).status_code == 200
    assert _preview(them, other, _csv([_row(1)])).status_code == 403
    lead = _sign_in(client, world, "lead", "qa_lead")
    assert _preview(lead, other, _csv([_row(1)])).status_code == 200


def test_an_archived_project_takes_no_import(client: TestClient, world: dict) -> None:
    token = _ok(_preview(client, world["project"], _csv([_row(1)])))["token"]
    _ok(client.post(f"{API}/projects/{world['project']}/archive"))

    response = _commit(client, token)

    assert response.status_code == 409, response.text
    assert _all(client, world["project"]) == {}
