"""ADR-143 (Phase 1E, findings F-06 and F-12): one access decision per project."""

import csv
import io
import re

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.core.project_access import NOT_PROJECT_PARAMETERS, PROJECT_PARAMETERS
from app.main import app
from app.services import csv_import_service
from tests.test_execution import (
    _bootstrap_tenant,
    _create_approved_case,
    _create_project,
    _create_user,
    _login_and_verify,
    _sample_steps,
)

API = "/api/v1"
PASSWORD = "UserPassw0rd!!"


def _ok(response):
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _ok_text(response) -> bytes:
    assert response.status_code == 200, response.text
    return response.content


def _refused(response, what: str = "") -> None:
    assert response.status_code == 403, (what, response.status_code, response.text[:300])


class World:
    """An admin, two projects and helpers to give people project roles."""

    def __init__(self, client: TestClient, platform_admin: dict) -> None:
        self.admin = client
        self.tenant = _bootstrap_tenant(client, platform_admin)["tenant"]["id"]
        _login_and_verify(client, self.tenant, "admin@horizon.com", "AdminPassw0rd!")
        self.a = _create_project(client, "Project A")["id"]
        self.b = _create_project(client, "Project B")["id"]

    def roles(self) -> dict[str, str]:
        return {r["code"] or r["name"]: r["id"] for r in _ok(self.admin.get(f"{API}/roles"))}

    def user(self, key: str, role: str) -> str:
        """A user with an organization role given by code or custom role name."""
        user = _create_user(self.admin, f"{key}@horizon.com", key.title(), "tester", PASSWORD)
        if role != "tester":
            _ok(self.admin.patch(f"{API}/users/{user}", json={"role_id": self.roles()[role]}))
        return user

    def custom_role(self, name: str, codes: list[str]) -> None:
        _ok(self.admin.post(f"{API}/roles", json={"name": name, "permission_codes": codes}))

    def member(self, project: str, user: str, project_role: str | None = None, by=None) -> None:
        client = by or self.admin
        _ok(client.post(f"{API}/projects/{project}/members", json={"user_id": user}))
        if project_role:
            _ok(self.set_role(project, user, project_role, by=client))

    def set_role(self, project: str, user: str, project_role: str | None, by=None):
        role_id = self.roles()[project_role] if project_role else None
        return (by or self.admin).patch(
            f"{API}/projects/{project}/members/{user}/role", json={"role_id": role_id}
        )

    def sign_in(self, key: str) -> TestClient:
        client = TestClient(self.admin.app)
        _login_and_verify(client, self.tenant, f"{key}@horizon.com", PASSWORD)
        return client

    def defect(self, project: str) -> str:
        body = {"project_id": project, "title": "A defect to work on", "severity": "Major"}
        return _ok(self.admin.post(f"{API}/defects", json=body))["id"]


@pytest.fixture
def w(client: TestClient, platform_admin: dict) -> World:
    return World(client, platform_admin)


def _case_body(title: str = "A new test case") -> dict:
    return {"title": title, "priority": "Low", "steps": _sample_steps()}


# --- P-1: a restrictive project role restricts ----------------------------------------------


def _restricted_manager(w: World) -> tuple[str, TestClient]:
    user = w.user("mo", "manager")
    w.member(w.a, user, "tester")
    w.member(w.b, user)
    return user, w.sign_in("mo")


def test_a_manager_who_is_a_tester_on_a_project_cannot_manage_it(w: World) -> None:
    case = _create_approved_case(w.admin, w.a, "Approved case in A")
    draft = _ok(w.admin.post(f"{API}/projects/{w.a}/test-cases", json=_case_body()))["id"]
    _ok(w.admin.post(f"{API}/test-cases/{draft}/submit-review"))
    defect = w.defect(w.a)
    user, mo = _restricted_manager(w)

    for what, response in {
        "edit project": mo.patch(f"{API}/projects/{w.a}", json={"name": "Taken over"}),
        "archive": mo.post(f"{API}/projects/{w.a}/archive"),
        "delete project": mo.delete(f"{API}/projects/{w.a}"),
        "add member": mo.post(f"{API}/projects/{w.a}/members", json={"user_id": user}),
        "remove self": mo.delete(f"{API}/projects/{w.a}/members/{user}"),
        "lift own restriction": w.set_role(w.a, user, None, by=mo),
        "new release": mo.post(f"{API}/projects/{w.a}/releases", json={"name": "R1"}),
        "approve": mo.post(f"{API}/test-cases/{draft}/approve"),
        "deprecate": mo.post(f"{API}/test-cases/{case['id']}/deprecate"),
        "close defect": mo.patch(
            f"{API}/defects/{defect}/status",
            json={"status": "Closed", "verification_confirmed": True},
        ),
        "delete defect": mo.delete(f"{API}/defects/{defect}"),
    }.items():
        _refused(response, what)


