"""ADR-118 (22-field standard, step 4): the Defect backend.

Mandatory fields on create, validation, the status workflow (transition table and
resolution rules), unified test case links, the failed-execution draft, the retest
workflow, permissions, filters / sorts / search / export, audit before/after, reports
and SLA with the new statuses, CSV import of the new columns. (The shared builder in
conftest fills the new mandatory fields for older tests; the tests here that exercise
the validation send `X-Test-Strict-Create` to talk to the API like a real client.)
"""

import io
import zipfile
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core import field_standards
from app.services import defect_service
from tests.conftest import STRICT_CREATE_HEADER
from tests.test_project_role_scoping import _bootstrap_tenant, _create_project, _login_and_verify
from tests.test_test_case_standard import (
    ADMIN_PW,
    USER_PW,
    _custom_role_user,
    add_user,
    approve,
    create_case,
    login_as,
    make_run,
    setup_env,
    step_ids,
    verdict,
)

STRICT = {STRICT_CREATE_HEADER: "1"}
EN_DASH = "–"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32

MANDATORY = [
    "title",
    "description",
    "repro_steps",
    "expected_result",
    "actual_result",
    "environment",
    "severity",
    "priority",
]


def defect_body(env: dict, **extra) -> dict:
    body = {
        "project_id": env["project_id"],
        "title": "Login button is unresponsive",
        "description": "Clicking **Sign in** does nothing",
        "repro_steps": [
            {"action": "Open the login page", "test_data": "user=alice", "expected_result": "Page"},
            {"action": "Click Sign in"},
        ],
        "expected_result": "The user is signed in",
        "actual_result": "Nothing happens",
        "environment": "Staging",
        "severity": "Major",
        "priority": "High",
    }
    body.update(extra)
    return body


def make_defect(client: TestClient, env: dict, **extra) -> dict:
    response = client.post("/api/v1/defects", json=defect_body(env, **extra), headers=STRICT)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def get_defect(client: TestClient, defect_id: str) -> dict:
    response = client.get(f"/api/v1/defects/{defect_id}")
    assert response.status_code == 200, response.text
    return response.json()["data"]


def set_status(owner_engine, defect_id: str, status: str, resolution: str | None = None) -> None:
    closed = "now()" if status in ("Closed", "Rejected") else "NULL"
    with owner_engine.begin() as conn:
        conn.execute(
            text(
                f"UPDATE defects SET status = :s, resolution = :r, closed_at = {closed} "
                "WHERE id = :i"
            ),
            {"s": status, "r": resolution, "i": defect_id},
        )


def change_status(client: TestClient, defect_id: str, status: str, **extra):
    return client.patch(f"/api/v1/defects/{defect_id}/status", json={"status": status, **extra})


def walk(client: TestClient, defect_id: str, *statuses: str) -> None:
    for status in statuses:
        extra = {"verification_confirmed": True} if status == "Closed" else {}
        response = change_status(client, defect_id, status, **extra)
        assert response.status_code == 200, (status, response.text)


def as_user(client: TestClient, env: dict, email: str, password: str = USER_PW) -> TestClient:
    other = TestClient(client.app)
    login_as(other, env, email, password)
    return other


def user_id_of(client: TestClient, email: str) -> str:
    return next(u["id"] for u in client.get("/api/v1/users").json()["data"] if u["email"] == email)


def extra_project(client: TestClient, name: str = "Second") -> dict:
    project = _create_project(client, name)
    module = client.post(f"/api/v1/projects/{project['id']}/modules", json={"name": "Core"})
    return {"project_id": project["id"], "module_id": module.json()["data"]["id"]}


# --- mandatory fields, validation ----------------------------------------------------------------


