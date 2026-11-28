"""ADR-152 (Phase 4A): the environment, build and release a run is run against."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from tests.test_execution import _create_approved_case
from tests.test_task_planning import (
    API,
    _bootstrap_tenant,
    _create_project,
    _login_and_verify,
    _ok,
    _sign_in,
)


@pytest.fixture
def world(client: TestClient, platform_admin: dict) -> dict:
    tenant_id = _bootstrap_tenant(client, platform_admin)["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project = _create_project(client)["id"]
    other = _create_project(client, "Other project")["id"]
    return {
        "tenant_id": tenant_id,
        "project": project,
        "other": other,
        "case": _create_approved_case(client, project, "Verify the context")["id"],
        "env": _ok(client.post(f"{API}/environments", json={"name": "Staging"}))["id"],
    }


def _release(client: TestClient, project: str, name: str = "Release 1.0") -> dict:
    return _ok(client.post(f"{API}/projects/{project}/releases", json={"name": name}))


def _build(client: TestClient, project: str, name: str = "build-100", **extra) -> dict:
    return _ok(client.post(f"{API}/projects/{project}/builds", json={"name": name, **extra}))


def _run(client: TestClient, world: dict, **extra):
    body = {"name": "Smoke run", "run_type": "Smoke", "test_case_ids": [world["case"]], **extra}
    return client.post(f"{API}/projects/{world['project']}/test-runs", json=body)


def _require(client: TestClient, on: bool = True) -> None:
    _ok(client.patch(f"{API}/settings", json={"require_run_environment_build": on}))


def test_a_run_records_its_environment_build_and_release(client: TestClient, world: dict) -> None:
    release = _release(client, world["project"])
    build = _build(client, world["project"], release_id=release["id"])

    run = _ok(_run(client, world, environment_id=world["env"], build_id=build["id"]))

    assert (run["environment_name"], run["build_name"], run["release_name"]) == (
        "Staging",
        "build-100",
        "Release 1.0",
    )  # the release comes from the build
    listed = _ok(client.get(f"{API}/projects/{world['project']}/test-runs"))[0]
    assert (listed["environment_name"], listed["build_id"], listed["release_id"]) == (
        "Staging",
        build["id"],
        release["id"],
    )
    again = _ok(client.get(f"{API}/test-runs/{run['id']}"))
    assert again["build_name"] == "build-100"


def test_a_run_without_them_says_nothing_by_default(client: TestClient, world: dict) -> None:
    run = _ok(_run(client, world))
    assert (run["environment_id"], run["build_id"], run["release_id"]) == (None, None, None)
    assert run["environment_name"] is None


def test_choices_are_checked(client: TestClient, world: dict) -> None:
    elsewhere_release = _release(client, world["other"], "Elsewhere")
    elsewhere_build = _build(client, world["other"], "elsewhere-1")
    release = _release(client, world["project"])
    other_release = _release(client, world["project"], "Release 2.0")
    build = _build(client, world["project"], release_id=release["id"])
    bare = _build(client, world["project"], "bare-1")

    for extra, field in (
        ({"environment_id": "00000000-0000-0000-0000-000000000000"}, "environment_id"),
        ({"build_id": elsewhere_build["id"]}, "build_id"),
        ({"release_id": elsewhere_release["id"]}, "release_id"),
        ({"build_id": build["id"], "release_id": other_release["id"]}, "release_id"),
    ):
        response = _run(client, world, **extra)
        assert response.status_code == 422, response.text
        assert field in response.json()["error"]["fields"]
    # A build with no release lets the run name one.
    ok = _ok(_run(client, world, build_id=bare["id"], release_id=other_release["id"]))
    assert ok["release_name"] == "Release 2.0"


def test_the_organization_can_require_an_environment_and_a_build(
    client: TestClient, world: dict
) -> None:
    _require(client)
    build = _build(client, world["project"])

    refused = _run(client, world)
    assert refused.status_code == 422, refused.text
    assert {"environment_id", "build_id"} <= set(refused.json()["error"]["fields"])
    assert _run(client, world, environment_id=world["env"]).status_code == 422
    _ok(_run(client, world, environment_id=world["env"], build_id=build["id"]))
    _require(client, False)
    _ok(_run(client, world))


def test_old_runs_can_be_filled_in_until_finished_even_after_starting(
    client: TestClient, world: dict
) -> None:
    run = _ok(_run(client, world))
    build = _build(client, world["project"])
    run_case = run["cases"][0]["id"]
    steps = _ok(client.get(f"{API}/test-run-cases/{run_case}/steps"))
    _ok(client.post(f"{API}/execution-steps/{steps[0]['id']}/verdict", json={"verdict": "pass"}))

    # The wording is locked once execution starts, but what it ran against can be recorded.
    assert (
        client.patch(f"{API}/test-runs/{run['id']}", json={"name": "New name"}).status_code == 409
    )
    changed = _ok(
        client.patch(
            f"{API}/test-runs/{run['id']}",
            json={"environment_id": world["env"], "build_id": build["id"]},
        )
    )
    assert (changed["environment_name"], changed["build_name"]) == ("Staging", "build-100")
    cleared = _ok(client.patch(f"{API}/test-runs/{run['id']}", json={"environment_id": None}))
    assert cleared["environment_id"] is None and cleared["build_name"] == "build-100"
    _ok(client.post(f"{API}/test-runs/{run['id']}/finish"))
    response = client.patch(f"{API}/test-runs/{run['id']}", json={"environment_id": world["env"]})
    assert response.status_code == 409


def test_a_rerun_keeps_what_the_run_was_run_against(client: TestClient, world: dict) -> None:
    build = _build(client, world["project"])
    run = _ok(_run(client, world, environment_id=world["env"], build_id=build["id"]))
    run_case = run["cases"][0]["id"]
    steps = _ok(client.get(f"{API}/test-run-cases/{run_case}/steps"))
    _ok(
        client.post(
            f"{API}/execution-steps/{steps[0]['id']}/verdict",
            json={"verdict": "fail", "actual_result": "It broke"},
        )
    )
    _ok(client.post(f"{API}/test-runs/{run['id']}/finish"))

    rerun = _ok(client.post(f"{API}/test-runs/{run['id']}/rerun-failed"))

    assert (rerun["environment_name"], rerun["build_name"]) == ("Staging", "build-100")


def test_builds_belong_to_a_release_of_their_own_project(client: TestClient, world: dict) -> None:
    release = _release(client, world["project"])
    elsewhere = _release(client, world["other"], "Elsewhere")
    response = client.post(
        f"{API}/projects/{world['project']}/builds",
        json={"name": "wrong", "release_id": elsewhere["id"]},
    )
    assert response.status_code == 422, response.text

    build = _build(client, world["project"])
    moved = _ok(client.patch(f"{API}/builds/{build['id']}", json={"release_id": release["id"]}))
    assert moved["release_id"] == release["id"]
    assert (
        client.patch(
            f"{API}/builds/{build['id']}", json={"release_id": elsewhere["id"]}
        ).status_code
        == 422
    )
    # Once a run used it, the build keeps its release.
    _ok(_run(client, world, build_id=build["id"]))
    assert client.patch(f"{API}/builds/{build['id']}", json={"release_id": None}).status_code == 409


def test_what_runs_used_cannot_be_deleted(client: TestClient, world: dict) -> None:
    release = _release(client, world["project"])
    build = _build(client, world["project"], release_id=release["id"])
    spare = _release(client, world["project"], "Spare")
    _ok(_run(client, world, environment_id=world["env"], build_id=build["id"]))

    assert client.delete(f"{API}/builds/{build['id']}").status_code == 409
    assert client.delete(f"{API}/releases/{release['id']}").status_code == 409
    assert client.delete(f"{API}/environments/{world['env']}").status_code == 409
    _ok(client.delete(f"{API}/releases/{spare['id']}"))


def test_deleting_a_release_leaves_its_builds_without_one(client: TestClient, world: dict) -> None:
    release = _release(client, world["project"])
    build = _build(client, world["project"], release_id=release["id"])

    _ok(client.delete(f"{API}/releases/{release['id']}"))

    builds = _ok(client.get(f"{API}/projects/{world['project']}/builds"))
    assert [b["release_id"] for b in builds if b["id"] == build["id"]] == [None]


def test_the_database_keeps_builds_and_runs_in_one_project(
    client: TestClient, world: dict, owner_engine
) -> None:
    elsewhere = _build(client, world["other"], "elsewhere-1")
    run = _ok(_run(client, world))
    with pytest.raises(DBAPIError), owner_engine.begin() as conn:
        conn.execute(
            text("update test_runs set build_id = :b where id = :r"),
            {"b": elsewhere["id"], "r": run["id"]},
        )


def test_only_those_who_manage_settings_can_require_it(client: TestClient, world: dict) -> None:
    them = _sign_in(client, world, "who", "qa_lead")
    response = them.patch(f"{API}/settings", json={"require_run_environment_build": True})
    assert response.status_code == 403


# --- bulk assign (ADR-154) -------------------------------------------------------------------


def _two_case_run(client: TestClient, world: dict) -> dict:
    second = _create_approved_case(client, world["project"], "Verify the second")["id"]
    return _ok(_run(client, world, test_case_ids=[world["case"], second]))


def _bulk(client: TestClient, run: dict, ids: list[str] | None = None, **body):
    ids = ids if ids is not None else [c["id"] for c in run["cases"]]
    return client.post(
        f"{API}/test-runs/{run['id']}/cases/assign", json={"test_run_case_ids": ids, **body}
    )


def test_many_cases_are_assigned_and_dated_at_once(client: TestClient, world: dict) -> None:
    run = _two_case_run(client, world)
    me = _ok(client.get(f"{API}/auth/me"))["user_id"]

    assert _ok(_bulk(client, run, assigned_to=me, due_date="2099-01-01"))["updated"] == 2

    cases = _ok(client.get(f"{API}/test-runs/{run['id']}"))["cases"]
    assert {(c["assigned_to"], c["due_date"]) for c in cases} == {(me, "2099-01-01")}
    # Only what is sent changes: a date alone leaves the assignee; null clears.
    _ok(_bulk(client, run, due_date="2099-02-02"))
    _ok(_bulk(client, run, ids=[run["cases"][0]["id"]], assigned_to=None))
    cases = {c["id"]: c for c in _ok(client.get(f"{API}/test-runs/{run['id']}"))["cases"]}
    first, second = (cases[c["id"]] for c in run["cases"])
    assert (first["assigned_to"], first["due_date"]) == (None, "2099-02-02")
    assert (second["assigned_to"], second["due_date"]) == (me, "2099-02-02")


def test_a_bulk_change_is_all_or_nothing_and_checked(client: TestClient, world: dict) -> None:
    run = _two_case_run(client, world)
    other_run = _ok(_run(client, world, name="Another run"))
    stranger = other_run["cases"][0]["id"]
    me = _ok(client.get(f"{API}/auth/me"))["user_id"]
    ids = [c["id"] for c in run["cases"]]

    assert _bulk(client, run, ids=[*ids, stranger], due_date="2099-01-01").status_code == 422
    assert _bulk(client, run, ids=ids).status_code == 422  # nothing to change
    assert _bulk(client, run, ids=[], due_date="2099-01-01").status_code == 422
    assert _bulk(client, run, assigned_to="00000000-0000-0000-0000-000000000000").status_code == 404
    cases = _ok(client.get(f"{API}/test-runs/{run['id']}"))["cases"]
    assert {(c["assigned_to"], c["due_date"]) for c in cases} == {(None, None)}
    _ok(client.post(f"{API}/test-runs/{run['id']}/finish"))
    assert _bulk(client, run, assigned_to=me).status_code == 409


@pytest.mark.parametrize("role,expected", [("manager", 200), ("developer", 403)])
def test_bulk_assigning_needs_permission_to_create_runs(
    client: TestClient, world: dict, role: str, expected: int
) -> None:
    run = _two_case_run(client, world)
    them = _sign_in(client, world, "who", role)

    assert _bulk(them, run, due_date="2099-01-01").status_code == expected