def test_the_same_manager_keeps_full_access_elsewhere(w: World) -> None:
    _, mo = _restricted_manager(w)
    assert _ok(mo.patch(f"{API}/projects/{w.b}", json={"name": "Still managed"}))
    assert _ok(mo.post(f"{API}/projects/{w.b}/releases", json={"name": "R1"}))
    # Organization-wide permissions of the role are not affected by any project role.
    assert _ok(mo.post(f"{API}/environments", json={"name": "Staging"}))


def test_a_query_parameter_cannot_borrow_another_projects_role(w: World) -> None:
    _, mo = _restricted_manager(w)
    response = mo.patch(
        f"{API}/projects/{w.a}", params={"project_id": w.b}, json={"name": "Borrowed"}
    )
    _refused(response)
    body = {"project_id": w.a, "title": "Reported by a restricted user", "severity": "Major"}
    created = mo.post(f"{API}/defects", params={"project_id": w.b}, json=body)
    assert created.status_code == 200, created.text  # a Tester may report defects


# --- P-2: a permissive project role works, and only on its project ---------------------------


def test_a_tester_who_is_a_manager_on_a_project_can_manage_it_and_nothing_else(
    w: World,
) -> None:
    user = w.user("ty", "tester")
    w.member(w.a, user, "manager")
    w.member(w.b, user)
    ty = w.sign_in("ty")

    assert _ok(ty.patch(f"{API}/projects/{w.a}", json={"name": "Led by Ty"}))
    assert _ok(ty.post(f"{API}/projects/{w.a}/releases", json={"name": "R1"}))
    other = w.user("zed", "tester")
    assert _ok(ty.post(f"{API}/projects/{w.a}/members", json={"user_id": other}))

    _refused(ty.patch(f"{API}/projects/{w.b}", json={"name": "No"}))
    _refused(ty.post(f"{API}/projects", json={"name": "Not an organization right"}))
    _refused(ty.post(f"{API}/users", json={}), "organization action")


# --- P-3: nobody gives what they do not have -------------------------------------------------


def test_admin_cannot_be_given_as_a_project_role(w: World) -> None:
    user = w.user("ty", "tester")
    w.member(w.a, user)
    assert w.set_role(w.a, user, "admin").status_code in (403, 409, 422)


def test_a_role_cannot_be_assigned_with_more_than_the_assigner_has(w: World) -> None:
    w.custom_role("Staffing", ["project.members.manage", "project.view.all"])
    w.custom_role("Approver", ["testcase.approve"])
    staffing = w.user("sam", "Staffing")
    target = w.user("ty", "tester")
    w.member(w.a, staffing)
    w.member(w.a, target)
    sam = w.sign_in("sam")

    _refused(w.set_role(w.a, target, "Approver", by=sam), "grants testcase.approve")
    _refused(w.set_role(w.a, target, "manager", by=sam), "grants much more")
    _refused(w.set_role(w.a, staffing, "Approver", by=sam), "own role")


def test_nobody_but_an_admin_changes_their_own_project_role(w: World) -> None:
    user = w.user("mia", "manager")
    w.member(w.a, user)
    mia = w.sign_in("mia")
    _refused(w.set_role(w.a, user, "tester", by=mia))
    assert w.set_role(w.a, user, "tester").status_code == 200  # an admin may


def test_an_admin_is_never_restricted_by_a_project_role(w: World) -> None:
    me = _ok(w.admin.get(f"{API}/auth/me"))["user_id"]
    _ok(w.set_role(w.a, me, "tester"))
    assert _ok(w.admin.patch(f"{API}/projects/{w.a}", json={"name": "Admin still can"}))


# --- projects named in the request body ------------------------------------------------------


