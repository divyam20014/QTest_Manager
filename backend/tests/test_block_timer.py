"""ADR-075: the step timer does not run while a case is blocked.

Blocking stamps `completed_at`; unblocking moves the open step's `opened_at`
forward by the time spent blocked, so the live clock and the recorded duration
(closed_at - opened_at) both exclude it. Time is simulated by backdating rows,
since a test cannot wait minutes.
"""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi.testclient import TestClient

from tests.test_brd_phase2 import _audit_actions, _make_run, _steps
from tests.test_execution import _create_approved_case, _setup_admin_project_and_case

WORKED = timedelta(minutes=3)
BLOCKED = timedelta(minutes=2)


def _parse(value: str) -> datetime:
    return datetime.fromisoformat(value)


def _simulate_block_history(db_session, tenant_id: str, step_id: str, run_case_id: str) -> None:
    """Pretend the step was opened 5 minutes ago and the case was blocked 2
    minutes ago (so 3 minutes of work, then 2 blocked)."""
    from sqlalchemy import update

    from app.core.db import set_tenant_context
    from app.models.execution import ExecutionStep, TestRunCase

    now = datetime.now(UTC)
    set_tenant_context(db_session, tenant_id)
    db_session.execute(
        update(ExecutionStep)
        .where(ExecutionStep.id == UUID(step_id))
        .values(opened_at=now - WORKED - BLOCKED)
    )
    db_session.execute(
        update(TestRunCase)
        .where(TestRunCase.id == UUID(run_case_id))
        .values(completed_at=now - BLOCKED)
    )
    db_session.commit()


def test_unblock_excludes_the_blocked_time_from_the_open_step(
    client: TestClient, platform_admin: dict, db_session
) -> None:
    tenant_id, project, case = _setup_admin_project_and_case(client, platform_admin)
    other = _create_approved_case(client, project["id"], "Verify Salvage Valuation")
    # A second case that stays open, so blocking the first does not finish the run.
    run = _make_run(client, project["id"], [case["id"], other["id"]])
    run_case_id = run["cases"][0]["id"]
    step = _steps(client, run_case_id)[0]
    assert client.post(f"/api/v1/execution-steps/{step['id']}/open").status_code == 200
    client.post(f"/api/v1/test-run-cases/{run_case_id}/block", json={"reason": "Env down"})
    _simulate_block_history(db_session, tenant_id, step["id"], run_case_id)
    before = _parse(_steps(client, run_case_id)[0]["opened_at"])

    assert client.post(f"/api/v1/test-run-cases/{run_case_id}/unblock").status_code == 200

    after = _parse(_steps(client, run_case_id)[0]["opened_at"])
    shifted = after - before
    assert BLOCKED - timedelta(seconds=10) <= shifted <= BLOCKED + timedelta(seconds=10), shifted
    # The clock now reads the 3 minutes actually worked, not the 5 since opening.
    elapsed = datetime.now(UTC) - after
    assert WORKED - timedelta(seconds=10) <= elapsed <= WORKED + timedelta(seconds=15), elapsed

    events = _audit_actions(client, "testrun.case_unblocked")
    assert len(events) == 1
    blocked_seconds = events[0]["metadata"]["blocked_seconds"]
    assert abs(blocked_seconds - BLOCKED.total_seconds()) <= 10


def test_recorded_step_duration_excludes_the_blocked_time(
    client: TestClient, platform_admin: dict, db_session
) -> None:
    tenant_id, project, case = _setup_admin_project_and_case(client, platform_admin)
    other = _create_approved_case(client, project["id"], "Verify Salvage Valuation")
    # A second case that stays open, so blocking the first does not finish the run.
    run = _make_run(client, project["id"], [case["id"], other["id"]])
    run_case_id = run["cases"][0]["id"]
    step = _steps(client, run_case_id)[0]
    assert client.post(f"/api/v1/execution-steps/{step['id']}/open").status_code == 200
    client.post(f"/api/v1/test-run-cases/{run_case_id}/block", json={"reason": "Env down"})
    _simulate_block_history(db_session, tenant_id, step["id"], run_case_id)
    assert client.post(f"/api/v1/test-run-cases/{run_case_id}/unblock").status_code == 200

    verdict = client.post(f"/api/v1/execution-steps/{step['id']}/verdict", json={"verdict": "pass"})
    assert verdict.status_code == 200, verdict.text
    duration = _steps(client, run_case_id)[0]["duration_ms"] / 1000
    assert (
        WORKED.total_seconds() - 10 <= duration <= WORKED.total_seconds() + 15
    ), f"duration {duration}s should be about {WORKED.total_seconds()}s, not 300s"


def test_unblock_leaves_steps_that_already_have_a_verdict_alone(
    client: TestClient, platform_admin: dict, db_session
) -> None:
    tenant_id, project, case = _setup_admin_project_and_case(client, platform_admin)
    other = _create_approved_case(client, project["id"], "Verify Salvage Valuation")
    # A second case that stays open, so blocking the first does not finish the run.
    run = _make_run(client, project["id"], [case["id"], other["id"]])
    run_case_id = run["cases"][0]["id"]
    steps = _steps(client, run_case_id)
    assert len(steps) >= 2
    done = client.post(
        f"/api/v1/execution-steps/{steps[0]['id']}/verdict", json={"verdict": "pass"}
    )
    assert done.status_code == 200, done.text
    assert client.post(f"/api/v1/execution-steps/{steps[1]['id']}/open").status_code == 200
    first_before = _steps(client, run_case_id)[0]

    client.post(f"/api/v1/test-run-cases/{run_case_id}/block", json={"reason": "Env down"})
    _simulate_block_history(db_session, tenant_id, steps[1]["id"], run_case_id)
    assert client.post(f"/api/v1/test-run-cases/{run_case_id}/unblock").status_code == 200

    first_after = _steps(client, run_case_id)[0]
    for field in ("opened_at", "closed_at", "duration_ms", "verdict"):
        assert first_after[field] == first_before[field], field
