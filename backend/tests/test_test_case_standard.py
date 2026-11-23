"""ADR-116 (22-field standard, step 2): the Test Case backend.

Mandatory fields on create, validation limits, versioning, soft delete, derived
execution status, the executions history, duplicate, filters / search / sorts, the
column catalogue, export and import of the new fields, RBAC matrices, RLS and
tester visibility, audit before/after. (The shared builder in conftest fills the
new mandatory fields for older tests; the tests here that exercise the validation
send `X-Test-Strict-Create` to talk to the API like a real client.)
"""

import importlib.util
import io
import json
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core import field_standards
from app.core.config import get_settings
from app.services import csv_import_service, test_case_service
from tests.conftest import STRICT_CREATE_HEADER
from tests.test_project_role_scoping import (
    _bootstrap_tenant,
    _create_project,
    _create_user,
    _login_and_verify,
)

ADMIN_PW = "AdminPassw0rd!"
USER_PW = "UserPassw0rd!!"
STRICT = {STRICT_CREATE_HEADER: "1"}
STEPS = [{"action": "Open the page", "expected": "Page opens"}]


def full_body(title: str = "Verify login works", **extra) -> dict:
    body = {
        "title": title,
        "module_id": None,  # filled by the caller
        "priority": "High",
        "preconditions": "User exists",
        "test_data": "user=alice",
        "steps": STEPS,
        "expected_result": "User is signed in",
    }
    body.update(extra)
    return body


def setup_env(client: TestClient, platform_admin: dict, name: str = "Std Corp") -> dict:
    slug = name.lower().replace(" ", "")
    boot = _bootstrap_tenant(client, platform_admin, name)
    tenant_id = boot["tenant"]["id"]
    admin_email = f"admin@{slug}.example.com"
    _login_and_verify(client, tenant_id, admin_email, ADMIN_PW)
    project = _create_project(client, f"{name} Claims")
    module = client.post(f"/api/v1/projects/{project['id']}/modules", json={"name": "Claims"})
    assert module.status_code == 200, module.text
    return {
        "tenant_id": tenant_id,
        "admin_email": admin_email,
        "slug": slug,
        "project_id": project["id"],
        "module_id": module.json()["data"]["id"],
    }