def test_creating_a_defect_uses_the_role_on_the_project_in_the_body(w: World) -> None:
    w.custom_role("Looker", ["report.view"])
    user = w.user("lee", "tester")
    w.member(w.a, user, "Looker")
    w.member(w.b, user)
    lee = w.sign_in("lee")
    body = {"title": "Reported through the body", "severity": "Major"}

    _refused(lee.post(f"{API}/defects", json={**body, "project_id": w.a}))
    assert lee.post(f"{API}/defects", json={**body, "project_id": w.b}).status_code == 200


def test_bulk_edits_apply_each_projects_role(w: World) -> None:
    w.custom_role("Looker", ["report.view"])
    user = w.user("lee", "tester")
    w.member(w.a, user, "Looker")
    w.member(w.b, user)
    cases = {
        p: _ok(w.admin.post(f"{API}/projects/{p}/test-cases", json=_case_body()))["id"]
        for p in (w.a, w.b)
    }
    lee = w.sign_in("lee")

    result = _ok(
        lee.post(
            f"{API}/test-cases/bulk-update",
            json={"test_case_ids": list(cases.values()), "priority": "High"},
        )
    )

    outcome = {r["test_case_id"]: r["ok"] for r in result["results"]}
    assert outcome == {cases[w.a]: False, cases[w.b]: True}
    moved = lee.post(
        f"{API}/test-cases/bulk-assign-module",
        json={"test_case_ids": [cases[w.a]], "module_id": None},
    )
    _refused(moved)


# --- P-4, P-5, P-6 ---------------------------------------------------------------------------


def test_ai_generation_needs_permission_to_create_test_cases(w: World) -> None:
    w.custom_role("Looker", ["report.view", "record.contribute"])
    user = w.user("lee", "Looker")
    task = _ok(w.admin.post(f"{API}/projects/{w.a}/tasks", json={"title": "A task"}))["id"]
    requirement = _ok(
        w.admin.post(
            f"{API}/projects/{w.a}/requirements",
            json={"title": "A requirement", "description": "Do the thing", "task_id": task},
        )
    )["id"]
    w.member(w.a, user)

    response = w.sign_in("lee").post(
        f"{API}/requirements/{requirement}/generate-test-cases", json={}
    )

    _refused(response)
    assert "testcase.create" in response.text


def test_a_viewer_reads_and_cannot_change_records(w: World) -> None:
    case = _create_approved_case(w.admin, w.a, "Case to look at")["id"]
    defect = w.defect(w.a)
    task = _ok(w.admin.post(f"{API}/projects/{w.a}/tasks", json={"title": "A task"}))["id"]
    note = _ok(w.admin.post(f"{API}/defects/{defect}/comments", json={"body": "Note"}))["id"]
    user = w.user("vic", "viewer")
    w.member(w.a, user)
    vic = w.sign_in("vic")

    for path in (f"/projects/{w.a}", f"/test-cases/{case}", f"/defects/{defect}", f"/tasks/{task}"):
        assert vic.get(API + path).status_code == 200, path
    upload = {"file": ("note.txt", b"hello", "text/plain")}
    for what, response in {
        "comment on case": vic.post(f"{API}/test-cases/{case}/comments", json={"body": "Hi"}),
        "comment on defect": vic.post(f"{API}/defects/{defect}/comments", json={"body": "Hi"}),
        "comment on task": vic.post(f"{API}/tasks/{task}/comments", json={"body": "Hi"}),
        "delete a comment": vic.delete(f"{API}/comments/{note}"),
        "attach to defect": vic.post(f"{API}/defects/{defect}/attachments", files=upload),
        "custom values": vic.put(
            f"{API}/custom-fields/values/defect/{defect}", json={"values": {}}
        ),
        "review with AI": vic.post(f"{API}/test-cases/{case}/ai-review"),
        "new case": vic.post(f"{API}/projects/{w.a}/test-cases", json=_case_body()),
        "edit case": vic.patch(f"{API}/test-cases/{case}", json={"priority": "High"}),
        "delete case": vic.delete(f"{API}/test-cases/{case}"),
        "report defect": vic.post(
            f"{API}/defects",
            json={"project_id": w.a, "title": "Should not work", "severity": "Major"},
        ),
        "move task": vic.post(f"{API}/tasks/{task}/status", json={}),
    }.items():
        _refused(response, what)