def test_create_requires_every_mandatory_field_with_a_message_each(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    response = client.post(
        "/api/v1/defects",
        json={"project_id": env["project_id"], "title": "Some defect title"},
        headers=STRICT,
    )
    assert response.status_code == 422
    fields = response.json()["error"]["fields"]
    assert set(fields) == {m for m in MANDATORY if m != "title"}
    for message in fields.values():
        assert "required" in message.lower()
    # An empty title is reported as well; blank text counts as missing.
    blank = client.post(
        "/api/v1/defects",
        json=defect_body(env, description="   ", expected_result=""),
        headers=STRICT,
    )
    assert blank.status_code == 422
    assert set(blank.json()["error"]["fields"]) == {"description", "expected_result"}
    blank_title = client.post(
        "/api/v1/defects", json=defect_body(env, title="      "), headers=STRICT
    )
    assert blank_title.status_code == 422 and "title" in blank_title.json()["error"]["fields"]


def test_create_stores_and_returns_all_fields(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    tester_id = add_user(client, env, "tester")
    defect = make_defect(
        client,
        env,
        preconditions="Account exists",
        build_found="2.4.1",
        fix_version="2.5.0",
        labels=["UI", " ui ", "Regression", "Regression"],
        root_cause="code_defect",
        root_cause_notes="Null check missing",
        module_id=env["module_id"],
        assigned_to=tester_id,
        reported_by=str(uuid4()),  # never accepted from a client
    )
    assert defect["display_id"] == "BUG_000001"
    assert defect["status"] == "New" and defect["resolution"] is None
    assert defect["reporter"] == defect["reported_by"] != tester_id
    assert defect["reported_by_name"]
    assert defect["date_reported"] == defect["created_at"]
    assert defect["labels"] == ["ui", "regression"]
    assert defect["severity"] == "Major" and defect["priority"] == "High"
    assert defect["assignee"] == tester_id and defect["assigned_to_name"]
    assert defect["module_id"] == env["module_id"] and defect["module_name"] == "Claims"
    assert defect["preconditions"] == "Account exists"
    assert defect["build_found"] == "2.4.1" and defect["fix_version"] == "2.5.0"
    assert defect["root_cause"] == "code_defect" and defect["root_cause_notes"]
    steps = defect["repro_steps"]
    assert [s["step_no"] for s in steps] == [1, 2]
    assert steps[0]["test_data"] == "user=alice" and steps[0]["expected_result"] == "Page"
    # The legacy text column is kept in sync as numbered text.
    assert defect["steps_to_reproduce"].startswith("1. Open the login page")
    assert "2. Click Sign in" in defect["steps_to_reproduce"]
    # Second defect gets the next id.
    assert make_defect(client, env, title="Another defect here")["display_id"] == "BUG_000002"


def test_legacy_text_steps_are_converted_and_html_is_stripped(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    body = defect_body(env, description="<script>alert(1)</script>Real <b>text</b>")
    del body["repro_steps"]
    body["steps_to_reproduce"] = "1. Open page\n2) Click button\nlast step"
    response = client.post("/api/v1/defects", json=body, headers=STRICT)
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert [s["action"] for s in data["repro_steps"]] == ["Open page", "Click button", "last step"]
    assert "script" not in data["description"] and "alert" not in data["description"]
    assert data["description"] == "Real text"


def test_validation_boundaries(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    url = "/api/v1/defects"

    def post(**extra):
        return client.post(url, json=defect_body(env, **extra), headers=STRICT)

    assert post(title="abcd").status_code == 422
    assert post(title="a" * 255).status_code == 200
    r = post(title="a" * 256)
    assert r.status_code == 422 and "title" in r.json()["error"]["fields"]
    assert post(description="d" * 20_000).status_code == 200
    assert "description" in post(description="d" * 20_001).json()["error"]["fields"]
    assert "actual_result" in post(actual_result="x" * 10_001).json()["error"]["fields"]
    assert post(labels=[f"l{i}" for i in range(20)]).status_code == 200
    too_many = post(labels=[f"l{i}" for i in range(21)])
    assert too_many.status_code == 422 and "labels" in too_many.json()["error"]["fields"]
    assert post(labels=["x" * 40]).status_code == 200
    assert "labels" in post(labels=["x" * 41]).json()["error"]["fields"]
    # Duplicates (case-insensitive) do not count twice.
    assert post(labels=["A", "a"] * 15).status_code == 200
    bad_step = post(repro_steps=[{"action": "  "}])
    assert bad_step.status_code == 422
    assert "severity" in post(severity="Catastrophic").json()["error"]["fields"]
    assert "priority" in post(priority="Whenever").json()["error"]["fields"]
    assert "status" in post(status="Closed").json()["error"]["fields"]
    assert "status" in post(status="Assigned").json()["error"]["fields"]  # needs an assignee
    assert "module_id" in post(module_id=str(uuid4())).json()["error"]["fields"]
    assert "environment_id" in post(environment_id=str(uuid4())).json()["error"]["fields"]
    assert "test_case_ids" in post(test_case_ids=[str(uuid4())]).json()["error"]["fields"]


def test_legacy_severity_and_priority_codes_stay_valid(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    for severity in ("Low", "Medium", "High", "Critical", "Major", "Minor"):
        assert make_defect(client, env, severity=severity)["severity"] == severity
    for priority in ("High", "Medium", "Low", "Critical"):
        assert make_defect(client, env, priority=priority)["priority"] == priority


def test_assignee_must_be_an_active_member_of_the_project(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    outsider = add_user(client, env, "manager", project_member=False)
    member = add_user(client, env, "tester")
    unknown = client.post(
        "/api/v1/defects",
        json=defect_body(env, assigned_to=str(uuid4())),
        headers=STRICT,
    )
    assert unknown.status_code == 422 and "assigned_to" in unknown.json()["error"]["fields"]
    # A tenant user who is not a member of the project is refused too.
    foreign = client.post(
        "/api/v1/defects", json=defect_body(env, assigned_to=outsider), headers=STRICT
    )
    assert foreign.status_code == 422
    assert make_defect(client, env, assigned_to=member)["assigned_to"] == member
    # Deactivated users cannot be assigned.
    assert client.delete(f"/api/v1/users/{member}").status_code == 200
    gone = client.post("/api/v1/defects", json=defect_body(env, assigned_to=member), headers=STRICT)
    assert gone.status_code == 422 and "assigned_to" in gone.json()["error"]["fields"]


def test_display_id_and_reporter_are_immutable(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    defect = make_defect(client, env)
    response = client.patch(
        f"/api/v1/defects/{defect['id']}",
        json={"display_id": "BUG_999999", "reported_by": str(uuid4()), "title": "A new title"},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["display_id"] == defect["display_id"]
    assert data["reported_by"] == defect["reported_by"]
    assert data["title"] == "A new title"


def test_expected_and_actual_result_are_editable_after_create(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    defect = make_defect(client, env)
    response = client.patch(
        f"/api/v1/defects/{defect['id']}",
        json={"expected_result": "Signed in within 2s", "actual_result": "HTTP 500"},
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["expected_result"] == "Signed in within 2s" and data["actual_result"] == "HTTP 500"
    history = client.get(f"/api/v1/defects/{defect['id']}/history").json()["data"]
    updated = [h for h in history if h["action"] == "defect.updated"][-1]
    assert updated["changes"]["actual_result"] == {"from": "Nothing happens", "to": "HTTP 500"}
    assert set(updated["changes"]) == {"expected_result", "actual_result"}


def test_patch_cannot_clear_a_mandatory_value_but_legacy_rows_are_not_refused(
    client, platform_admin, owner_engine
) -> None:
    env = setup_env(client, platform_admin)
    defect = make_defect(client, env)
    for field in ("description", "expected_result", "actual_result", "environment"):
        r = client.patch(f"/api/v1/defects/{defect['id']}", json={field: ""})
        assert r.status_code == 422 and field in r.json()["error"]["fields"], field
    r = client.patch(f"/api/v1/defects/{defect['id']}", json={"repro_steps": []})
    assert r.status_code == 422 and "repro_steps" in r.json()["error"]["fields"]
    r = client.patch(f"/api/v1/defects/{defect['id']}", json={"severity": None})
    assert r.status_code == 422 and "severity" in r.json()["error"]["fields"]
    # A legacy row with empty mandatory values: other edits go through, empties stay empty.
    legacy = make_defect(client, env, title="Legacy row defect")
    with owner_engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE defects SET description = NULL, expected_result = NULL, "
                "environment = NULL, repro_steps = NULL, steps_to_reproduce = NULL WHERE id = :i"
            ),
            {"i": legacy["id"]},
        )
    ok = client.patch(
        f"/api/v1/defects/{legacy['id']}", json={"title": "Legacy row renamed", "description": ""}
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["data"]["title"] == "Legacy row renamed"
    assert ok.json()["data"]["repro_steps"] is None


def test_labels_are_edited_and_normalised_on_patch(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    defect = make_defect(client, env, labels=["one"])
    r = client.patch(f"/api/v1/defects/{defect['id']}", json={"labels": ["Two", "two ", "THREE"]})
    assert r.json()["data"]["labels"] == ["two", "three"]
    assert (
        client.patch(f"/api/v1/defects/{defect['id']}", json={"labels": []}).json()["data"][
            "labels"
        ]
        == []
    )
    too_long = client.patch(f"/api/v1/defects/{defect['id']}", json={"labels": ["x" * 41]})
    assert too_long.status_code == 422


# --- status workflow -----------------------------------------------------------------------------


def test_transition_table_is_consistent() -> None:
    statuses = set(field_standards.DEFECT_STATUSES)
    assert len(statuses) == 11
    assert set(field_standards.ALLOWED_TRANSITIONS) == statuses
    for current, allowed in field_standards.ALLOWED_TRANSITIONS.items():
        assert allowed <= statuses and current not in allowed
    # Every status can be reached and the brief's lifecycle is present.
    t = field_standards.ALLOWED_TRANSITIONS
    chain = ["New", "Assigned", "In Progress", "Fixed", "Retest", "Closed"]
    assert all(b in t[a] for a, b in zip(chain, chain[1:], strict=False))
    assert {"Reopened", "Verified"} <= t["Retest"] and "Reopened" in t["Closed"]
    assert {"Assigned", "In Progress"} <= t["Reopened"] and "Reopened" in t["Rejected"]
    assert {"Rejected", "Deferred"} <= t["New"] & t["Assigned"] & t["In Progress"]
    assert {"Assigned", "New"} <= t["Deferred"]
    legacy = ["New", "Open", "Fixed", "Verified", "Closed"]
    assert all(b in t[a] for a, b in zip(legacy, legacy[1:], strict=False))
    assert {"Assigned", "In Progress"} <= t["Open"]


def test_every_status_pair_is_enforced(client, platform_admin, owner_engine) -> None:
    env = setup_env(client, platform_admin)
    resolution_for = {"Closed": "Fixed", "Rejected": "Duplicate"}
    defect = make_defect(client, env)
    allowed = field_standards.ALLOWED_TRANSITIONS
    for current in field_standards.DEFECT_STATUSES:
        for target in field_standards.DEFECT_STATUSES:
            if current == target:
                continue
            set_status(owner_engine, defect["id"], current)
            body = {"status": target, "verification_confirmed": True}
            if target in resolution_for:
                body["resolution"] = resolution_for[target]
            response = client.patch(f"/api/v1/defects/{defect['id']}/status", json=body)
            if target in allowed[current]:
                assert response.status_code == 200, (current, target, response.text)
                assert response.json()["data"]["status"] == target
            else:
                assert response.status_code == 409, (current, target, response.text)
                message = response.json()["error"]["message"]
                assert current in message and target in message
                assert "allowed next statuses" in message
                for nxt in allowed[current]:
                    assert nxt in message


def test_invalid_transition_lists_the_allowed_next_statuses(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    defect = make_defect(client, env)
    r = change_status(client, defect["id"], "Fixed")
    assert r.status_code == 409
    for nxt in ("Assigned", "In Progress", "Rejected", "Deferred", "Open"):
        assert nxt in r.json()["error"]["message"]
    unknown = change_status(client, defect["id"], "Done")
    assert unknown.status_code == 422


def test_legacy_sequential_flow_still_works(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    defect = make_defect(client, env)
    walk(client, defect["id"], "Open", "Fixed", "Verified", "Closed")
    data = get_defect(client, defect["id"])
    assert data["status"] == "Closed" and data["closed_at"] and data["resolution"] == "Fixed"
    # Closing still needs the explicit confirmation.
    other = make_defect(client, env, title="Close without confirmation")
    walk(client, other["id"], "Open", "Fixed", "Verified")
    assert change_status(client, other["id"], "Closed").status_code == 422


def test_new_lifecycle_and_resolution_rules(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    defect = make_defect(client, env)
    did = defect["id"]
    walk(client, did, "Assigned", "In Progress")
    # Open statuses must not carry a resolution.
    r = change_status(client, did, "Fixed", resolution="Duplicate")
    assert r.status_code == 422 and "resolution" in r.json()["error"]["fields"]
    fixed = change_status(client, did, "Fixed")
    assert fixed.status_code == 200 and fixed.json()["data"]["resolution"] == "Fixed"
    retest = change_status(client, did, "Retest")
    assert retest.json()["data"]["status"] == "Retest"
    assert retest.json()["data"]["resolution"] is None  # Retest carries none
    closed = change_status(client, did, "Closed", verification_confirmed=True)
    assert closed.status_code == 200
    assert closed.json()["data"]["resolution"] == "Fixed" and closed.json()["data"]["closed_at"]
    # Reopened clears the resolution and the closed date.
    reopened = change_status(client, did, "Reopened")
    data = reopened.json()["data"]
    assert data["status"] == "Reopened" and data["resolution"] is None and data["closed_at"] is None
    assert data["reopened_count"] == 1
    walk(client, did, "In Progress", "Fixed")


def test_rejected_and_closed_need_a_valid_resolution(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    defect = make_defect(client, env)
    did = defect["id"]
    r = change_status(client, did, "Rejected")
    assert r.status_code == 422 and "resolution" in r.json()["error"]["fields"]
    assert change_status(client, did, "Rejected", resolution="Fixed").status_code == 422
    ok = change_status(client, did, "Rejected", resolution="Won't Fix")
    assert ok.status_code == 200 and ok.json()["data"]["closed_at"]
    assert ok.json()["data"]["resolution"] == "Won't Fix"
    # Rejected -> Closed keeps a valid resolution; Rejected -> Reopened clears it.
    assert change_status(client, did, "Reopened").json()["data"]["resolution"] is None
    # Deferred needs none; Deferred -> Closed needs one.
    deferred = make_defect(client, env, title="Parked defect")
    walk(client, deferred["id"], "Deferred")
    assert get_defect(client, deferred["id"])["resolution"] is None
    needs = change_status(client, deferred["id"], "Closed", verification_confirmed=True)
    assert needs.status_code == 422 and "resolution" in needs.json()["error"]["fields"]
    closed = change_status(
        client, deferred["id"], "Closed", verification_confirmed=True, resolution="By Design"
    )
    assert closed.status_code == 200 and closed.json()["data"]["resolution"] == "By Design"


def test_resolution_can_be_edited_with_the_status_rules(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    defect = make_defect(client, env)
    did = defect["id"]
    r = client.patch(f"/api/v1/defects/{did}", json={"resolution": "Fixed"})
    assert r.status_code == 422 and "resolution" in r.json()["error"]["fields"]  # status New
    change_status(client, did, "Rejected", resolution="Duplicate")
    # Rejected requires one, and only the rejected set is valid.
    assert client.patch(f"/api/v1/defects/{did}", json={"resolution": "Fixed"}).status_code == 422
    ok = client.patch(f"/api/v1/defects/{did}", json={"resolution": "Cannot Reproduce"})
    assert ok.status_code == 200 and ok.json()["data"]["resolution"] == "Cannot Reproduce"
    assert client.patch(f"/api/v1/defects/{did}", json={"resolution": None}).status_code == 422


def test_reopen_endpoint_maps_to_reopened_and_keeps_counting(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    add_user(client, env, "tester")
    defect = make_defect(client, env)
    did = defect["id"]
    walk(client, did, "Open", "Fixed")
    reopened = client.post(f"/api/v1/defects/{did}/reopen")
    assert reopened.status_code == 200
    data = reopened.json()["data"]
    assert data["status"] == "Reopened" and data["reopened_count"] == 1
    assert data["last_reopened_at"] and data["resolution"] is None
    assert client.post(f"/api/v1/defects/{did}/reopen").status_code == 409  # not reopenable now
    walk(client, did, "In Progress", "Fixed", "Retest")
    assert client.post(f"/api/v1/defects/{did}/reopen").json()["data"]["reopened_count"] == 2
    history = client.get(f"/api/v1/defects/{did}/history").json()["data"]
    events = [h for h in history if h["action"] == "defect.reopened"]
    assert [e["event_metadata"]["reopened_count"] for e in events] == [1, 2]
    assert events[0]["changes"]["status"] == {"from": "Fixed", "to": "Reopened"}
    # A Tester cannot reopen (same bar as closing).
    walk(client, did, "In Progress", "Fixed")
    tester = as_user(client, env, f"tester@{env['slug']}.example.com")
    assert tester.post(f"/api/v1/defects/{did}/reopen").status_code == 403
    assert change_status(tester, did, "Reopened").status_code == 403


def test_status_change_is_audited_with_from_and_to(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    defect = make_defect(client, env)
    walk(client, defect["id"], "Assigned", "In Progress", "Fixed")
    history = client.get(f"/api/v1/defects/{defect['id']}/history").json()["data"]
    changes = [h for h in history if h["action"] == "defect.status_changed"]
    assert [c["changes"]["status"]["to"] for c in changes] == ["Assigned", "In Progress", "Fixed"]
    assert changes[2]["changes"]["resolution"] == {"from": None, "to": "Fixed"}
    assert changes[0]["event_metadata"]["from"] == "New"  # legacy keys kept for reports


# --- permissions ---------------------------------------------------------------------------------


def test_close_needs_defect_close_or_the_admin_manager_tier(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    add_user(client, env, "tester")
    closer = _custom_role_user(client, env, "Closer", ["defect.create", "defect.close"])
    changer = _custom_role_user(client, env, "Changer", ["defect.create", "defect.change_status"])
    for who, can_close in (
        (f"tester@{env['slug']}.example.com", False),
        (closer, True),
        (changer, False),
        (env["admin_email"], True),
    ):
        pw = ADMIN_PW if who == env["admin_email"] else USER_PW
        # the admin creates; each user walks the defect to Verified and tries to close it
        admin = as_user(client, env, env["admin_email"], ADMIN_PW)
        defect = make_defect(admin, env, title=f"Close test for {who[:8]}")
        walk(admin, defect["id"], "Open", "Fixed", "Verified")
        actor = as_user(client, env, who, pw)
        r = change_status(actor, defect["id"], "Closed", verification_confirmed=True)
        assert (r.status_code == 200) == can_close, (who, r.status_code, r.text)
        if not can_close:
            assert r.status_code == 403


def test_permission_matrix_for_tester_manager_admin(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    tester_id = add_user(client, env, "tester")
    manager_id = add_user(client, env, "manager")
    defect = make_defect(client, env)
    did = defect["id"]
    tester = as_user(client, env, f"tester@{env['slug']}.example.com")
    manager = as_user(client, env, f"manager@{env['slug']}.example.com")
    # Tester: creates, edits, changes status within scope, cannot assign / close / delete /
    # export / reopen.
    mine = make_defect(tester, env, title="Reported by the tester")
    assert tester.patch(
        f"/api/v1/defects/{mine['id']}", json={"title": "Renamed by tester"}
    ).is_success
    assert change_status(tester, mine["id"], "Assigned").status_code == 200
    forbidden = tester.patch(f"/api/v1/defects/{mine['id']}", json={"assigned_to": manager_id})
    assert forbidden.status_code == 403
    assert tester.get("/api/v1/defects/export.csv").status_code == 403
    assert tester.delete(f"/api/v1/defects/{mine['id']}").status_code == 403
    # An unchanged assignee is not an assignment.
    assert tester.patch(f"/api/v1/defects/{mine['id']}", json={"assigned_to": None}).is_success
    # Manager: assigns, closes, exports, deletes.
    assert manager.patch(f"/api/v1/defects/{did}", json={"assigned_to": tester_id}).is_success
    assert manager.get("/api/v1/defects/export.csv").status_code == 200
    walk(manager, did, "Open", "Fixed", "Verified", "Closed")
    assert manager.delete(f"/api/v1/defects/{did}").status_code == 200
    # Admin: everything, including import.
    other = make_defect(client, env, title="Admin defect")
    assert client.patch(
        f"/api/v1/defects/{other['id']}", json={"assigned_to": tester_id}
    ).is_success
    assert client.get("/api/v1/defects/export.csv").status_code == 200


def test_custom_role_matrix_for_edit_assign_and_status(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    defect = make_defect(client, env)
    did = defect["id"]
    perms = {
        "Viewer": [],
        "Creator": ["defect.create"],
        "Editor": ["defect.edit"],
        "Assigner": ["defect.edit", "defect.assign"],
    }
    emails = {name: _custom_role_user(client, env, name, p) for name, p in perms.items()}
    member_id = user_id_of(client, emails["Creator"])
    clients = {name: as_user(client, env, email) for name, email in emails.items()}
    patch = f"/api/v1/defects/{did}"
    status_url = f"{patch}/status"

    def code(name, method, url, **kw):
        return getattr(clients[name], method)(url, **kw).status_code

    assert code("Viewer", "patch", patch, json={"title": "Not allowed"}) == 403
    assert code("Creator", "patch", patch, json={"title": "Creator may edit"}) == 200  # legacy
    assert code("Editor", "patch", patch, json={"title": "Editor may edit"}) == 200
    assert code("Editor", "patch", patch, json={"assigned_to": member_id}) == 403
    assert code("Assigner", "patch", patch, json={"assigned_to": member_id}) == 200
    assert code("Viewer", "patch", status_url, json={"status": "Assigned"}) == 403
    assert code("Editor", "patch", status_url, json={"status": "Assigned"}) == 403
    assert code("Creator", "patch", status_url, json={"status": "Assigned"}) == 200  # legacy
    assert code("Viewer", "post", f"{patch}/test-cases/{uuid4()}") == 403
    assert code("Editor", "post", f"{patch}/test-cases/{uuid4()}") == 404  # allowed, no such case


def test_custom_role_matrix_for_status_export_import_delete(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    defect = make_defect(client, env)
    did = defect["id"]
    perms = {
        "Changer": ["defect.change_status"],
        "Exporter": ["defect.export"],
        "Importer": ["defect.import"],
        "Deleter": ["defect.delete"],
    }
    emails = {name: _custom_role_user(client, env, name, p) for name, p in perms.items()}
    clients = {name: as_user(client, env, email) for name, email in emails.items()}
    patch = f"/api/v1/defects/{did}"

    def code(name, method, url, **kw):
        return getattr(clients[name], method)(url, **kw).status_code

    assert code("Changer", "patch", patch, json={"title": "No edit permission"}) == 403
    assert code("Changer", "patch", f"{patch}/status", json={"status": "Assigned"}) == 200
    assert code("Deleter", "patch", f"{patch}/status", json={"status": "In Progress"}) == 403
    assert code("Exporter", "get", "/api/v1/defects/export.csv") == 200
    assert code("Exporter", "get", "/api/v1/defects/export.xlsx") == 200
    assert code("Changer", "get", "/api/v1/defects/export.csv") == 403
    # Import: defect.import (or the legacy defect.create); an empty file is a 422 once allowed.
    files = {"file": ("d.csv", "Title\n", "text/csv")}
    assert clients["Importer"].post("/api/v1/defects/import", files=files).status_code == 422
    assert clients["Exporter"].post("/api/v1/defects/import", files=files).status_code == 403
    assert code("Exporter", "delete", patch) == 403
    assert code("Deleter", "delete", patch) == 200


# --- links ---------------------------------------------------------------------------------------


def test_link_and_unlink_test_cases_both_directions(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    case_a = create_case(client, env, "Case A about login")
    case_b = create_case(client, env, "Case B about logout")
    d1 = make_defect(client, env, test_case_id=case_a["id"])
    d2 = make_defect(client, env, title="Second defect on A")
    # Primary FK and link rows are one set.
    assert (
        client.post(f"/api/v1/defects/{d1['id']}/test-cases/{case_a['id']}").json()["data"][
            "link_created"
        ]
        is False
    )
    first = client.post(f"/api/v1/defects/{d1['id']}/test-cases/{case_b['id']}")
    assert first.status_code == 200 and first.json()["data"]["link_created"] is True
    again = client.post(f"/api/v1/defects/{d1['id']}/test-cases/{case_b['id']}")
    assert again.json()["data"]["link_created"] is False  # idempotent
    assert client.post(f"/api/v1/defects/{d2['id']}/test-cases/{case_a['id']}").is_success
    listed = client.get(f"/api/v1/defects/{d1['id']}/test-cases").json()["data"]
    assert [c["display_id"] for c in listed] == [case_a["display_id"], case_b["display_id"]]
    assert listed[0]["is_primary"] is True and listed[1]["is_primary"] is False
    assert listed[0]["title"] == "Case A about login" and listed[0]["module_path"] == "Claims"
    assert listed[0]["latest_execution_status"] == "Not Run"
    # The case side: both defects, from the same source.
    on_a = client.get(f"/api/v1/test-cases/{case_a['id']}/defects").json()["data"]
    assert {d["id"] for d in on_a} == {d1["id"], d2["id"]}
    entry = next(d for d in on_a if d["id"] == d1["id"])
    assert entry["display_id"] == d1["display_id"] and entry["status"] == "New"
    assert entry["severity"] == "Major" and "assigned_to" in entry
    on_b = client.get(f"/api/v1/test-cases/{case_b['id']}/defects").json()["data"]
    assert [d["id"] for d in on_b] == [d1["id"]]
    detail = get_case_linked(client, case_a["id"])
    assert {d["id"] for d in detail} == {d1["id"], d2["id"]}
    # list filter by linked test case uses the union.
    by_case = client.get("/api/v1/defects", params={"test_case_id": case_b["id"]}).json()["data"]
    assert [d["id"] for d in by_case] == [d1["id"]]
    # Unlink: link row, then the primary FK; idempotent.
    assert client.delete(f"/api/v1/defects/{d1['id']}/test-cases/{case_b['id']}").is_success
    assert client.delete(f"/api/v1/defects/{d1['id']}/test-cases/{case_b['id']}").is_success
    assert client.get(f"/api/v1/test-cases/{case_b['id']}/defects").json()["data"] == []
    assert client.delete(f"/api/v1/defects/{d1['id']}/test-cases/{case_a['id']}").is_success
    after = get_defect(client, d1["id"])
    assert after["test_case_id"] is None and after["linked_test_cases"] == []
    assert [
        d["id"] for d in client.get(f"/api/v1/test-cases/{case_a['id']}/defects").json()["data"]
    ] == [d2["id"]]
    # Audited with before / after.
    history = client.get(f"/api/v1/defects/{d1['id']}/history").json()["data"]
    added = [h for h in history if h["action"] == "defect.link_added"][-1]
    removed = [h for h in history if h["action"] == "defect.link_removed"]
    assert added["changes"]["linked_test_cases"]["to"].endswith(case_b["display_id"])
    assert removed[0]["changes"]["linked_test_cases"]["from"].count(",") == 1
    assert removed[1]["changes"]["linked_test_cases"]["to"] == ""


def get_case_linked(client: TestClient, case_id: str) -> list[dict]:
    return client.get(f"/api/v1/test-cases/{case_id}").json()["data"]["linked_defects"]


def test_link_target_is_validated(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    defect = make_defect(client, env)
    did = defect["id"]
    assert client.post(f"/api/v1/defects/{did}/test-cases/{uuid4()}").status_code == 404
    other = extra_project(client)
    foreign = create_case(client, other, "Case in another project")
    r = client.post(f"/api/v1/defects/{did}/test-cases/{foreign['id']}")
    assert r.status_code == 422 and "test_case_id" in r.json()["error"]["fields"]
    gone = create_case(client, env, "Soft deleted case")
    assert client.delete(f"/api/v1/test-cases/{gone['id']}").status_code == 200
    assert client.post(f"/api/v1/defects/{did}/test-cases/{gone['id']}").status_code == 404
    # The generic link endpoint validates its targets as well and is idempotent.
    assert (
        client.post(
            f"/api/v1/defects/{did}/links",
            json={"linkable_type": "defect", "linkable_id": str(uuid4())},
        ).status_code
        == 404
    )
    self_link = client.post(
        f"/api/v1/defects/{did}/links", json={"linkable_type": "defect", "linkable_id": did}
    )
    assert self_link.status_code == 422
    sibling = make_defect(client, env, title="Sibling defect")
    body = {"linkable_type": "defect", "linkable_id": sibling["id"], "link_type": "duplicate_of"}
    assert len(client.post(f"/api/v1/defects/{did}/links", json=body).json()["data"]["links"]) == 1
    twice = client.post(f"/api/v1/defects/{did}/links", json=body).json()["data"]
    assert len(twice["links"]) == 1
    link_id = twice["links"][0]["id"]
    assert client.delete(f"/api/v1/defects/{did}/links/{link_id}").json()["data"]["links"] == []
    # Linking through the legacy endpoint with type test_case is the same unified link.
    case = create_case(client, env, "Case for legacy link")
    legacy = client.post(
        f"/api/v1/defects/{did}/links",
        json={"linkable_type": "test_case", "linkable_id": case["id"]},
    )
    assert legacy.status_code == 200
    assert [c["id"] for c in get_defect(client, did)["linked_test_cases"]] == [case["id"]]


def test_create_with_several_test_cases_links_them_all(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    a, b, c = (create_case(client, env, f"Linked on create {n}") for n in "abc")
    defect = make_defect(
        client, env, test_case_id=a["id"], test_case_ids=[b["id"], c["id"], a["id"]]
    )
    assert {x["id"] for x in defect["linked_test_cases"]} == {a["id"], b["id"], c["id"]}
    assert defect["test_case_id"] == a["id"] and defect["linked_test_case_count"] == 3


# --- failed execution: draft, creation, linking --------------------------------------------------


def failed_run(client: TestClient, env: dict, name: str = "Run with failure"):
    case = create_case(
        client,
        env,
        "Checkout flow works",
        environment="Staging",
        preconditions="Cart has items",
        expected_result="Order is placed",
        steps=[
            {"action": "Open the cart", "expected": "Cart opens", "test_data": "items=2"},
            {"action": "Press Pay", "expected": "Payment page shows"},
            {"action": "Confirm", "expected": "Order placed"},
        ],
    )
    approve(client, case["id"])
    run = make_run(client, env, [case["id"]], name)
    rc = run["cases"][0]["id"]
    sids = step_ids(client, rc)
    assert verdict(client, sids[0], "pass").status_code == 200
    assert verdict(client, sids[1], "fail", "Payment page shows HTTP 500").status_code == 200
    return case, run, rc, sids


def test_defect_draft_from_a_failed_run_case(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    case, run, rc, sids = failed_run(client, env)
    draft = client.get(f"/api/v1/test-run-cases/{rc}/defect-draft")
    assert draft.status_code == 200, draft.text
    d = draft.json()["data"]
    assert d["title"] == f"{case['display_id']} {EN_DASH} Checkout flow works failed"
    assert d["test_case_display_id"] == case["display_id"] and d["test_run_id"] == run["id"]
    assert d["module_name"] == "Claims" and d["module_path"] == "Claims"
    assert d["preconditions"] == "Cart has items"
    assert d["environment"] == "Staging"
    assert d["failing_step_no"] == 2 and d["failing_execution_step_id"] == sids[1]
    assert [s["action"] for s in d["repro_steps"]] == ["Open the cart", "Press Pay"]
    assert [s["failed"] for s in d["repro_steps"]] == [False, True]
    assert d["repro_steps"][0]["test_data"] == "items=2"
    assert d["expected_result"] == "Payment page shows"  # the failing step's expectation
    assert d["actual_result"] == "Payment page shows HTTP 500"
    assert d["tester_id"] and d["tester_name"] and d["executed_at"]
    assert d["run_case_status"] == "failed" and d["existing_defects"] == []
    # Nothing was stored by the draft.
    assert client.get("/api/v1/defects").json()["data"] == []


def test_create_from_run_case_links_automatically_and_copies_evidence(
    client, platform_admin
) -> None:
    env = setup_env(client, platform_admin)
    case, run, rc, sids = failed_run(client, env)
    upload = client.post(
        f"/api/v1/execution-steps/{sids[1]}/attachments",
        files={"file": ("shot.png", PNG, "image/png")},
    )
    assert upload.status_code == 200, upload.text
    execution_attachment = upload.json()["data"]["id"]
    draft = client.get(f"/api/v1/test-run-cases/{rc}/defect-draft").json()["data"]
    assert [e["file_name"] for e in draft["evidence"]] == ["shot.png"]
    response = client.post(
        "/api/v1/defects",
        json={"test_run_case_id": rc, "severity": "Critical", "priority": "High"},
        headers=STRICT,
    )
    assert response.status_code == 200, response.text
    defect = response.json()["data"]
    assert defect["title"] == draft["title"] and defect["test_case_id"] == case["id"]
    assert defect["test_run_id"] == run["id"] and defect["test_run_case_id"] == rc
    assert defect["environment"] == "Staging" and defect["module_id"] == env["module_id"]
    assert [s.get("failed", False) for s in defect["repro_steps"]] == [False, True]
    assert defect["expected_result"] == "Payment page shows"
    assert defect["actual_result"] == "Payment page shows HTTP 500"
    link_types = {(lk["linkable_type"], lk["linkable_id"]) for lk in defect["links"]}
    assert ("test_run_case", rc) in link_types
    assert defect["linked_test_cases"][0]["display_id"] == case["display_id"]
    # The draft now lists it; the case side shows it too.
    again = client.get(f"/api/v1/test-run-cases/{rc}/defect-draft").json()["data"]
    assert [x["id"] for x in again["existing_defects"]] == [defect["id"]]
    assert [
        x["id"] for x in client.get(f"/api/v1/test-cases/{case['id']}/defects").json()["data"]
    ] == [defect["id"]]
    # Evidence was copied by reference: removing the defect's copy keeps the original.
    copies = client.get(f"/api/v1/defects/{defect['id']}/attachments").json()["data"]
    assert [a["file_name"] for a in copies] == ["shot.png"] and defect["attachment_count"] == 1
    assert client.delete(f"/api/v1/attachments/{copies[0]['id']}").status_code == 200
    download = client.get(f"/api/v1/attachments/{execution_attachment}/download")
    assert download.status_code == 200 and download.content == PNG


def test_step_level_creation_still_derives_its_old_title_and_also_links(
    client, platform_admin
) -> None:
    env = setup_env(client, platform_admin)
    case, run, rc, sids = failed_run(client, env)
    defect = client.post(
        "/api/v1/defects", json={"execution_step_id": sids[1], "severity": "High"}
    ).json()["data"]
    assert defect["title"] == "Step 2 Failed: Press Pay"
    assert defect["expected_result"] == "Payment page shows"
    assert defect["step_number"] == 2 and defect["test_run_case_id"] == rc
    assert defect["execution_evidence"]["verdict"] == "fail"


def test_link_an_existing_defect_from_a_run_case(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    case, run, rc, _ = failed_run(client, env)
    defect = make_defect(client, env, title="Already reported elsewhere")
    first = client.post(f"/api/v1/test-run-cases/{rc}/defects/{defect['id']}")
    assert first.status_code == 200 and first.json()["data"]["link_created"] is True
    assert (
        client.post(f"/api/v1/test-run-cases/{rc}/defects/{defect['id']}").json()["data"][
            "link_created"
        ]
        is False
    )
    data = get_defect(client, defect["id"])
    # The run case and (the defect had none yet) its test case are linked.
    assert {lk["linkable_type"] for lk in data["links"]} == {"test_run_case", "test_case"}
    assert [c["id"] for c in data["linked_test_cases"]] == [case["id"]]
    draft = client.get(f"/api/v1/test-run-cases/{rc}/defect-draft").json()["data"]
    assert [d["id"] for d in draft["existing_defects"]] == [defect["id"]]
    # A defect linked only to the run case is listed for that run (GET /defects?test_run_id=).
    listed = client.get("/api/v1/defects", params={"test_run_id": run["id"]}).json()["data"]
    assert defect["id"] in [d["id"] for d in listed]
    # Another project's defect is refused.
    other = extra_project(client)
    foreign = make_defect(client, other, title="Defect of another project")
    r = client.post(f"/api/v1/test-run-cases/{rc}/defects/{foreign['id']}")
    assert r.status_code == 422
    assert client.post(f"/api/v1/test-run-cases/{rc}/defects/{uuid4()}").status_code == 404


def test_draft_and_link_respect_tenant_and_tester_boundaries(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    _, _, rc, _ = failed_run(client, env)
    add_user(client, env, "tester", project_member=False)
    tester = as_user(client, env, f"tester@{env['slug']}.example.com")
    assert tester.get(f"/api/v1/test-run-cases/{rc}/defect-draft").status_code == 403
    assert (
        tester.post(
            "/api/v1/defects", json={"test_run_case_id": rc, "severity": "High"}
        ).status_code
        == 403
    )
    outsider = TestClient(client.app)
    boot = _bootstrap_tenant(outsider, platform_admin, "Beta Corp")
    _login_and_verify(outsider, boot["tenant"]["id"], "admin@betacorp.example.com", ADMIN_PW)
    assert outsider.get(f"/api/v1/test-run-cases/{rc}/defect-draft").status_code == 404
    assert (
        outsider.post(
            "/api/v1/defects", json={"test_run_case_id": rc, "severity": "High"}
        ).status_code
        == 404
    )


# --- retest --------------------------------------------------------------------------------------


def fixed_defect(client: TestClient, env: dict, case: dict, **extra) -> dict:
    defect = make_defect(client, env, test_case_id=case["id"], **extra)
    walk(client, defect["id"], "Assigned", "In Progress", "Fixed")
    return defect


def execute_retest(client: TestClient, run_case_id: str, value: str, actual: str | None = None):
    for sid in step_ids(client, run_case_id):
        r = verdict(client, sid, value, actual)
        assert r.status_code == 200, r.text


def test_retest_creates_a_retest_run_and_pass_closes_the_defect(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    case = create_case(client, env, "Case to retest")
    approve(client, case["id"])
    defect = fixed_defect(client, env, case)
    response = client.post(f"/api/v1/defects/{defect['id']}/retest", json={"comment": "Please"})
    assert response.status_code == 200, response.text
    out = response.json()["data"]
    assert out["status"] == "Retest" and len(out["run_case_ids"]) == 1
    assert out["test_case_ids"] == [case["id"]]
    run = client.get(f"/api/v1/test-runs/{out['test_run_id']}").json()["data"]
    assert run["run_type"] == "Retest" and run["name"].startswith("Retest BUG_000001")
    run_case = run["cases"][0]
    assert run_case["assigned_to"] == defect["reported_by"]  # the reporter by default
    assert run_case["test_case_id"] == case["id"]
    data = get_defect(client, defect["id"])
    assert data["status"] == "Retest" and data["resolution"] is None
    assert ("test_run_case", out["run_case_ids"][0]) in {
        (lk["linkable_type"], lk["linkable_id"]) for lk in data["links"]
    }
    # Pass before executing is refused; after executing it closes with resolution Fixed.
    early = client.post(
        f"/api/v1/defects/{defect['id']}/retest-result",
        json={"result": "pass", "run_case_id": out["run_case_ids"][0]},
    )
    assert early.status_code == 409
    execute_retest(client, out["run_case_ids"][0], "pass")
    done = client.post(
        f"/api/v1/defects/{defect['id']}/retest-result",
        json={"result": "pass", "run_case_id": out["run_case_ids"][0], "comment": "Verified"},
    )
    assert done.status_code == 200, done.text
    assert done.json()["data"]["status"] == "Closed" and done.json()["data"]["closed"] is True
    closed = get_defect(client, defect["id"])
    assert closed["status"] == "Closed" and closed["resolution"] == "Fixed" and closed["closed_at"]
    again = client.post(
        f"/api/v1/defects/{defect['id']}/retest-result",
        json={"result": "pass", "run_case_id": out["run_case_ids"][0]},
    )
    assert again.status_code == 409  # no longer in Retest
    history = client.get(f"/api/v1/defects/{defect['id']}/history").json()["data"]
    assert [h["action"] for h in history if h["action"].startswith("defect.retest")] == [
        "defect.retest_started",
        "defect.retest_result",
    ]


def test_retest_fail_reopens_and_keeps_every_earlier_execution(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    assignee = add_user(client, env, "tester")
    case = create_case(client, env, "Case that keeps failing")
    approve(client, case["id"])
    defect = fixed_defect(client, env, case, assigned_to=assignee)
    first = client.post(f"/api/v1/defects/{defect['id']}/retest").json()["data"]
    execute_retest(client, first["run_case_ids"][0], "fail", "Still broken after the fix")
    failed = client.post(
        f"/api/v1/defects/{defect['id']}/retest-result",
        json={
            "result": "fail",
            "run_case_id": first["run_case_ids"][0],
            "comment": "HTTP 500 again",
        },
    )
    assert failed.status_code == 200, failed.text
    assert failed.json()["data"]["status"] == "Reopened"
    assert failed.json()["data"]["reopened_count"] == 1
    data = get_defect(client, defect["id"])
    assert data["status"] == "Reopened" and data["resolution"] is None and data["closed_at"] is None
    assert "HTTP 500 again" in data["actual_result"]
    assert data["actual_result"].startswith("Nothing happens")  # appended, not replaced
    # The assignee was told.
    tester = as_user(client, env, f"tester@{env['slug']}.example.com")
    kinds = [n["type"] for n in tester.get("/api/v1/notifications").json()["data"]]
    assert "defect_reopened" in kinds
    # Fix again and retest again: a second, separate retest run; the first is untouched.
    walk(client, defect["id"], "In Progress", "Fixed")
    second = client.post(f"/api/v1/defects/{defect['id']}/retest").json()["data"]
    assert second["test_run_id"] != first["test_run_id"]
    execute_retest(client, second["run_case_ids"][0], "pass")
    assert (
        client.post(
            f"/api/v1/defects/{defect['id']}/retest-result",
            json={"result": "pass", "run_case_id": second["run_case_ids"][0]},
        ).json()["data"]["status"]
        == "Closed"
    )
    retests = client.get(f"/api/v1/defects/{defect['id']}/retests").json()["data"]
    assert len(retests) == 2
    by_case = {r["test_run_case_id"]: r for r in retests}
    assert by_case[first["run_case_ids"][0]]["result"] == "fail"
    assert by_case[first["run_case_ids"][0]]["run_case_status"] == "failed"  # history preserved
    assert by_case[second["run_case_ids"][0]]["result"] == "pass"
    assert by_case[second["run_case_ids"][0]]["test_case_display_id"] == case["display_id"]
    # Both executions are on the case's own history.
    executions = client.get(f"/api/v1/test-cases/{case['id']}/executions").json()["data"]
    assert [e["status"] for e in executions["items"]].count("failed") == 1
    assert len(executions["items"]) == 2


def test_retest_rules_and_permissions(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    tester_id = add_user(client, env, "tester")
    case = create_case(client, env, "Case for rules")
    approve(client, case["id"])
    plain = make_defect(client, env, title="No linked case at all")
    walk(client, plain["id"], "Assigned", "In Progress", "Fixed")
    r = client.post(f"/api/v1/defects/{plain['id']}/retest")
    assert r.status_code == 422 and "test_case_ids" in r.json()["error"]["fields"]
    new = make_defect(client, env, title="Not fixed yet", test_case_id=case["id"])
    assert client.post(f"/api/v1/defects/{new['id']}/retest").status_code == 409
    defect = fixed_defect(client, env, case)
    # A chosen tester must be an active project member; the run case goes to them.
    stranger = add_user(client, env, "manager", project_member=False)
    bad = client.post(f"/api/v1/defects/{defect['id']}/retest", json={"tester_id": stranger})
    assert bad.status_code == 422
    out = client.post(f"/api/v1/defects/{defect['id']}/retest", json={"tester_id": tester_id})
    assert out.status_code == 200, out.text
    run_case_id = out.json()["data"]["run_case_ids"][0]
    run_case = client.get(f"/api/v1/test-runs/{out.json()['data']['test_run_id']}").json()["data"][
        "cases"
    ][0]
    assert run_case["assigned_to"] == tester_id
    # retest-result needs defect.change_status (no other code is enough) and a retest run case.
    viewer = as_user(client, env, _custom_role_user(client, env, "Viewer Only", ["defect.edit"]))
    denied = viewer.post(
        f"/api/v1/defects/{defect['id']}/retest-result",
        json={"result": "pass", "run_case_id": run_case_id},
    )
    assert denied.status_code == 403
    bogus = client.post(
        f"/api/v1/defects/{defect['id']}/retest-result",
        json={"result": "pass", "run_case_id": str(uuid4())},
    )
    assert bogus.status_code == 404
    # The tester executes their retest and records the result: a Tester cannot close, so
    # the defect lands on Verified (retest passed, awaiting a close).
    tester = as_user(client, env, f"tester@{env['slug']}.example.com")
    execute_retest(tester, run_case_id, "pass")
    result = tester.post(
        f"/api/v1/defects/{defect['id']}/retest-result",
        json={"result": "pass", "run_case_id": run_case_id},
    )
    assert result.status_code == 200, result.text
    assert (
        result.json()["data"]["status"] == "Verified" and result.json()["data"]["closed"] is False
    )
    assert (
        change_status(tester, defect["id"], "Closed", verification_confirmed=True).status_code
        == 403
    )
    assert (
        change_status(client, defect["id"], "Closed", verification_confirmed=True).status_code
        == 200
    )
    # Run type Retest is available when creating a run by hand as well.
    manual = client.post(
        f"/api/v1/projects/{env['project_id']}/test-runs",
        json={"name": "Manual retest", "run_type": "Retest", "test_case_ids": [case["id"]]},
    )
    assert manual.status_code == 200 and manual.json()["data"]["run_type"] == "Retest"


# --- listing, filters, sorts, search -------------------------------------------------------------


def seed_listing(client: TestClient, env: dict, owner_engine) -> dict:
    tester_id = add_user(client, env, "tester")
    case = create_case(client, env, "Case for listing")
    a = make_defect(
        client,
        env,
        title="Alpha crash on login",
        severity="Critical",
        priority="High",
        labels=["crash", "login"],
        fix_version="1.0",
        environment="Production",
        module_id=env["module_id"],
        assigned_to=tester_id,
        description="The app crashes with a NullPointerException",
        test_case_id=case["id"],
    )
    b = make_defect(
        client,
        env,
        title="Bravo slow search",
        severity="Minor",
        priority="Low",
        labels=["perf"],
        fix_version="2.0",
        environment="Staging",
    )
    c = make_defect(
        client,
        env,
        title="Charlie typo in footer",
        severity="Major",
        priority="Medium",
        labels=["ui", "login"],
        environment="Staging UAT",
    )
    walk(client, b["id"], "Assigned", "In Progress")
    change_status(client, c["id"], "Rejected", resolution="By Design")
    return {"tester": tester_id, "case": case, "a": a, "b": b, "c": c}


def ids(response) -> list[str]:
    assert response.status_code == 200, response.text
    return [d["id"] for d in response.json()["data"]["items"]]


def test_filters(client, platform_admin, owner_engine) -> None:
    env = setup_env(client, platform_admin)
    s = seed_listing(client, env, owner_engine)
    a, b, c = s["a"]["id"], s["b"]["id"], s["c"]["id"]
    admin_id = s["a"]["reported_by"]

    def q(**params):
        return set(ids(client.get("/api/v1/defects", params={"page_size": 50, **params})))

    assert q(severity="Critical,Minor") == {a, b}
    assert q(severity=["Major", "Minor"]) == {b, c}
    assert q(priority="High") == {a}
    assert q(status="Assigned,In Progress") == {b} or q(status="In Progress") == {b}
    assert q(status=["New", "Rejected"]) == {a, c}
    assert q(assignee_id=s["tester"]) == {a} and q(assignee=s["tester"]) == {a}
    assert q(reported_by=admin_id) == {a, b, c} and q(reporter=admin_id) == {a, b, c}
    assert q(module_id=env["module_id"]) == {a} and q(module=env["module_id"]) == {a}
    assert q(labels="login") == {a, c} and q(labels="login,crash") == {a}
    assert q(label="perf") == {b}
    assert q(test_case_id=s["case"]["id"]) == {a}
    assert q(fix_version="1.0") == {a} and q(fix_version="2.0") == {b}
    assert q(environment="stag") == {b, c} and q(environment="production") == {a}
    assert q(resolution="By Design") == {c}
    tomorrow = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    yesterday = (datetime.now(UTC) - timedelta(days=1)).isoformat()
    assert q(created_from=yesterday, created_to=tomorrow) == {a, b, c}
    assert q(created_from=tomorrow) == set()
    assert q(project_id=env["project_id"], severity="Critical") == {a}
    counts = client.get("/api/v1/defects/status-counts", params={"severity": "Critical,Minor"})
    assert counts.json()["data"]["counts"] == {"New": 1, "In Progress": 1}
    # Status filter does not narrow the status counts.
    both = client.get("/api/v1/defects/status-counts", params={"status": "New"}).json()["data"]
    assert both["total"] == 3


def test_search_covers_display_id_title_description_and_labels(
    client, platform_admin, owner_engine
) -> None:
    env = setup_env(client, platform_admin)
    s = seed_listing(client, env, owner_engine)
    a, b, c = s["a"]["id"], s["b"]["id"], s["c"]["id"]

    def found(term):
        return set(ids(client.get("/api/v1/defects", params={"page_size": 50, "search": term})))

    assert found("BUG_000002") == {b}
    assert found("bug_00000") == {a, b, c}
    assert found("crash on") == {a}
    assert found("NullPointer") == {a}  # description snippet
    assert found("perf") == {b}  # label
    assert found("footer") == {c}
    assert found("50%_") == set()  # LIKE wildcards are literal


def test_sorts_and_cursor(client, platform_admin, owner_engine) -> None:
    env = setup_env(client, platform_admin)
    s = seed_listing(client, env, owner_engine)
    a, b, c = s["a"]["id"], s["b"]["id"], s["c"]["id"]

    def order(sort):
        return ids(client.get("/api/v1/defects", params={"page_size": 50, "sort": sort}))

    assert order("display_id") == [a, b, c] and order("-display_id") == [c, b, a]
    assert order("-severity") == [a, c, b] and order("severity") == [b, c, a]
    assert order("-priority") == [a, c, b]
    assert order("title") == [a, b, c]
    assert order("-status")[0] == c  # Rejected is furthest along
    assert order("assignee")[0] == a  # NULLS LAST: the assigned one first
    assert order("fix_version") == [a, b, c]
    assert order("-date_reported") == [c, b, a] and order("date_reported") == [a, b, c]
    bad = client.get("/api/v1/defects", params={"page_size": 5, "sort": "nonsense"})
    assert bad.status_code == 422
    # Keyset paging keeps working for the default order.
    page1 = client.get("/api/v1/defects", params={"page_size": 2, "cursor": ""}).json()["data"]
    assert [d["id"] for d in page1["items"]] == [c, b] and page1["next_cursor"]
    page2 = client.get(
        "/api/v1/defects", params={"page_size": 2, "cursor": page1["next_cursor"]}
    ).json()["data"]
    assert [d["id"] for d in page2["items"]] == [a] and page2["next_cursor"] is None
    no_keyset = client.get(
        "/api/v1/defects", params={"page_size": 2, "cursor": "", "sort": "title"}
    )
    assert no_keyset.status_code == 422
    # The project list works the same.
    assert set(
        ids(client.get("/api/v1/defects", params={"project_id": env["project_id"], "page_size": 9}))
    ) == {a, b, c}


def test_column_catalogue(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    add_user(client, env, "tester")
    for who in (client, as_user(client, env, f"tester@{env['slug']}.example.com")):
        data = who.get("/api/v1/defects/columns").json()["data"]
        keys = [f["key"] for f in data["fields"]]
        assert len(keys) == 22 and len(set(keys)) == 22
        assert data["default_columns"] == [
            "display_id",
            "title",
            "module",
            "severity",
            "priority",
            "status",
            "reporter",
            "assignee",
            "date_reported",
            "fix_version",
        ]
        labels = {f["key"]: f["label"] for f in data["fields"]}
        assert labels["display_id"] == "Bug ID" and labels["module"] == "Component / Module"
        assert labels["repro_steps"] == "Steps to Reproduce"
        assert {f["key"] for f in data["fields"] if f["default_visible"]} == set(
            data["default_columns"]
        )
        assert {f["key"] for f in data["fields"] if f["mandatory_on_create"]} >= {
            "title",
            "description",
            "repro_steps",
            "expected_result",
            "actual_result",
            "environment",
            "severity",
            "priority",
            "status",
            "reporter",
            "date_reported",
        }
        assert len(data["statuses"]) == 11 and len(data["resolutions"]) == 6
        assert "Retest" in data["transitions"]["Fixed"] and data["transitions"]["Closed"] == [
            "Reopened"
        ]
        assert set(data["export_columns"]) >= set(keys)
        assert {"display_id", "severity", "priority", "status", "assignee", "fix_version"} <= set(
            data["sortable"]
        )


# --- export --------------------------------------------------------------------------------------


def test_export_has_all_22_fields_and_parameters(client, platform_admin, owner_engine) -> None:
    import csv

    env = setup_env(client, platform_admin)
    s = seed_listing(client, env, owner_engine)
    upload = client.post(
        f"/api/v1/defects/{s['a']['id']}/attachments",
        files={"file": ("evidence.png", PNG, "image/png")},
    )
    assert upload.status_code == 200
    response = client.get("/api/v1/defects/export.csv", params={"sort": "display_id"})
    assert response.status_code == 200 and "attachment" in response.headers["content-disposition"]
    rows = list(csv.reader(io.StringIO(response.text)))
    header, body = rows[0], rows[1:]
    labels = [f.label for f in field_standards.DEFECT_FIELDS]
    assert header[:22] == labels and header[22] == "Root Cause Notes"
    assert len(body) == 3
    first = dict(zip(header, body[0], strict=True))
    assert first["Bug ID"] == "BUG_000001" and first["Title"] == "Alpha crash on login"
    assert first["Severity"] == "Critical" and first["Priority"] == "High"
    assert first["Status"] == "New" and first["Fix Version / Target Milestone"] == "1.0"
    assert first["Labels / Tags"] == "crash; login" and first["Environment"] == "Production"
    assert first["Component / Module"] == "Claims" and first["Assignee"]
    assert first["Reporter"] and first["Date Reported"]
    assert first["Attachments / Evidence"] == "evidence.png"
    assert first["Linked Issues / Test Case ID"] == s["case"]["display_id"]
    assert first["Steps to Reproduce"].splitlines()[0].startswith("1. Open the login page")
    assert first["Expected Result"] and first["Actual Result"] and first["Description"]
    # columns= selects and orders; unknown / repeated keys are a 422.
    picked = client.get(
        "/api/v1/defects/export.csv", params={"columns": "status,display_id", "sort": "display_id"}
    )
    parsed = list(csv.reader(io.StringIO(picked.text)))
    assert parsed[0] == ["Status", "Bug ID"] and parsed[1] == ["New", "BUG_000001"]
    assert client.get("/api/v1/defects/export.csv", params={"columns": "nope"}).status_code == 422
    assert (
        client.get("/api/v1/defects/export.csv", params={"columns": "status,status"}).status_code
        == 422
    )
    # ids= exports just those rows (still within the filters).
    only = client.get(
        "/api/v1/defects/export.csv", params={"ids": f"{s['b']['id']},{s['c']['id']}"}
    )
    assert len(list(csv.reader(io.StringIO(only.text)))) == 3
    assert client.get("/api/v1/defects/export.csv", params={"ids": "not-a-uuid"}).status_code == 422
    # The list filters apply.
    filtered = client.get("/api/v1/defects/export.csv", params={"severity": "Critical"})
    assert len(list(csv.reader(io.StringIO(filtered.text)))) == 2
    # XLSX is a real workbook with the same rows.
    xlsx = client.get("/api/v1/defects/export.xlsx", params={"columns": "display_id,title"})
    assert xlsx.status_code == 200 and zipfile.is_zipfile(io.BytesIO(xlsx.content))


def test_export_guards_formula_injection_and_respects_visibility(
    client, platform_admin, owner_engine
) -> None:
    env = setup_env(client, platform_admin)
    make_defect(client, env, title="=HYPERLINK(1) attack", labels=["+cmd"])
    text_ = client.get("/api/v1/defects/export.csv", params={"columns": "title,labels"}).text
    assert "'=HYPERLINK(1) attack" in text_ and "'+cmd" in text_
    # A Tester with the export code only sees the projects they are assigned to.
    add_user(client, env, "tester", project_member=False)
    other = extra_project(client, "Hidden project")
    make_defect(client, other, title="Defect in a hidden project")
    exporter = _custom_role_user(client, env, "Defect Exporter", ["defect.export"], member=False)
    seen = as_user(client, env, exporter).get(
        "/api/v1/defects/export.csv", params={"columns": "title"}
    )
    assert seen.status_code == 200
    assert "hidden project" not in seen.text  # custom role is on the tester tier


# --- saved views ---------------------------------------------------------------------------------


def test_saved_views_accept_the_defect_filters_and_sorts(client, platform_admin) -> None:
    setup_env(client, platform_admin)
    ok = client.post(
        "/api/v1/saved-views",
        json={
            "list_key": "defects",
            "name": "Open majors",
            "filters": {
                "status": "New,Assigned,In Progress",
                "severity": "Critical,Major",
                "priority": "High",
                "labels": "login,crash",
                "fixVersion": "2.0",
                "environment": "Staging",
                "resolution": "Fixed",
                "search": "BUG_0001",
            },
            "sort": "-severity",
            "columns": ["display_id", "title", "severity"],
        },
    )
    assert ok.status_code == 200, ok.text
    # An apostrophe is allowed in a token, so Won't Fix can be saved in a view.
    wont = client.post(
        "/api/v1/saved-views",
        json={"list_key": "defects", "name": "Won't fix", "filters": {"resolution": "Won't Fix"}},
    )
    assert wont.status_code == 200, wont.text
    for filters, sort in (
        ({"nonsense": "x"}, None),
        ({"status": "a" * 300}, None),
        ({"assigneeId": "not-a-uuid"}, None),
        ({}, "random"),
    ):
        bad = client.post(
            "/api/v1/saved-views",
            json={"list_key": "defects", "name": "Bad view", "filters": filters, "sort": sort},
        )
        assert bad.status_code == 422, (filters, sort)


# --- audit, attachments, comments ----------------------------------------------------------------


def test_attachment_upload_and_delete_are_audited(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    defect = make_defect(client, env)
    up = client.post(
        f"/api/v1/defects/{defect['id']}/attachments",
        files={"file": ("trace.png", PNG, "image/png")},
    )
    assert up.status_code == 200
    # type and size validation stay in force.
    bad = client.post(
        f"/api/v1/defects/{defect['id']}/attachments",
        files={"file": ("run.exe", b"MZ" + b"\x00" * 10, "application/octet-stream")},
    )
    assert bad.status_code == 422
    spoof = client.post(
        f"/api/v1/defects/{defect['id']}/attachments",
        files={"file": ("fake.png", b"not a png", "image/png")},
    )
    assert spoof.status_code == 422
    assert client.delete(f"/api/v1/attachments/{up.json()['data']['id']}").status_code == 200
    history = client.get(f"/api/v1/defects/{defect['id']}/history").json()["data"]
    added = next(h for h in history if h["action"] == "defect.attachment_added")
    removed = next(h for h in history if h["action"] == "defect.attachment_removed")
    assert added["changes"]["attachments"] == {"from": None, "to": "trace.png"}
    assert removed["changes"]["attachments"] == {"from": "trace.png", "to": None}
    assert added["event_metadata"]["size_bytes"] == len(PNG)


def test_comment_is_audited_and_audit_chain_stays_valid(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    defect = make_defect(client, env)
    posted = client.post(
        f"/api/v1/defects/{defect['id']}/comments", json={"body": "Looking into it"}
    )
    assert posted.status_code == 200, posted.text
    walk(client, defect["id"], "Assigned")
    client.patch(f"/api/v1/defects/{defect['id']}", json={"priority": "Low"})
    history = client.get(f"/api/v1/defects/{defect['id']}/history").json()["data"]
    actions = [h["action"] for h in history]
    assert "defect.created" in actions and "defect.status_changed" in actions
    updated = next(h for h in history if h["action"] == "defect.updated")
    assert updated["changes"]["priority"] == {"from": "High", "to": "Low"}
    created = next(h for h in history if h["action"] == "defect.created")
    assert created["changes"]["severity"] == {"from": None, "to": "Major"}
    assert any("comment" in a for a in actions)
    verify = client.get("/api/v1/audit/verify")
    assert verify.status_code in (200, 404)
    if verify.status_code == 200:
        assert verify.json()["data"].get("valid", True) is True


def test_assignment_is_audited_and_notifies_the_assignee(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    tester_id = add_user(client, env, "tester")
    defect = make_defect(client, env)
    r = client.patch(f"/api/v1/defects/{defect['id']}", json={"assigned_to": tester_id})
    assert r.status_code == 200
    history = client.get(f"/api/v1/defects/{defect['id']}/history").json()["data"]
    assigned = next(h for h in history if h["action"] == "defect.assigned")
    assert assigned["changes"]["assigned_to"] == {"from": None, "to": tester_id}
    tester = as_user(client, env, f"tester@{env['slug']}.example.com")
    kinds = [n["type"] for n in tester.get("/api/v1/notifications").json()["data"]]
    assert kinds == ["defect_assigned"]


# --- soft delete, RLS, tester visibility ---------------------------------------------------------


def test_soft_deleted_defects_disappear_from_every_listing(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    case = create_case(client, env, "Case with a deleted defect")
    gone = make_defect(client, env, title="Soon deleted defect", test_case_id=case["id"])
    kept = make_defect(client, env, title="Kept defect here")
    assert client.delete(f"/api/v1/defects/{gone['id']}").status_code == 200
    assert client.get(f"/api/v1/defects/{gone['id']}").status_code == 404
    assert [d["id"] for d in client.get("/api/v1/defects").json()["data"]] == [kept["id"]]
    assert client.get(f"/api/v1/test-cases/{case['id']}/defects").json()["data"] == []
    export = client.get("/api/v1/defects/export.csv", params={"columns": "title"}).text
    assert "Soon deleted" not in export and "Kept defect" in export
    assert client.get("/api/v1/defects/status-counts").json()["data"]["total"] == 1
    # The display id is never reused.
    assert make_defect(client, env, title="After the delete")["display_id"] == "BUG_000003"


def test_rls_isolation_of_the_new_endpoints(client, platform_admin) -> None:
    env = setup_env(client, platform_admin, "Alpha Corp")
    case = create_case(client, env, "Tenant A case")
    defect = make_defect(client, env, title="Tenant A secret defect", test_case_id=case["id"])
    other = TestClient(client.app)
    boot = _bootstrap_tenant(other, platform_admin, "Beta Corp")
    _login_and_verify(other, boot["tenant"]["id"], "admin@betacorp.example.com", ADMIN_PW)
    did = defect["id"]
    for method, url in (
        ("get", f"/api/v1/defects/{did}"),
        ("get", f"/api/v1/defects/{did}/test-cases"),
        ("get", f"/api/v1/defects/{did}/retests"),
        ("get", f"/api/v1/defects/{did}/history"),
        ("post", f"/api/v1/defects/{did}/test-cases/{case['id']}"),
        ("delete", f"/api/v1/defects/{did}/test-cases/{case['id']}"),
        ("get", f"/api/v1/test-cases/{case['id']}/defects"),
        ("post", f"/api/v1/defects/{did}/retest"),
        ("delete", f"/api/v1/defects/{did}"),
    ):
        assert getattr(other, method)(url).status_code == 404, (method, url)
    assert other.patch(f"/api/v1/defects/{did}", json={"title": "Hijacked"}).status_code == 404
    assert (
        other.patch(f"/api/v1/defects/{did}/status", json={"status": "Assigned"}).status_code == 404
    )
    assert other.get("/api/v1/defects", params={"search": "secret"}).json()["data"] == []
    assert "secret" not in other.get("/api/v1/defects/export.csv").text
    project_b = _create_project(other, "Beta Project")
    module_b = other.post(
        f"/api/v1/projects/{project_b['id']}/modules", json={"name": "Core"}
    ).json()["data"]
    mine = make_defect(other, {"project_id": project_b["id"], **module_b}, title="Tenant B defect")
    assert mine["display_id"] == "BUG_000001"  # ids restart per tenant
    cross = other.post(f"/api/v1/defects/{mine['id']}/test-cases/{case['id']}")
    assert cross.status_code == 404


def test_tester_sees_only_assigned_projects_and_cases(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    add_user(client, env, "tester")
    mine = create_case(client, env, "Visible case for tester")
    defect = make_defect(client, env, test_case_id=mine["id"])
    hidden = extra_project(client, "Not assigned")
    hidden_defect = make_defect(client, hidden, title="Hidden project defect")
    tester = as_user(client, env, f"tester@{env['slug']}.example.com")
    listed = [d["id"] for d in tester.get("/api/v1/defects").json()["data"]]
    assert listed == [defect["id"]]
    assert tester.get(f"/api/v1/defects/{hidden_defect['id']}").status_code == 403
    assert tester.get(f"/api/v1/defects/{hidden_defect['id']}/test-cases").status_code == 403
    assert tester.get("/api/v1/defects", params={"search": "Hidden"}).json()["data"] == []
    # With the "assigned cases only" switch on, an unassigned linked case is not listed.
    assert (
        client.patch("/api/v1/settings", json={"testers_see_assigned_cases_only": True}).status_code
        == 200
    )
    assert tester.get(f"/api/v1/defects/{defect['id']}/test-cases").json()["data"] == []
    assert tester.get(f"/api/v1/test-cases/{mine['id']}/defects").status_code == 404


# --- statuses in reports, dashboards, SLA, notifications -----------------------------------------


def test_reports_and_dashboard_treat_the_new_statuses_sensibly(
    client, platform_admin, owner_engine
) -> None:
    env = setup_env(client, platform_admin)
    expected_open = {
        "New",
        "Open",
        "Assigned",
        "In Progress",
        "Reopened",
        "Retest",
        "Fixed",
        "Verified",
        "Deferred",
    }
    made = {}
    for status in field_standards.DEFECT_STATUSES:
        d = make_defect(client, env, title=f"Defect in {status}", severity="Critical")
        resolution = (
            "Fixed"
            if status in ("Closed", "Verified")
            else ("Duplicate" if status == "Rejected" else None)
        )
        set_status(owner_engine, d["id"], status, resolution)
        made[status] = d["id"]
    aging = client.get("/api/v1/reports/defect-aging").json()["data"]
    # Everything except Closed and Rejected still counts (Deferred is open but parked).
    assert aging["total_open"] == len(expected_open) == 9
    dash = client.get("/api/v1/dashboard/summary").json()["data"]["defects"]
    assert dash["critical_count"] == 9  # not Closed / Rejected (as for the aging report)
    assert dash["open_by_severity"]["Critical"] == 9
    assert set(field_standards.OPEN_DEFECT_STATUSES) == {
        "New",
        "Open",
        "Assigned",
        "In Progress",
        "Reopened",
        "Retest",
    }
    assert set(field_standards.CLOSED_DEFECT_STATUSES) == {"Closed", "Rejected"}
    assert set(field_standards.AWAITING_VERIFICATION_STATUSES) == {"Fixed", "Retest", "Verified"}
    assert field_standards.PARKED_DEFECT_STATUSES == ("Deferred",)
    projects = client.get("/api/v1/projects").json()["data"]
    listed = projects["items"] if isinstance(projects, dict) else projects
    mine = next(p for p in listed if p["id"] == env["project_id"])
    assert mine["open_defect_count"] == 9  # Closed and Rejected do not count


def test_sla_ignores_parked_and_finished_defects(
    client, platform_admin, owner_engine, db_session
) -> None:
    env = setup_env(client, platform_admin)
    old = datetime.now(UTC) - timedelta(days=40)
    by_status = {}
    for status in ("Assigned", "Deferred", "Rejected", "Closed", "Reopened"):
        d = make_defect(client, env, title=f"Old defect {status}", severity="Critical")
        set_status(
            owner_engine,
            d["id"],
            status,
            {"Closed": "Fixed", "Rejected": "Duplicate"}.get(status),
        )
        with owner_engine.begin() as conn:
            conn.execute(
                text("UPDATE defects SET created_at = :c, closed_at = :x WHERE id = :i"),
                {
                    "c": old,
                    "x": old + timedelta(days=1) if status in ("Closed", "Rejected") else None,
                    "i": d["id"],
                },
            )
        by_status[status] = d["id"]
    out = {s: get_defect(client, i) for s, i in by_status.items()}
    assert out["Assigned"]["sla_breached"] is True and out["Reopened"]["sla_breached"] is True
    assert out["Deferred"]["sla_breached"] is False  # parked
    assert out["Deferred"]["age_days"] >= 40
    assert out["Closed"]["sla_breached"] is False  # resolved within the budget
    aging = client.get("/api/v1/reports/defect-aging").json()["data"]
    critical = next(b for b in aging["buckets"] if b["severity"] == "Critical")
    assert critical["open_count"] == 3 and critical["breached_count"] == 2
    # The sweep notifies only about the breached, unfinished, unparked ones.
    tenant_id = UUID(env["tenant_id"])
    from app.core.db import set_tenant_context

    set_tenant_context(db_session, str(tenant_id))
    sent = defect_service.sweep_sla_breaches(db_session)
    assert sent == 2  # the admin is reporter of both breached defects -> 1 each
    notes = client.get("/api/v1/notifications").json()["data"]
    assert {n["entity_id"] for n in notes} == {by_status["Assigned"], by_status["Reopened"]}


def test_sla_budget_for_the_new_severities() -> None:
    assert defect_service.SLA_DAYS_ALL["Major"] == 5 and defect_service.SLA_DAYS_ALL["Minor"] == 15
    assert defect_service.SLA_DAYS_ALL["Critical"] == 2
    assert set(defect_service.SLA_DAYS_BY_SEVERITY) == {"Critical", "High", "Medium", "Low"}


def test_status_labels_cover_every_status_and_report_builder_lists_them(
    client, platform_admin
) -> None:
    setup_env(client, platform_admin)
    labels = client.get("/api/v1/status-labels", params={"entity_type": "defect"})
    assert labels.status_code == 200
    codes = {row["status_code"] for row in labels.json()["data"]}
    assert set(field_standards.DEFECT_STATUSES) <= codes
    from app.schemas.report_builder import SOURCES

    assert set(SOURCES["defects"]["status"].options) == set(field_standards.DEFECT_STATUSES)


def test_closed_defect_cannot_be_edited_but_can_be_reopened(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    defect = make_defect(client, env)
    walk(client, defect["id"], "Open", "Fixed", "Verified", "Closed")
    assert (
        client.patch(f"/api/v1/defects/{defect['id']}", json={"title": "Edit closed"}).status_code
        == 403
    )
    assert (
        client.post(f"/api/v1/defects/{defect['id']}/reopen").json()["data"]["status"] == "Reopened"
    )
    assert client.patch(
        f"/api/v1/defects/{defect['id']}", json={"title": "Edit reopened"}
    ).is_success


# --- CSV import ----------------------------------------------------------------------------------


LEGACY_HEADER = (
    "Title,Project Name,Severity,Priority,Description,Steps to Reproduce,"
    "Expected Result,Actual Result,Environment,Module,Assignee Email"
)
EXT_HEADER = (
    LEGACY_HEADER
    + ",Bug ID,Preconditions,Build Found,Fix Version,Labels,Linked Test Case IDs,Root Cause,"
    "Root Cause Notes"
)


def upload(client: TestClient, csv_text: str):
    return client.post(
        "/api/v1/defects/import", files={"file": ("defects.csv", csv_text, "text/csv")}
    )


def test_import_legacy_file_keeps_its_rules(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    project = client.get(f"/api/v1/projects/{env['project_id']}").json()["data"]["name"]
    legacy = (
        LEGACY_HEADER
        + f'\nLegacy imported defect,{project},High,Medium,"Described","1. Open|2. Click",,,,,\n'
        + f"Broken legacy row,{project},Nope,Medium,Described,,,,,,\n"
    )
    r = upload(client, legacy)
    assert r.status_code == 200, r.text
    report = r.json()["data"]
    assert report["created_count"] == 1 and report["error_count"] == 1
    created = client.get("/api/v1/defects").json()["data"][0]
    assert created["display_id"] == "BUG_000001" and created["status"] == "New"
    assert [s["action"] for s in created["repro_steps"]] == ["Open", "Click"]
    # Headers outside the legacy + extension sets are refused.
    assert upload(client, LEGACY_HEADER + ",Surprise\n").status_code == 422


def test_import_new_columns_keep_unique_ids_validate_links_and_mandatory_fields(
    client, platform_admin
) -> None:
    env = setup_env(client, platform_admin)
    project = client.get(f"/api/v1/projects/{env['project_id']}").json()["data"]["name"]
    case = create_case(client, env, "Case to link on import")
    existing = make_defect(client, env, title="Existing defect BUG_000001")
    assert existing["display_id"] == "BUG_000001"

    def row(title, bug_id="", linked="", labels="", **over):
        v = {
            "steps": "1. Open page|2. Press",
            "expected": "Works",
            "actual": "Fails",
            "env": "Staging",
        }
        v.update(over)
        return (
            f'{title},{project},Major,High,"Imported description","{v["steps"]}",{v["expected"]},'
            f"{v['actual']},{v['env']},,,{bug_id},Pre,2.1,3.0,\"{labels}\",\"{linked}\","
            "code_defect,Notes\n"
        )

    body = EXT_HEADER + "\n"
    body += row(
        "Keeps its id here", bug_id="BUG_000040", labels="Login; UI", linked=case["display_id"]
    )
    body += row("Clashes with existing", bug_id="BUG_000001")  # taken -> assigned
    body += row("Repeated id in file", bug_id="BUG_000040")  # repeated -> assigned
    body += row("Malformed id value", bug_id="BUG-7")  # malformed -> assigned
    body += row("Unknown linked case", linked="TC_999999")
    body += row("Missing steps here", steps="")
    body += row("Missing expected here", expected="")
    body += row("Missing actual here", actual="")
    body += row("Missing environment", env="")
    r = upload(client, body)
    assert r.status_code == 200, r.text
    report = r.json()["data"]
    assert report["created_count"] == 4 and report["error_count"] == 5
    errors = {e["row_number"]: " ".join(e["errors"]) for e in report["rows"]}
    assert "TC_999999" in errors[5] and "Steps" in errors[6] and "Expected" in errors[7]
    assert "Actual" in errors[8] and "Environment" in errors[9]
    by_title = {
        d["title"]: d
        for d in client.get("/api/v1/defects", params={"page_size": 50}).json()["data"]["items"]
    }
    assert by_title["Keeps its id here"]["display_id"] == "BUG_000040"
    assert by_title["Keeps its id here"]["labels"] == ["login", "ui"]
    assert by_title["Keeps its id here"]["linked_test_cases"][0]["id"] == case["id"]
    assert by_title["Keeps its id here"]["build_found"] == "2.1"
    assert by_title["Keeps its id here"]["fix_version"] == "3.0"
    assert by_title["Keeps its id here"]["root_cause"] == "code_defect"
    assigned = {
        by_title[t]["display_id"]
        for t in ("Clashes with existing", "Repeated id in file", "Malformed id value")
    }
    assert len(assigned) == 3 and "BUG_000001" not in assigned and "BUG_000040" not in assigned
    assert all(int(a.split("_")[1]) > 40 for a in assigned)  # the counter moved past BUG_000040
    nxt = make_defect(client, env, title="Created after the import")
    assert int(nxt["display_id"].split("_")[1]) > max(int(a.split("_")[1]) for a in assigned)
    # Bad labels / root cause are row errors.
    bad = upload(
        client,
        EXT_HEADER + "\n" + row("Bad root cause row", labels=",".join(f"l{i}" for i in range(25))),
    )
    assert bad.json()["data"]["error_count"] == 1


# --- columns of the old and new schema stay consistent -------------------------------------------


def test_field_catalogue_matches_the_standard_constants() -> None:
    assert [f.key for f in field_standards.DEFECT_FIELDS][0] == "display_id"
    assert len(field_standards.DEFECT_FIELDS) == 22
    assert len(field_standards.DEFAULT_VISIBLE_DEFECT_FIELDS) == 10
    assert set(field_standards.DEFAULT_VISIBLE_DEFECT_FIELDS) <= {
        f.key for f in field_standards.DEFECT_FIELDS
    }
    assert [s for s in field_standards.CREATE_DEFECT_STATUSES] == ["New", "Assigned"]
    message = field_standards.transition_error("New", "Closed")
    assert message and "allowed next statuses" in message
    assert field_standards.transition_error("New", "Assigned") is None
    assert field_standards.transition_error("New", "Bogus")