def create_case(client: TestClient, env: dict, title: str = "Verify login works", **extra) -> dict:
    body = full_body(title, **extra)
    if body.get("module_id") is None:
        body["module_id"] = env["module_id"]
    response = client.post(
        f"/api/v1/projects/{env['project_id']}/test-cases", json=body, headers=STRICT
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def add_user(client: TestClient, env: dict, role: str, project_member: bool = True) -> str:
    user_id = _create_user(client, f"{role}@{env['slug']}.example.com", role.title(), role, USER_PW)
    if project_member:
        r = client.post(f"/api/v1/projects/{env['project_id']}/members", json={"user_id": user_id})
        assert r.status_code == 200, r.text
    return user_id


def login_as(client: TestClient, env: dict, email: str, password: str = USER_PW) -> None:
    _login_and_verify(client, env["tenant_id"], email, password)


def approve(client: TestClient, case_id: str) -> dict:
    client.post(f"/api/v1/test-cases/{case_id}/submit-review")
    response = client.post(f"/api/v1/test-cases/{case_id}/approve")
    assert response.status_code == 200, response.text
    return response.json()["data"]


def make_run(client: TestClient, env: dict, case_ids: list[str], name: str = "Run A") -> dict:
    response = client.post(
        f"/api/v1/projects/{env['project_id']}/test-runs",
        json={"name": name, "run_type": "Smoke", "test_case_ids": case_ids},
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def step_ids(client: TestClient, run_case_id: str) -> list[str]:
    return [
        s["id"] for s in client.get(f"/api/v1/test-run-cases/{run_case_id}/steps").json()["data"]
    ]


def verdict(client: TestClient, step_id: str, value: str, actual: str | None = None):
    body: dict = {"verdict": value}
    if actual is not None:
        body["actual_result"] = actual
    return client.post(f"/api/v1/execution-steps/{step_id}/verdict", json=body)


def run_and_verdict(client, env, case_id, value="pass", actual=None, name="Run A") -> dict:
    run = make_run(client, env, [case_id], name)
    rc = run["cases"][0]["id"]
    for sid in step_ids(client, rc):
        r = verdict(client, sid, value, actual)
        assert r.status_code == 200, r.text
    return run


def get_case(client: TestClient, case_id: str) -> dict:
    response = client.get(f"/api/v1/test-cases/{case_id}")
    assert response.status_code == 200, response.text
    return response.json()["data"]


# --- mandatory fields and validation ----------------------------------------------------


def test_create_requires_every_mandatory_field_with_a_message_each(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    url = f"/api/v1/projects/{env['project_id']}/test-cases"
    # Only title, priority and steps: module, preconditions, test data and expected result
    # are all reported together.
    response = client.post(
        url, json={"title": "Bare minimum", "priority": "High", "steps": STEPS}, headers=STRICT
    )
    assert response.status_code == 422
    error = response.json()["error"]
    assert set(error["fields"]) == {"module_id", "preconditions", "test_data", "expected_result"}
    assert "Module is required" == error["fields"]["module_id"]
    # Each one alone.
    for field in ("module_id", "preconditions", "test_data", "expected_result"):
        body = full_body(module_id=env["module_id"])
        body.pop(field)
        r = client.post(url, json=body, headers=STRICT)
        assert r.status_code == 422, field
        assert list(r.json()["error"]["fields"]) == [field]
    # Blank (whitespace) counts as missing.
    body = full_body(module_id=env["module_id"], preconditions="   ")
    assert client.post(url, json=body, headers=STRICT).status_code == 422
    # Schema-level ones name their field too.
    for bad in ({"title": "abc"}, {"steps": []}, {"priority": ""}):
        r = client.post(url, json=full_body(module_id=env["module_id"], **bad), headers=STRICT)
        assert r.status_code == 422
        assert next(iter(r.json()["error"]["fields"])) in {"title", "steps", "priority"}
    # And the complete request works.
    ok = client.post(url, json=full_body(module_id=env["module_id"]), headers=STRICT)
    assert ok.status_code == 200, ok.text


def test_create_stores_and_returns_all_fields(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    sub = client.post(
        f"/api/v1/projects/{env['project_id']}/modules",
        json={"name": "Total Loss", "parent_id": env["module_id"]},
    ).json()["data"]
    feature = client.post(
        f"/api/v1/projects/{env['project_id']}/modules",
        json={"name": "Settlement", "parent_id": sub["id"]},
    ).json()["data"]
    case = create_case(
        client,
        env,
        module_id=feature["id"],
        description="Some **markdown**<script>alert(1)</script><b>bold</b>",
        test_type="UI",
        severity="Major",
        automation_status="Candidate for Automation",
        environment="Staging",
        requirement_ref="US-101",
        postconditions="Session closed",
        test_data='{"user": "alice"}',
        steps=[
            {"step_no": 7, "action": "Open", "expected_result": "Opens", "test_data": "url=/"},
            {"step_no": 2, "action": "Click", "expected": "Clicked"},
        ],
    )
    assert case["display_id"] == "TC_000001"
    assert case["status"] == case["review_status"] == "draft"
    assert case["review_status_label"] == case["status_label"]
    assert case["module_path"] == "Claims/Total Loss/Settlement"
    assert case["module_name"] == "Settlement"
    assert case["description"] == "Some **markdown**bold"  # no HTML is stored
    assert case["test_type"] == "UI" and case["severity"] == "Major"
    assert case["automation_status"] == "Candidate for Automation"
    assert case["environment"] == "Staging" and case["requirement_ref"] == "US-101"
    assert case["preconditions"] == case["prerequisite"] == "User exists"
    assert case["postconditions"] == "Session closed"
    assert case["expected_result"] == "User is signed in"
    assert case["test_data_format"] == "json"
    assert [s["step_no"] for s in case["steps"]] == [1, 2]  # renumbered from list order
    assert case["steps"][0]["test_data"] == "url=/"
    assert case["steps"][0]["expected_result"] == "Opens"
    assert case["created_by_name"] == "Admin A"
    assert case["execution_status"] == "Not Run"
    assert case["last_executed_by"] is None and case["last_executed_at"] is None
    assert case["linked_defects"] == [] and case["attachment_count"] == 0
    # Defaults: Manual automation, plain text test data.
    plain = create_case(client, env, "Plain case here", test_data="free text")
    assert plain["automation_status"] == "Manual" and plain["test_data_format"] == "text"
    assert plain["display_id"] == "TC_000002"
    # `prerequisite` is still accepted as the old name of preconditions.
    body = full_body("Legacy name case", module_id=env["module_id"], prerequisite="old name")
    body.pop("preconditions")
    legacy = client.post(
        f"/api/v1/projects/{env['project_id']}/test-cases", json=body, headers=STRICT
    )
    assert legacy.status_code == 200, legacy.text
    assert legacy.json()["data"]["preconditions"] == "old name"
    body["preconditions"] = "different"
    clash = client.post(
        f"/api/v1/projects/{env['project_id']}/test-cases", json=body, headers=STRICT
    )
    assert clash.status_code == 422


def test_validation_boundaries(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    url = f"/api/v1/projects/{env['project_id']}/test-cases"

    def post(**extra):
        body = full_body(module_id=env["module_id"])
        body.update(extra)
        return client.post(url, json=body, headers=STRICT)

    assert post(title="a" * 255).status_code == 200
    assert post(title="b" * 256).status_code == 422
    assert post(title="abcd").status_code == 422
    assert post(title="abcde").status_code == 200
    assert post(title="desc at limit", description="d" * 20_000).status_code == 200
    assert post(title="desc over limit", description="d" * 20_001).status_code == 422
    assert post(title="data at limit", test_data="x" * 20_000).status_code == 200
    assert post(title="data over limit", test_data="x" * 20_001).status_code == 422
    steps_200 = [{"action": f"a{i}", "expected": f"e{i}"} for i in range(200)]
    assert post(title="two hundred steps", steps=steps_200).status_code == 200
    assert post(title="too many steps", steps=steps_200 + steps_200[:1]).status_code == 422
    assert (
        post(title="long step", steps=[{"action": "a" * 2001, "expected": "e"}]).status_code == 422
    )
    assert (
        post(title="html only step", steps=[{"action": "<b></b>", "expected": "e"}]).status_code
        == 422
    )
    # Enumerations.
    assert post(title="bad automation", automation_status="Sometimes").status_code == 422
    assert post(title="bad test type", test_type="Whatever").status_code == 422
    assert post(title="bad severity", severity="Blocker").status_code == 422
    assert post(title="good test type", test_type="End-to-End", severity="Minor").status_code == 200
    # Test data: malformed JSON is refused only when the format hint says json.
    bad_json = "{not json"
    assert post(title="auto malformed", test_data=bad_json).status_code == 200
    assert (
        post(title="text malformed", test_data=bad_json, test_data_format="text").status_code == 200
    )
    refused = post(title="json malformed", test_data=bad_json, test_data_format="json")
    assert refused.status_code == 422
    assert post(title="json ok here", test_data="[1,2]", test_data_format="json").status_code == 200


def test_test_type_list_is_the_standard_one_in_order(client, platform_admin) -> None:
    setup_env(client, platform_admin)
    options = client.get("/api/v1/field-options?field_key=test_type").json()["data"]
    assert [o["code"] for o in options] == list(field_standards.TEST_TYPE_DEFAULTS)
    assert [o["code"] for o in options] == [
        "Functional", "UI", "Smoke", "Regression", "Integration", "System",
        "End-to-End", "Security", "Performance", "Compatibility", "Usability", "API",
    ]  # fmt: skip


def _load_migration():
    path = next(
        (Path(__file__).resolve().parent.parent / "alembic" / "versions").glob("e4c8a1d7f3b9_*.py")
    )
    spec = importlib.util.spec_from_file_location("test_type_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_test_type_migration_adds_missing_options_and_keeps_legacy(
    client, platform_admin, owner_engine
) -> None:
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    env = setup_env(client, platform_admin)
    migration = _load_migration()
    with owner_engine.begin() as conn:
        # Put the tenant back in the step-1 state: Sanity/UAT present, UI/End-to-End absent.
        conn.execute(text("DELETE FROM field_options WHERE field_key='test_type'"))
        for pos, code in enumerate(migration.OLD_ORDER):
            conn.execute(
                text(
                    "INSERT INTO field_options (tenant_id, field_key, code, label, sort_order) "
                    "VALUES (:t, 'test_type', :c, :c, :p)"
                ),
                {"t": env["tenant_id"], "c": code, "p": pos},
            )
        conn.execute(
            text(
                "INSERT INTO field_options (tenant_id, field_key, code, label, sort_order) "
                "VALUES (:t, 'test_type', 'Custom Type', 'Custom Type', 50)"
            ),
            {"t": env["tenant_id"]},
        )

    def codes() -> list[str]:
        with owner_engine.begin() as conn:
            return [
                r[0]
                for r in conn.execute(
                    text(
                        "SELECT code FROM field_options WHERE field_key='test_type' "
                        "AND tenant_id=:t ORDER BY sort_order, code"
                    ),
                    {"t": env["tenant_id"]},
                )
            ]

    def run(fn) -> None:
        with owner_engine.begin() as conn:
            with Operations.context(Operations(MigrationContext.configure(conn))):
                fn()

    run(migration.upgrade)
    after = codes()
    assert after[:12] == list(field_standards.TEST_TYPE_DEFAULTS)
    assert after[12:14] == ["Sanity", "UAT"]  # kept, after the standard twelve
    assert "Custom Type" in after
    run(migration.upgrade)  # idempotent
    assert codes() == after
    run(migration.downgrade)
    down = codes()
    assert "UI" not in down and "End-to-End" not in down
    assert down[:3] == ["Functional", "Regression", "Smoke"]  # step-1 order restored
    run(migration.upgrade)
    assert codes() == after


# --- immutability, legacy rows, versions --------------------------------------------------


def test_display_id_immutable_on_patch(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    case = create_case(client, env)
    bad = client.patch(f"/api/v1/test-cases/{case['id']}", json={"display_id": "TC_999999"})
    assert bad.status_code == 422 and "immutable" in bad.json()["error"]["message"]
    echoed = client.patch(
        f"/api/v1/test-cases/{case['id']}",
        json={"display_id": case["display_id"], "priority": "Low"},
    )
    assert echoed.status_code == 200 and echoed.json()["data"]["display_id"] == "TC_000001"
    assert get_case(client, case["id"])["priority"] == "Low"


def test_legacy_rows_are_not_rejected_for_empty_mandatory_fields(
    client, platform_admin, owner_engine
) -> None:
    env = setup_env(client, platform_admin)
    case = create_case(client, env)
    with owner_engine.begin() as conn:
        conn.execute(
            text("UPDATE test_cases SET module_id = NULL WHERE id = :i"), {"i": case["id"]}
        )
        conn.execute(
            text(
                "UPDATE test_case_versions SET prerequisite=NULL, test_data=NULL, "
                "expected_result=NULL WHERE test_case_id=:i"
            ),
            {"i": case["id"]},
        )
    # Reads work, and so does an edit that does not touch the empty fields.
    legacy = get_case(client, case["id"])
    assert legacy["module_id"] is None and legacy["preconditions"] is None
    r = client.patch(
        f"/api/v1/test-cases/{case['id']}", json={"priority": "Low", "severity": "Minor"}
    )
    assert r.status_code == 200, r.text
    # Re-sending the same empty values (a form posting the whole record) is fine too.
    r = client.patch(
        f"/api/v1/test-cases/{case['id']}",
        json={"preconditions": "", "test_data": None, "expected_result": "", "module_id": None},
    )
    assert r.status_code == 200, r.text
    # Setting a value is fine; clearing it afterwards is refused.
    assert (
        client.patch(
            f"/api/v1/test-cases/{case['id']}", json={"preconditions": "Now set"}
        ).status_code
        == 200
    )
    cleared = client.patch(f"/api/v1/test-cases/{case['id']}", json={"preconditions": ""})
    assert cleared.status_code == 422
    assert cleared.json()["error"]["fields"] == {"preconditions": "Preconditions cannot be cleared"}
    # A module can be set but not cleared once set.
    assert (
        client.patch(
            f"/api/v1/test-cases/{case['id']}", json={"module_id": env["module_id"]}
        ).status_code
        == 200
    )
    assert (
        client.patch(f"/api/v1/test-cases/{case['id']}", json={"module_id": None}).status_code
        == 422
    )


def test_versioning_is_preserved_for_the_new_content_fields(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    case = create_case(client, env, postconditions="Original post")
    # Draft: content edits mutate version 1 in place.
    r = client.patch(
        f"/api/v1/test-cases/{case['id']}",
        json={
            "expected_result": "Draft edit",
            "steps": [{"action": "S1", "expected": "E1", "test_data": "d"}],
        },
    )
    assert r.json()["data"]["version_number"] == 1
    approved = approve(client, case["id"])
    assert approved["status"] == "approved"
    v1_before = client.get(f"/api/v1/test-cases/{case['id']}/versions").json()["data"][0]
    # Metadata-only edits never fork (test type, severity, automation, environment, requirement).
    meta = client.patch(
        f"/api/v1/test-cases/{case['id']}",
        json={
            "test_type": "API", "severity": "Minor", "automation_status": "Automated",
            "environment": "QA", "requirement_ref": "US-7", "priority": "Low",
        },
    ).json()["data"]  # fmt: skip
    assert meta["version_number"] == 1 and meta["status"] == "approved"
    # Content edits (any of the new content fields) fork a new version and revert to draft.
    for field, value in (
        ("expected_result", "Changed expected"),
        ("postconditions", "Changed post"),
        ("test_data", "changed=1"),
        ("preconditions", "Changed pre"),
    ):
        current = get_case(client, case["id"])
        if current["status"] != "approved":
            approve(client, case["id"])
            current = get_case(client, case["id"])
        r = client.patch(f"/api/v1/test-cases/{case['id']}", json={field: value})
        out = r.json()["data"]
        assert out["version_number"] == current["version_number"] + 1, field
        assert out["status"] == "draft"
        assert out[field] == value
    versions = client.get(f"/api/v1/test-cases/{case['id']}/versions").json()["data"]
    assert [v["version_number"] for v in versions] == [1, 2, 3, 4, 5]
    # Version 1 is immutable: identical to how it looked right after approval.
    assert versions[0] == v1_before
    assert versions[0]["expected_result"] == "Draft edit"
    assert versions[0]["steps"][0]["test_data"] == "d"


# --- audit ---------------------------------------------------------------------------------


def test_audit_records_before_and_after_and_keeps_the_chain(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    case = create_case(client, env, severity="Minor")
    client.patch(
        f"/api/v1/test-cases/{case['id']}",
        json={"priority": "Low", "severity": "Major", "expected_result": "New expected"},
    )
    history = client.get(f"/api/v1/test-cases/{case['id']}/history").json()["data"]
    created = next(h for h in history if h["action"] == "testcase.created")
    assert created["event_metadata"]["changes"]["title"]["from"] is None
    assert created["event_metadata"]["changes"]["severity"] == {"from": None, "to": "Minor"}
    assert created["event_metadata"]["display_id"] == "TC_000001"
    updated = next(h for h in history if h["action"] == "testcase.updated")
    changes = updated["event_metadata"]["changes"]
    assert changes["priority"] == {"from": "High", "to": "Low"}
    assert changes["severity"] == {"from": "Minor", "to": "Major"}
    assert changes["expected_result"] == {"from": "User is signed in", "to": "New expected"}
    assert "title" not in changes
    # Long text is truncated in the audit values.
    client.patch(f"/api/v1/test-cases/{case['id']}", json={"description": "z" * 5000})
    history = client.get(f"/api/v1/test-cases/{case['id']}/history").json()["data"]
    desc = [h for h in history if h["action"] == "testcase.updated"][-1]
    assert len(desc["event_metadata"]["changes"]["description"]["to"]) <= 300
    # Requirement link / unlink show on the case's own history.
    req = client.post(
        f"/api/v1/projects/{env['project_id']}/requirements", json={"title": "Customers can log in"}
    )
    assert req.status_code == 200, req.text
    rid = req.json()["data"]["id"]
    assert (
        client.post(
            f"/api/v1/requirements/{rid}/test-cases", json={"test_case_id": case["id"]}
        ).status_code
        == 200
    )
    assert client.delete(f"/api/v1/requirements/{rid}/test-cases/{case['id']}").status_code == 200
    actions = [
        h["action"] for h in client.get(f"/api/v1/test-cases/{case['id']}/history").json()["data"]
    ]
    assert "testcase.requirement_linked" in actions and "testcase.requirement_unlinked" in actions
    # The hash chain is intact after all of it.
    verified = client.get("/api/v1/audit-logs/verify-chain").json()["data"]
    assert verified["valid"] is True


# --- soft delete ---------------------------------------------------------------------------


def test_soft_delete_hides_everywhere_but_keeps_history(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    keep = create_case(client, env, "Keeper case here")
    gone = create_case(client, env, "Doomed case here", requirement_ref="US-DEL")
    approve(client, gone["id"])
    run = run_and_verdict(client, env, gone["id"], "fail", "It crashed")
    rc = run["cases"][0]["id"]
    sid = step_ids(client, rc)[0]
    defect = client.post(
        "/api/v1/defects",
        json={"execution_step_id": sid, "severity": "High", "title": "Crash on doomed"},
    )
    assert defect.status_code == 200, defect.text
    req = client.post(
        f"/api/v1/projects/{env['project_id']}/requirements", json={"title": "Req one"}
    )
    rid = req.json()["data"]["id"]
    client.post(f"/api/v1/requirements/{rid}/test-cases", json={"test_case_id": gone["id"]})
    coverage_before = client.get(
        f"/api/v1/projects/{env['project_id']}/requirements/coverage"
    ).json()["data"]
    assert coverage_before["covered_requirements"] == 1

    # Runs and defects no longer block deletion (the old 409 guard is gone).
    deleted = client.delete(f"/api/v1/test-cases/{gone['id']}")
    assert deleted.status_code == 200, deleted.text

    listed = client.get(f"/api/v1/projects/{env['project_id']}/test-cases").json()["data"]
    assert [c["id"] for c in listed["items"]] == [keep["id"]] and listed["total"] == 1
    wide = client.get("/api/v1/test-cases").json()["data"]
    assert wide["total"] == 1
    for term in ("Doomed", "TC_000002", "US-DEL"):
        found = client.get(
            f"/api/v1/projects/{env['project_id']}/test-cases", params={"search": term}
        )
        assert found.json()["data"]["total"] == 0, term
    assert client.get(f"/api/v1/test-cases/{gone['id']}").status_code == 404
    assert (
        client.patch(f"/api/v1/test-cases/{gone['id']}", json={"priority": "Low"}).status_code
        == 404
    )
    assert client.delete(f"/api/v1/test-cases/{gone['id']}").status_code == 404
    global_search = client.get("/api/v1/search", params={"q": "Doomed"}).json()["data"]
    assert not [r for r in global_search["results"] if r["type"] == "test_case"]
    # Exports.
    export = client.get(f"/api/v1/projects/{env['project_id']}/test-cases/export.csv")
    assert "Keeper case here" in export.text and "Doomed case here" not in export.text
    # Requirement coverage no longer counts the deleted case.
    coverage = client.get(f"/api/v1/projects/{env['project_id']}/requirements/coverage").json()[
        "data"
    ]
    assert coverage["covered_requirements"] == 0
    # A new run cannot include it; the existing run still renders (title kept).
    bad_run = client.post(
        f"/api/v1/projects/{env['project_id']}/test-runs",
        json={"name": "Again", "run_type": "Smoke", "test_case_ids": [gone["id"]]},
    )
    assert bad_run.status_code in (404, 409, 422)
    still = client.get(f"/api/v1/test-runs/{run['id']}").json()["data"]
    assert still["cases"][0]["title"] == "Doomed case here"
    # The defect still names its test case.
    got = client.get(f"/api/v1/defects/{defect.json()['data']['id']}").json()["data"]
    assert got["test_case_title"] == "Doomed case here"
    # History and executions stay readable by id for an admin.
    history = client.get(f"/api/v1/test-cases/{gone['id']}/history")
    assert history.status_code == 200
    assert "testcase.deleted" in [h["action"] for h in history.json()["data"]]
    deleted_audit = [h for h in history.json()["data"] if h["action"] == "testcase.deleted"][0]
    assert deleted_audit["event_metadata"]["soft"] is True
    executions = client.get(f"/api/v1/test-cases/{gone['id']}/executions")
    assert executions.status_code == 200 and executions.json()["data"]["total"] == 1
    # The display id is never reused and the project cannot be deleted with cases in it.
    nxt = create_case(client, env, "After the delete")
    assert nxt["display_id"] == "TC_000003"
    # The row is still there (soft).
    # (checked through the tenant data export which includes deleted rows)


def test_soft_deleted_case_history_not_readable_by_testers(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    tester_email = f"tester@{env['slug']}.example.com"
    add_user(client, env, "tester")
    case = create_case(client, env)
    assert client.delete(f"/api/v1/test-cases/{case['id']}").status_code == 200
    login_as(client, env, tester_email)
    assert client.get(f"/api/v1/test-cases/{case['id']}/history").status_code == 404
    assert client.get(f"/api/v1/test-cases/{case['id']}/executions").status_code == 404


def test_tester_can_delete_only_own_draft(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    tester_email = f"tester@{env['slug']}.example.com"
    add_user(client, env, "tester")
    admins_draft = create_case(client, env, "Admins own draft")
    login_as(client, env, tester_email)
    mine = create_case(client, env, "Testers own draft")
    approved_mine = create_case(client, env, "Testers approved one")
    assert client.delete(f"/api/v1/test-cases/{admins_draft['id']}").status_code == 403
    assert client.delete(f"/api/v1/test-cases/{mine['id']}").status_code == 200
    login_as(client, env, env["admin_email"], ADMIN_PW)
    approve(client, approved_mine["id"])
    login_as(client, env, tester_email)
    denied = client.delete(f"/api/v1/test-cases/{approved_mine['id']}")
    assert denied.status_code == 403
    assert "own draft" in denied.json()["error"]["message"]


def test_manager_and_admin_can_delete_any_case(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    add_user(client, env, "manager", project_member=False)
    one = create_case(client, env, "Delete by manager")
    two = create_case(client, env, "Delete by admin")
    login_as(client, env, f"manager@{env['slug']}.example.com")
    approve(client, one["id"])
    assert client.delete(f"/api/v1/test-cases/{one['id']}").status_code == 200
    login_as(client, env, env["admin_email"], ADMIN_PW)
    assert client.delete(f"/api/v1/test-cases/{two['id']}").status_code == 200


def _custom_role_user(client, env, name, perms, member=True) -> str:
    role = client.post("/api/v1/roles", json={"name": name, "permission_codes": perms})
    assert role.status_code == 200, role.text
    email = f"{name.lower().replace(' ', '')}@{env['slug']}.example.com"
    user = client.post(
        "/api/v1/users",
        json={
            "email": email,
            "name": name,
            "role_id": role.json()["data"]["id"],
            "password": USER_PW,
        },
    )
    assert user.status_code == 200, user.text
    if member:
        client.post(
            f"/api/v1/projects/{env['project_id']}/members",
            json={"user_id": user.json()["data"]["id"]},
        )
    return email


def test_custom_role_matrix_for_delete_execute_export(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    deleter = _custom_role_user(
        client, env, "Deleter", ["testcase.create", "testcase.edit", "testcase.delete"]
    )
    author = _custom_role_user(client, env, "Author Only", ["testcase.create", "testcase.edit"])
    executor = _custom_role_user(client, env, "Executor", ["testcase.execute"])
    exporter = _custom_role_user(client, env, "Exporter", ["testcase.export"])
    target = create_case(client, env, "Target of delete")
    other = create_case(client, env, "Other of delete")
    approve(client, target["id"])
    run = make_run(client, env, [target["id"]])
    rc = run["cases"][0]
    me = client.get("/api/v1/users").json()["data"]
    executor_id = next(u["id"] for u in me if u["email"] == executor)
    assert (
        client.patch(
            f"/api/v1/test-run-cases/{rc['id']}/assign", json={"assigned_to": executor_id}
        ).status_code
        == 200
    )
    sid = step_ids(client, rc["id"])[0]

    login_as(client, env, executor)  # testcase.execute alone is enough to record
    assert verdict(client, sid, "pass").status_code == 200
    assert client.post(f"/api/v1/execution-steps/{sid}/open").status_code in (200, 409)
    login_as(client, env, author)
    assert verdict(client, sid, "pass").status_code == 403
    assert client.post(f"/api/v1/execution-steps/{sid}/open").status_code == 403

    export_url = f"/api/v1/projects/{env['project_id']}/test-cases/export.csv"
    login_as(client, env, exporter)  # testcase.export alone is enough to export
    assert client.get(export_url).status_code == 200
    login_as(client, env, author)
    assert client.get(export_url).status_code == 403
    login_as(client, env, author)
    assert client.get(export_url).status_code == 403

    login_as(client, env, author)
    denied = client.delete(f"/api/v1/test-cases/{target['id']}")
    assert denied.status_code == 403
    login_as(client, env, deleter)
    assert client.delete(f"/api/v1/test-cases/{target['id']}").status_code == 200
    assert client.delete(f"/api/v1/test-cases/{other['id']}").status_code == 200


def test_builtin_roles_keep_their_export_and_execute_access(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    add_user(client, env, "tester")
    add_user(client, env, "manager", project_member=False)
    case = create_case(client, env)
    approve(client, case["id"])
    export_url = f"/api/v1/projects/{env['project_id']}/test-cases/export.csv"
    for who in ("tester", "manager"):
        login_as(client, env, f"{who}@{env['slug']}.example.com")
        assert client.get(export_url).status_code == 200, who
    login_as(client, env, env["admin_email"], ADMIN_PW)
    assert client.get(export_url).status_code == 200
    # New permission codes were granted to exactly the holders of the old ones.
    perms = client.get("/api/v1/roles/permissions").json()["data"]
    assert {"testcase.execute", "testcase.export"} <= {p["code"] for p in perms}


# --- derived execution status, executions history ----------------------------------------------


def test_execution_status_mapping() -> None:
    assert test_case_service.execution_status_label("passed") == "Pass"
    assert test_case_service.execution_status_label("failed") == "Fail"
    assert test_case_service.execution_status_label("blocked") == "Blocked"
    assert test_case_service.execution_status_label("ignored") == "Skipped"
    for status in ("pending", "in_progress", None, "weird"):
        assert test_case_service.execution_status_label(status) == "Not Run"


def test_execution_status_is_derived_from_the_latest_executed_run_case(
    client, platform_admin
) -> None:
    env = setup_env(client, platform_admin)
    never = create_case(client, env, "Never executed")
    passing = create_case(client, env, "Passes in run")
    failing = create_case(client, env, "Fails in run")
    blocked = create_case(client, env, "Blocked in run")
    for c in (passing, failing, blocked):
        approve(client, c["id"])
    run_and_verdict(client, env, passing["id"], "pass", name="Run P")
    run_and_verdict(client, env, failing["id"], "fail", "Boom", name="Run F")
    brun = make_run(client, env, [blocked["id"]], "Run B")
    brc = brun["cases"][0]["id"]
    assert (
        client.post(
            f"/api/v1/test-run-cases/{brc}/block",
            json={"reason": "Env is down", "actual_result": "Server 503"},
        ).status_code
        == 200
    )

    got = {
        c["id"]: c
        for c in client.get(f"/api/v1/projects/{env['project_id']}/test-cases").json()["data"][
            "items"
        ]
    }
    assert got[never["id"]]["execution_status"] == "Not Run"
    assert got[passing["id"]]["execution_status"] == "Pass"
    assert got[failing["id"]]["execution_status"] == "Fail"
    assert got[blocked["id"]]["execution_status"] == "Blocked"
    assert got[passing["id"]]["last_executed_by"] == "Admin A"
    assert got[passing["id"]]["last_executed_at"] is not None
    assert got[never["id"]]["last_executed_by"] is None
    assert got[failing["id"]]["last_actual_result"] == "Boom"
    # A newer pending run does not hide the last real result; a newer executed one replaces it.
    make_run(client, env, [failing["id"]], "Run F2")
    assert get_case(client, failing["id"])["execution_status"] == "Fail"
    run_and_verdict(client, env, failing["id"], "pass", name="Run F3")
    assert get_case(client, failing["id"])["execution_status"] == "Pass"


def test_executions_history_endpoint(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    case = create_case(client, env)
    approve(client, case["id"])
    first = run_and_verdict(
        client, env, case["id"], "fail", "Spinner never stops", name="First run"
    )
    rc1 = first["cases"][0]["id"]
    sid = step_ids(client, rc1)[0]
    defect = client.post(
        "/api/v1/defects",
        json={"execution_step_id": sid, "severity": "High", "title": "Spinner stuck"},
    ).json()["data"]
    second = run_and_verdict(client, env, case["id"], "pass", "Works now", name="Second run")
    history = client.get(f"/api/v1/test-cases/{case['id']}/executions").json()["data"]
    assert history["total"] == 2
    newest, oldest = history["items"]
    assert newest["run_name"] == "Second run" and newest["execution_status"] == "Pass"
    assert newest["actual_result"] == "Works now"
    assert newest["executed_by_name"] == "Admin A" and newest["executed_at"] is not None
    assert newest["version_number"] == 1 and newest["defects"] == []
    assert oldest["run_name"] == "First run" and oldest["execution_status"] == "Fail"
    assert oldest["actual_result"] == "Spinner never stops"
    assert [d["id"] for d in oldest["defects"]] == [defect["id"]]
    assert oldest["defects"][0]["display_id"] == defect["display_id"]
    assert newest["test_run_id"] == second["id"]
    # Paging.
    page = client.get(
        f"/api/v1/test-cases/{case['id']}/executions", params={"page": 2, "page_size": 1}
    )
    assert page.json()["data"]["total"] == 2 and len(page.json()["data"]["items"]) == 1
    assert (
        client.get(
            f"/api/v1/test-cases/{case['id']}/executions", params={"page_size": 101}
        ).status_code
        == 422
    )


def test_actual_result_executor_and_history_on_the_execution_record(
    client, platform_admin, monkeypatch
) -> None:
    env = setup_env(client, platform_admin)
    case = create_case(client, env)
    approve(client, case["id"])
    version_before = client.get(f"/api/v1/test-cases/{case['id']}/versions").json()["data"]
    run = make_run(client, env, [case["id"]])
    rc = run["cases"][0]["id"]
    sid = step_ids(client, rc)[0]
    # Required for fail by default (ADR-117); pass and ignore never need it.
    settings = get_settings()
    assert settings.require_actual_result_on_fail is True
    refused = verdict(client, sid, "fail")
    assert refused.status_code == 422 and "actual_result" in refused.json()["error"]["fields"]
    assert verdict(client, sid, "fail", "   ").status_code == 422
    ok = verdict(client, sid, "fail", "Got a 500")
    assert ok.status_code == 200 and ok.json()["data"]["actual_result"] == "Got a 500"
    # Executor and date are stamped on the run case when it finishes.
    run_after = client.get(f"/api/v1/test-runs/{run['id']}").json()["data"]["cases"][0]
    assert run_after["status"] == "failed" and run_after["actual_result"] == "Got a 500"
    assert run_after["executed_by"] is not None and run_after["executed_at"] is not None
    # Re-recording while the run is open keeps the previous result in the audit trail.
    again = verdict(client, sid, "pass", "Fixed after retry")
    assert again.status_code == 200
    audits = [
        a
        for a in client.get(
            "/api/v1/audit-logs", params={"action": "executionstep.verdict_recorded"}
        ).json()["data"]
        if a["entity_id"] == sid
    ]
    changes = [a["metadata"]["changes"] for a in audits]
    assert any(c.get("verdict") == {"from": None, "to": "fail"} for c in changes)
    assert any(
        c.get("verdict") == {"from": "fail", "to": "pass"}
        and c.get("actual_result") == {"from": "Got a 500", "to": "Fixed after retry"}
        for c in changes
    )
    # The test case definition was never touched by executing it.
    assert client.get(f"/api/v1/test-cases/{case['id']}/versions").json()["data"] == version_before
    # With the setting switched off, a fail without an actual result is accepted again.
    monkeypatch.setattr(settings, "require_actual_result_on_fail", False)
    run_b = make_run(client, env, [case["id"]], "Run B")
    sid_b = step_ids(client, run_b["cases"][0]["id"])[0]
    assert verdict(client, sid_b, "fail").status_code == 200


# --- filters, search, sorts, columns -------------------------------------------------------------


def _seed_listing(client, env) -> dict:
    a = create_case(
        client,
        env,
        "Alpha login case",
        test_type="UI",
        severity="Major",
        automation_status="Automated",
        environment="Staging",
        requirement_ref="US-100",
    )
    b = create_case(
        client,
        env,
        "Beta search case",
        test_type="API",
        severity="Minor",
        environment="Production",
        requirement_ref="US-200",
    )
    c = create_case(
        client,
        env,
        "Gamma report case",
        test_type="UI",
        severity="Critical",
        automation_status="Candidate for Automation",
    )
    return {"a": a, "b": b, "c": c}


def test_filters_on_both_listings(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    cs = _seed_listing(client, env)
    project_url = f"/api/v1/projects/{env['project_id']}/test-cases"

    def ids(url, **params) -> set[str]:
        r = client.get(url, params=params)
        assert r.status_code == 200, r.text
        return {c["id"] for c in r.json()["data"]["items"]}

    for url in (project_url, "/api/v1/test-cases"):
        assert ids(url, test_type="UI") == {cs["a"]["id"], cs["c"]["id"]}
        assert ids(url, severity="Minor") == {cs["b"]["id"]}
        assert ids(url, automation_status="Automated") == {cs["a"]["id"]}
        assert ids(url, automation_status="Manual") == {cs["b"]["id"]}
        assert ids(url, environment="staging") == {cs["a"]["id"]}
        assert ids(url, test_type="UI", severity="Critical") == {cs["c"]["id"]}
        assert client.get(url, params={"automation_status": "Bogus"}).status_code == 422
        assert client.get(url, params={"execution_status": "Bogus"}).status_code == 422
    # Execution status / executed by.
    for c in cs.values():
        approve(client, c["id"])
    run_and_verdict(client, env, cs["a"]["id"], "pass", name="Run 1")
    run_and_verdict(client, env, cs["b"]["id"], "fail", "bad", name="Run 2")
    for url in (project_url, "/api/v1/test-cases"):
        assert ids(url, execution_status="Pass") == {cs["a"]["id"]}
        assert ids(url, execution_status="Fail") == {cs["b"]["id"]}
        assert ids(url, execution_status="Not Run") == {cs["c"]["id"]}
        assert ids(url, execution_status="Blocked") == set()
    me = client.get("/api/v1/auth/me").json()["data"]["user_id"]
    assert ids(project_url, executed_by=me) == {cs["a"]["id"], cs["b"]["id"]}
    other = add_user(client, env, "tester")
    assert ids(project_url, executed_by=other) == set()
    # Totals follow the filters.
    r = client.get(project_url, params={"test_type": "UI"}).json()["data"]
    assert r["total"] == 2


def test_search_covers_id_title_requirement_and_module(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    cs = _seed_listing(client, env)
    other_module = client.post(
        f"/api/v1/projects/{env['project_id']}/modules", json={"name": "Payments Hub"}
    ).json()["data"]
    pay = create_case(client, env, "Plain payment check", module_id=other_module["id"])
    url = f"/api/v1/projects/{env['project_id']}/test-cases"

    def found(term) -> set[str]:
        return {c["id"] for c in client.get(url, params={"search": term}).json()["data"]["items"]}

    assert found("TC_000002") == {cs["b"]["id"]}
    assert found("tc_00000") == {cs["a"]["id"], cs["b"]["id"], cs["c"]["id"], pay["id"]}
    assert found("US-200") == {cs["b"]["id"]}
    assert found("alpha") == {cs["a"]["id"]}
    assert found("payments hub") == {pay["id"]}
    assert found("claims") == {cs["a"]["id"], cs["b"]["id"], cs["c"]["id"]}
    # LIKE wildcards in the search term are literal.
    assert found("TC%0001") == set() and found("TC_00000_") == set()
    assert found("TC_00000") != set()
    wide = client.get("/api/v1/test-cases", params={"search": "US-100"}).json()["data"]
    assert [c["id"] for c in wide["items"]] == [cs["a"]["id"]]


def test_sorting_and_cursor_paging(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    made = [
        create_case(client, env, f"Sortable case {i:02d}", test_type=("UI" if i % 2 else "API"))
        for i in range(12)
    ]
    url = f"/api/v1/projects/{env['project_id']}/test-cases"

    def order(**params) -> list[str]:
        r = client.get(url, params={"page_size": 100, **params})
        assert r.status_code == 200, r.text
        return [c["display_id"] for c in r.json()["data"]["items"]]

    asc = order(sort="display_id")
    assert asc == [f"TC_{n:06d}" for n in range(1, 13)]  # numeric, not text order
    assert order(sort="-display_id") == list(reversed(asc))
    types = [
        c["test_type"]
        for c in client.get(url, params={"sort": "test_type", "page_size": 100}).json()["data"][
            "items"
        ]
    ]
    assert types == sorted(types)
    for key in (
        "priority",
        "severity",
        "automation_status",
        "title",
        "status",
        "last_executed_at",
        "execution_status",
    ):
        assert client.get(url, params={"sort": key}).status_code == 200, key
        assert client.get(url, params={"sort": f"-{key}"}).status_code == 200, key
    # Last executed sorts by the latest execution; never-executed cases last.
    approve(client, made[3]["id"])
    approve(client, made[7]["id"])
    run_and_verdict(client, env, made[3]["id"], "pass", name="Earlier")
    run_and_verdict(client, env, made[7]["id"], "pass", name="Later")
    desc = order(sort="-last_executed_at")
    assert desc[:2] == [made[7]["display_id"], made[3]["display_id"]]
    assert order(sort="last_executed_at")[:2] == [made[3]["display_id"], made[7]["display_id"]]
    # Keyset paging still works (created_at order) with the new filters, and refuses other sorts.
    seen: list[str] = []
    cursor = ""
    while True:
        r = client.get(url, params={"page_size": 5, "cursor": cursor, "test_type": "UI"})
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        seen += [c["display_id"] for c in data["items"]]
        cursor = data.get("next_cursor")
        if not cursor:
            break
    assert len(seen) == 6 and len(set(seen)) == 6
    # Cursor mode with a non-created_at sort stays a 422.
    first = client.get(url, params={"page_size": 2}).json()["data"]
    assert (
        client.get(url, params={"page_size": 2, "cursor": "x", "sort": "display_id"}).status_code
        == 422
    )
    assert first["total"] == 12


def test_column_catalogue(client, platform_admin) -> None:
    setup_env(client, platform_admin)
    r = client.get("/api/v1/test-cases/columns")
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert len(data["fields"]) == 22
    assert data["default_columns"] == [
        "display_id", "title", "module", "test_type", "priority",
        "automation_status", "execution_status", "executed_by", "last_executed_at",
    ]  # fmt: skip
    by_key = {f["key"]: f for f in data["fields"]}
    assert by_key["display_id"]["label"] == "Test Case ID"
    assert by_key["execution_status"]["label"] == "Execution Status"
    assert by_key["last_executed_at"]["label"] == "Last Execution Date"
    assert [k for k, f in by_key.items() if f["default_visible"]] != []
    assert {k for k, f in by_key.items() if f["default_visible"]} == set(data["default_columns"])
    assert {k for k, f in by_key.items() if f["mandatory_on_create"]} == {
        "module",
        "title",
        "priority",
        "preconditions",
        "test_data",
        "steps",
        "expected_result",
    }
    assert set(data["automation_statuses"]) == {"Manual", "Automated", "Candidate for Automation"}
    assert data["execution_statuses"] == ["Pass", "Fail", "Blocked", "Skipped", "Not Run"]


# --- duplicate -----------------------------------------------------------------------------------


def test_duplicate_copies_the_definition_only(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    source = create_case(
        client, env, "Original to copy", test_type="API", severity="Minor", environment="QA",
        requirement_ref="US-9", postconditions="Cleaned up",
        steps=[
            {"action": "A1", "expected": "E1", "test_data": "d1"},
            {"action": "A2", "expected": "E2"},
        ],
    )  # fmt: skip
    approve(client, source["id"])
    run = run_and_verdict(client, env, source["id"], "fail", "Broke", name="Dup run")
    sid = step_ids(client, run["cases"][0]["id"])[0]
    client.post(
        "/api/v1/defects",
        json={"execution_step_id": sid, "severity": "High", "title": "Dup defect"},
    )
    copy = client.post(f"/api/v1/test-cases/{source['id']}/duplicate")
    assert copy.status_code == 200, copy.text
    dup = copy.json()["data"]
    assert dup["id"] != source["id"] and dup["display_id"] == "TC_000002"
    assert dup["title"] == "Original to copy (Copy)" and dup["status"] == "draft"
    assert dup["version_number"] == 1
    same_keys = (
        "test_type", "severity", "environment", "requirement_ref", "postconditions",
        "preconditions", "test_data", "expected_result", "module_id", "priority",
        "automation_status",
    )  # fmt: skip
    for key in same_keys:
        assert dup[key] == source[key], key
    assert [(s["action"], s["expected"], s["test_data"]) for s in dup["steps"]] == [
        ("A1", "E1", "d1"),
        ("A2", "E2", None),
    ]
    assert dup["execution_status"] == "Not Run" and dup["linked_defects"] == []
    assert client.get(f"/api/v1/test-cases/{dup['id']}/executions").json()["data"]["total"] == 0
    history = client.get(f"/api/v1/test-cases/{dup['id']}/history").json()["data"]
    entry = next(h for h in history if h["action"] == "testcase.duplicated")
    assert entry["event_metadata"]["source_display_id"] == "TC_000001"
    # Long titles are trimmed to fit the suffix.
    long = create_case(client, env, "L" * 255)
    assert (
        client.post(f"/api/v1/test-cases/{long['id']}/duplicate")
        .json()["data"]["title"]
        .endswith(" (Copy)")
    )
    assert (
        client.post("/api/v1/test-cases/00000000-0000-0000-0000-000000000000/duplicate").status_code
        == 404
    )
    # Permission: needs testcase.create (a viewer role cannot; a tester can).
    viewer = _custom_role_user(client, env, "Viewer Role", ["report.view"])
    add_user(client, env, "tester")
    login_as(client, env, viewer)
    assert client.post(f"/api/v1/test-cases/{source['id']}/duplicate").status_code == 403
    login_as(client, env, f"tester@{env['slug']}.example.com")
    assert client.post(f"/api/v1/test-cases/{source['id']}/duplicate").status_code == 200


# --- export ---------------------------------------------------------------------------------------


def test_export_has_all_fields_and_a_columns_parameter(client, platform_admin) -> None:
    import csv

    env = setup_env(client, platform_admin)
    case = create_case(
        client, env, "Exported case", test_type="UI", severity="Major", environment="QA",
        requirement_ref="US-5", postconditions="Post",
    )  # fmt: skip
    approve(client, case["id"])
    run_and_verdict(client, env, case["id"], "fail", "Observed wrong total", name="Exp run")
    base = f"/api/v1/projects/{env['project_id']}/test-cases/export.csv"
    rows = list(csv.reader(io.StringIO(client.get(base).text)))
    header, row = rows[0], dict(zip(rows[0], rows[1], strict=True))
    assert header == [h for _, h in csv_import_service.EXPORT_COLUMNS]
    assert len(header) >= 22
    assert row["Test Case ID"] == "TC_000001" and row["Test Type"] == "UI"
    assert row["Severity"] == "Major" and row["Environment"] == "QA"
    assert row["Requirement / User Story ID"] == "US-5" and row["Postconditions"] == "Post"
    assert row["Expected Result"] == "User is signed in" and row["Preconditions"] == "User exists"
    assert row["Execution Status"] == "Fail" and row["Actual Result"] == "Observed wrong total"
    assert row["Executed By"] == "Admin A" and row["Last Execution Date"]
    assert row["Created By"] == "Admin A" and row["Automation Status"] == "Manual"
    # Selected columns, in the requested order.
    picked = list(
        csv.reader(
            io.StringIO(
                client.get(base, params={"columns": "title,display_id,execution_status"}).text
            )
        )
    )
    assert picked[0] == ["Title", "Test Case ID", "Execution Status"]
    assert picked[1] == ["Exported case", "TC_000001", "Fail"]
    assert client.get(base, params={"columns": "title,nope"}).status_code == 422
    assert client.get(base, params={"columns": "title,title"}).status_code == 422
    xlsx = client.get(base.replace(".csv", ".xlsx"), params={"columns": "display_id,title"})
    assert xlsx.status_code == 200 and xlsx.content[:2] == b"PK"


def test_export_applies_the_list_filters_and_sort(client, platform_admin) -> None:
    """ADR-117: the export endpoints take the list page's filters, so exporting the
    current view gives exactly the rows the list shows, in the list's order."""
    import csv

    env = setup_env(client, platform_admin, "Filt Export")
    create_case(client, env, "Alpha export case", test_type="UI", priority="High")
    create_case(client, env, "Bravo export case", test_type="API", priority="Low")
    create_case(client, env, "Charlie export case", test_type="UI", priority="Low")
    base = f"/api/v1/projects/{env['project_id']}/test-cases/export.csv"

    def titles(**params) -> list[str]:
        rows = list(csv.reader(io.StringIO(client.get(base, params=params).text)))
        return [r[rows[0].index("Title")] for r in rows[1:]]

    assert len(titles()) == 3
    assert titles(test_type="UI", sort="-title") == ["Charlie export case", "Alpha export case"]
    assert titles(priority="Low", search="bravo") == ["Bravo export case"]
    assert titles(execution_status="Pass") == []
    assert len(titles(execution_status="Not Run")) == 3
    xlsx = client.get(base.replace(".csv", ".xlsx"), params={"test_type": "API"})
    assert xlsx.status_code == 200 and xlsx.content[:2] == b"PK"


def test_export_respects_tester_visibility(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    tester_id = add_user(client, env, "tester")
    mine = create_case(client, env, "Assigned to tester", assignee_id=tester_id)
    create_case(client, env, "Hidden from tester")
    assert (
        client.patch("/api/v1/settings", json={"testers_see_assigned_cases_only": True}).status_code
        == 200
    )
    login_as(client, env, f"tester@{env['slug']}.example.com")
    text_ = client.get(f"/api/v1/projects/{env['project_id']}/test-cases/export.csv").text
    assert "Assigned to tester" in text_ and "Hidden from tester" not in text_
    # The new filters and sorts stay inside that scope.
    listed = client.get(
        f"/api/v1/projects/{env['project_id']}/test-cases",
        params={"execution_status": "Not Run", "sort": "-last_executed_at"},
    ).json()["data"]
    assert [c["id"] for c in listed["items"]] == [mine["id"]] and listed["total"] == 1


def test_tester_visibility_blocks_new_endpoints_for_unassigned_cases(
    client, platform_admin
) -> None:
    env = setup_env(client, platform_admin)
    add_user(client, env, "tester")
    hidden = create_case(client, env, "Not for the tester")
    assert (
        client.patch("/api/v1/settings", json={"testers_see_assigned_cases_only": True}).status_code
        == 200
    )
    login_as(client, env, f"tester@{env['slug']}.example.com")
    assert client.get(f"/api/v1/test-cases/{hidden['id']}/executions").status_code == 404
    assert client.post(f"/api/v1/test-cases/{hidden['id']}/duplicate").status_code == 404
    assert client.delete(f"/api/v1/test-cases/{hidden['id']}").status_code == 404


def test_rls_isolation_of_the_new_endpoints(client, platform_admin) -> None:
    env_a = setup_env(client, platform_admin, "Alpha Corp")
    case = create_case(client, env_a, "Tenant A secret")
    approve(client, case["id"])
    run_and_verdict(client, env_a, case["id"], "pass")
    other = TestClient(client.app)
    boot = _bootstrap_tenant(other, platform_admin, "Beta Corp")
    _login_and_verify(other, boot["tenant"]["id"], "admin@betacorp.example.com", ADMIN_PW)
    assert other.get(f"/api/v1/test-cases/{case['id']}").status_code == 404
    assert other.get(f"/api/v1/test-cases/{case['id']}/executions").status_code == 404
    assert other.get(f"/api/v1/test-cases/{case['id']}/history").status_code == 404
    assert other.post(f"/api/v1/test-cases/{case['id']}/duplicate").status_code == 404
    assert other.delete(f"/api/v1/test-cases/{case['id']}").status_code == 404
    assert other.get("/api/v1/test-cases").json()["data"]["total"] == 0
    assert (
        other.get(
            "/api/v1/test-cases", params={"search": "secret", "execution_status": "Pass"}
        ).json()["data"]["total"]
        == 0
    )
    # Display ids restart per tenant.
    project_b = _create_project(other, "Beta Project")
    module_b = other.post(
        f"/api/v1/projects/{project_b['id']}/modules", json={"name": "Core"}
    ).json()["data"]
    mine_b = create_case(
        other, {"project_id": project_b["id"], "module_id": module_b["id"]}, "Tenant B case"
    )
    assert mine_b["display_id"] == "TC_000001"
    assert (
        client.get(f"/api/v1/test-cases/{case['id']}").json()["data"]["display_id"] == "TC_000001"
    )


# --- import of the new fields ---------------------------------------------------------------------


LEGACY_HEADER = (
    "Title,Module,Sub Module,Project Name,Priority,Status,Description,"
    "Scenario Id,Scenario Description,Prerequisite,Test Data,Assignee Email,Steps"
)
EXT_HEADER = (
    LEGACY_HEADER
    + ",Requirement ID,Test Type,Severity,Automation Status,Environment"
    + ",Expected Result,Postconditions"
)


def _upload(client: TestClient, csv_text: str):
    files = {"file": ("import.csv", io.BytesIO(csv_text.encode()), "text/csv")}
    return client.post("/api/v1/test-cases/import", files=files)


def _ext_row(title, project, **kw) -> str:
    vals = {
        "prereq": "Logged in", "data": "id=1", "steps": "Open|Opens|url=/;Click|Clicked",
        "req": "US-1", "ttype": "UI", "sev": "Major", "auto": "automated", "env": "QA",
        "exp": "All good", "post": "Closed", "desc": "A description <i>here</i>",
    }  # fmt: skip
    vals.update(kw)
    return (
        f'"{title}","Claims","","{project}","High","Draft","{vals["desc"]}","","",'
        f'"{vals["prereq"]}","{vals["data"]}","","{vals["steps"]}","{vals["req"]}","{vals["ttype"]}",'
        f'"{vals["sev"]}","{vals["auto"]}","{vals["env"]}","{vals["exp"]}","{vals["post"]}"\n'
    )


def test_import_maps_the_new_columns_and_enforces_mandatory_fields(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    project_name = "Std Corp Claims"
    csv_text = (
        EXT_HEADER
        + "\n"
        + _ext_row("Imported full case", project_name)
        + _ext_row("Imported without data", project_name, data="")
        + _ext_row("Imported bad type", project_name, ttype="Nonsense")
        + _ext_row("Imported bad auto", project_name, auto="Sometimes")
        + _ext_row("Imported no expected", project_name, exp="")
        + _ext_row("Imported bad severity", project_name, sev="Whatever")
    )
    report = _upload(client, csv_text).json()["data"]
    assert report["created_count"] == 1 and report["error_count"] == 5
    errors = " ".join(" ".join(r["errors"]) for r in report["rows"])
    assert "Test Data is required" in errors and "Expected Result is required" in errors
    assert "Test Type 'Nonsense'" in errors and "Automation Status 'Sometimes'" in errors
    assert "Severity 'Whatever'" in errors
    created = client.get(f"/api/v1/projects/{env['project_id']}/test-cases").json()["data"][
        "items"
    ][0]
    assert created["display_id"] == "TC_000001" and created["test_type"] == "UI"
    assert created["severity"] == "Major" and created["automation_status"] == "Automated"
    assert created["environment"] == "QA" and created["requirement_ref"] == "US-1"
    assert created["expected_result"] == "All good" and created["postconditions"] == "Closed"
    assert created["description"] == "A description here"
    assert [(s["action"], s["test_data"]) for s in created["steps"]] == [
        ("Open", "url=/"),
        ("Click", None),
    ]
    assert created["module_path"] == "Claims"
    # The legacy 13-column file keeps working with its old rules.
    legacy = (
        LEGACY_HEADER + "\n"
        '"Legacy imported case","Claims","","Std Corp Claims","High","Draft",'
        '"Some description","","","","","","Do it|Done"\n'
    )
    assert _upload(client, legacy).json()["data"]["created_count"] == 1
    # Unknown extra headers are still refused.
    assert _upload(client, LEGACY_HEADER + ",Bogus\n").status_code == 422


def test_imported_soft_deleted_titles_do_not_count_as_duplicates(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    first = create_case(client, env, "Reusable import title")
    assert client.delete(f"/api/v1/test-cases/{first['id']}").status_code == 200
    csv_text = EXT_HEADER + "\n" + _ext_row("Reusable import title", "Std Corp Claims")
    assert _upload(client, csv_text).json()["data"]["created_count"] == 1


def test_step_json_roundtrip_in_export_and_import(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    create_case(
        client,
        env,
        "Round trip steps",
        steps=[
            {"action": "A", "expected": "B", "test_data": json.dumps({"k": 1}).replace("|", "")}
        ],
    )
    exported = client.get(
        f"/api/v1/projects/{env['project_id']}/test-cases/export.csv", params={"columns": "steps"}
    ).text
    import csv

    cell = list(csv.reader(io.StringIO(exported)))[1][0]
    assert cell == '1. A | {"k": 1} | B'


def test_tenant_export_still_includes_soft_deleted_cases(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    case = create_case(client, env, "Exported even when deleted")
    assert client.delete(f"/api/v1/test-cases/{case['id']}").status_code == 200
    # The ORM hook hides the row; an include_deleted read (what the tenant export uses)
    # still finds it, with its display id and who deleted it.
    from sqlalchemy import select

    from app.core.db import SessionLocal, set_tenant_context
    from app.models.test_case import TestCase

    with SessionLocal() as db:
        set_tenant_context(db, env["tenant_id"])
        assert db.execute(select(TestCase).where(TestCase.id == case["id"])).first() is None
        row = db.execute(
            select(TestCase)
            .where(TestCase.id == case["id"])
            .execution_options(include_deleted=True)
        ).scalar_one()
        assert row.deleted_at is not None and row.deleted_by is not None
        assert row.display_id == "TC_000001"


def test_project_with_only_soft_deleted_cases_cannot_be_deleted(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    case = create_case(client, env, "Blocks project deletion")
    assert client.delete(f"/api/v1/test-cases/{case['id']}").status_code == 200
    assert client.delete(f"/api/v1/projects/{env['project_id']}").status_code == 409


def test_bulk_update_still_works_and_audits(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    one = create_case(client, env, "Bulk one here")
    two = create_case(client, env, "Bulk two here")
    r = client.post(
        "/api/v1/test-cases/bulk-update",
        json={"test_case_ids": [one["id"], two["id"]], "priority": "Low"},
    )
    assert r.status_code == 200 and r.json()["data"]["updated"] == 2
    history = client.get(f"/api/v1/test-cases/{one['id']}/history").json()["data"]
    upd = [h for h in history if h["action"] == "testcase.updated"][-1]
    assert upd["event_metadata"]["changes"]["priority"] == {"from": "High", "to": "Low"}