def test_existing_roles_can_still_contribute(w: World) -> None:
    defect = w.defect(w.a)
    for key, role in (("ty", "tester"), ("mia", "manager")):
        user = w.user(key, role)
        w.member(w.a, user)
        response = w.sign_in(key).post(f"{API}/defects/{defect}/comments", json={"body": "Ok"})
        assert response.status_code == 200, (role, response.text)


def test_a_retest_result_needs_permission_to_execute_tests(w: World) -> None:
    user = w.user("dee", "developer")
    w.member(w.a, user)
    defect = w.defect(w.a)

    response = w.sign_in("dee").post(
        f"{API}/defects/{defect}/retest-result",
        json={"result": "pass", "run_case_id": "00000000-0000-0000-0000-000000000000"},
    )

    _refused(response)
    assert "testcase.execute" in response.text


# --- the new roles ---------------------------------------------------------------------------

QA_LEAD = {
    "project.view.all",
    "task.manage",
    "task.transition",
    "requirement.manage",
    "testcase.create",
    "testcase.edit",
    "testcase.approve",
    "testcase.deprecate",
    "testcase.delete",
    "testcase.execute",
    "executionstep.record",
    "testcase.export",
    "testcase.bulk_import_export",
    "testrun.create",
    "testrun.finish",
    "testrun.delete",
    "defect.create",
    "defect.edit",
    "defect.change_status",
    "defect.assign",
    "defect.close",
    "defect.delete",
    "defect.export",
    "defect.import",
    "report.view",
    "report.compliance_export",
    "record.contribute",
    "environment.manage",
}
DEVELOPER = {
    "task.transition",
    "defect.create",
    "defect.edit",
    "defect.change_status",
    "defect.export",
    "report.view",
    "record.contribute",
}


def test_the_new_roles_hold_exactly_the_approved_permissions(w: World) -> None:
    roles = {r["code"]: r for r in _ok(w.admin.get(f"{API}/roles")) if r["code"]}
    assert set(roles["qa_lead"]["permission_codes"]) == QA_LEAD
    assert set(roles["developer"]["permission_codes"]) == DEVELOPER
    assert set(roles["viewer"]["permission_codes"]) == {"report.view"}
    for existing in ("admin", "manager", "tester"):
        assert "record.contribute" in roles[existing]["permission_codes"]
    assert [roles[c]["name"] for c in ("qa_lead", "developer", "viewer")] == [
        "QA Lead",
        "Developer",
        "Viewer",
    ]


def test_a_qa_lead_sees_all_projects_and_does_not_manage_them(w: World) -> None:
    w.user("qa", "qa_lead")
    qa = w.sign_in("qa")
    assert {p["name"] for p in _ok(qa.get(f"{API}/projects"))["items"]} == {
        "Project A",
        "Project B",
    }
    assert _ok(qa.post(f"{API}/projects/{w.a}/test-cases", json=_case_body()))
    _refused(qa.post(f"{API}/projects", json={"name": "No"}))
    _refused(qa.patch(f"{API}/projects/{w.a}", json={"name": "No"}))


def test_developers_and_viewers_see_only_their_projects(w: World) -> None:
    for key, role in (("dee", "developer"), ("vic", "viewer")):
        user = w.user(key, role)
        w.member(w.a, user)
        names = [p["name"] for p in _ok(w.sign_in(key).get(f"{API}/projects"))["items"]]
        assert names == ["Project A"], role


# --- nothing is left out ----------------------------------------------------------------------


def test_every_path_parameter_says_whether_it_names_a_project() -> None:
    """A route added with a new kind of id must say how to find its project, or why it
    has none. Without that, a project role would silently not apply to it."""
    known = set(PROJECT_PARAMETERS) | set(NOT_PROJECT_PARAMETERS)
    for route in app.routes:
        if not isinstance(route, APIRoute) or not route.endpoint.__module__.startswith("app."):
            continue
        if "/platform" in route.path:
            continue
        parameters = set(re.findall(r"{(\w+)}", route.path))
        assert parameters <= known, (route.path, parameters - known)
        if "link_id" in parameters:
            assert parameters & set(PROJECT_PARAMETERS), route.path
    assert not set(PROJECT_PARAMETERS) & set(NOT_PROJECT_PARAMETERS)


@pytest.mark.parametrize("path", ["test-cases", "defects"])
def test_the_import_wizard_applies_the_project_role(w: World, path: str) -> None:
    w.custom_role("Looker", ["report.view"])
    user = w.user("lee", "tester")
    w.member(w.a, user, "Looker")
    w.member(w.b, user)
    lee = w.sign_in("lee")
    # The product's own template, so the file has every mandatory column, plus one row.
    # The row need not be valid: a preview reports problems row by row.
    template = _ok_text(w.admin.get(f"{API}/{path}/import-template.csv")).decode("utf-8-sig")
    columns = next(csv.reader(io.StringIO(template)))
    rows = io.StringIO()
    csv.writer(rows).writerows([columns, ["A row to preview"] * len(columns)])

    def preview(project: str):
        return lee.post(
            f"{API}/{path}/import/preview",
            data={"project_id": project},
            files={"file": ("rows.csv", rows.getvalue().encode(), "text/csv")},
        )

    _refused(preview(w.a))
    allowed = preview(w.b)
    assert allowed.status_code == 200, allowed.text


@pytest.mark.parametrize(
    "path,header",
    [
        ("test-cases", csv_import_service.TEMPLATE_CSV),
        ("defects", csv_import_service.DEFECT_TEMPLATE_CSV),
    ],
    ids=["test-cases", "defects"],
)
def test_the_older_csv_import_applies_the_project_role(w: World, path: str, header: str) -> None:
    w.custom_role("Looker", ["report.view"])
    user = w.user("lee", "tester")
    w.member(w.a, user, "Looker")
    columns = next(csv.reader(io.StringIO(header)))
    values = {"Title": "A row for project A", "Project Name": "Project A", "Priority": "Low"}
    rows = io.StringIO()
    writer = csv.writer(rows)
    writer.writerow(columns)
    writer.writerow([values.get(column, "") for column in columns])

    response = w.sign_in("lee").post(
        f"{API}/{path}/import", files={"file": ("rows.csv", rows.getvalue(), "text/csv")}
    )

    assert response.status_code == 200, response.text
    assert "does not allow this import" in response.text
    assert response.json()["data"]["created_count"] == 0


def _fixed_defect(w: World) -> str:
    defect = w.defect(w.a)
    for status in ("Open", "Fixed"):
        _ok(w.admin.patch(f"{API}/defects/{defect}/status", json={"status": status}))
    return defect


def test_a_developer_cannot_mark_a_defect_verified(w: World) -> None:
    defect = _fixed_defect(w)
    user = w.user("dee", "developer")
    w.member(w.a, user)
    dee = w.sign_in("dee")

    response = dee.patch(f"{API}/defects/{defect}/status", json={"status": "Verified"})

    _refused(response)
    assert "testcase.execute" in response.text
    assert _ok(dee.get(f"{API}/defects/{defect}"))["status"] == "Fixed"
    # The rest of the fix workflow is still theirs.
    assert _ok(dee.patch(f"{API}/defects/{defect}/status", json={"status": "Retest"}))


@pytest.mark.parametrize("role", ["tester", "manager", "qa_lead"])
def test_people_who_run_tests_can_still_mark_a_defect_verified(w: World, role: str) -> None:
    defect = _fixed_defect(w)
    user = w.user("val", role)
    w.member(w.a, user)

    response = w.sign_in("val").patch(f"{API}/defects/{defect}/status", json={"status": "Verified"})

    assert response.status_code == 200, response.text


def test_an_import_cannot_create_a_defect_already_verified_without_that_permission(
    w: World,
) -> None:
    user = w.user("dee", "developer")
    w.member(w.a, user)
    template = _ok_text(w.admin.get(f"{API}/defects/import-template.csv")).decode("utf-8-sig")
    columns = next(csv.reader(io.StringIO(template)))
    values = {
        "Title": "Imported as verified",
        "Description": "Broken",
        "Steps to Reproduce": "Open it",
        "Expected Result": "Works",
        "Actual Result": "Fails",
        "Environment": "QA",
        "Severity": "Major",
        "Priority": "Medium",
        "Status": "Verified",
    }
    assert "Status" in columns
    rows = io.StringIO()
    csv.writer(rows).writerows([columns, [values.get(c, "") for c in columns]])

    preview = w.sign_in("dee").post(
        f"{API}/defects/import/preview",
        data={"project_id": w.a},
        files={"file": ("rows.csv", rows.getvalue().encode(), "text/csv")},
    )

    assert preview.status_code == 200, preview.text
    assert "not allowed to import verified defects" in preview.text
