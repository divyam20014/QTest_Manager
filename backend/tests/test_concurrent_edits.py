"""ADR-136 (finding F-04): a save made from an out-of-date copy is refused.

Each test plays two people: both read a record, one saves, then the other saves or
decides using what they read before.
"""

from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient

from tests.test_execution import (
    _bootstrap_tenant,
    _create_project,
    _login_and_verify,
    _sample_steps,
)

API = "/api/v1"


def _setup(client: TestClient, platform_admin: dict) -> str:
    tenant_id = _bootstrap_tenant(client, platform_admin)["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    return _create_project(client)["id"]


def _ok(response) -> dict:
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _stale(response) -> None:
    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "stale_write", response.text


def _case(client: TestClient, project_id: str) -> dict:
    return _ok(
        client.post(
            f"{API}/projects/{project_id}/test-cases",
            json={"title": "Shared test case", "priority": "High", "steps": _sample_steps()},
        )
    )


def _defect(client: TestClient, project_id: str) -> dict:
    return _ok(
        client.post(
            f"{API}/defects",
            json={"project_id": project_id, "title": "Shared defect", "severity": "Major"},
        )
    )


def _get(client: TestClient, kind: str, record_id: str) -> dict:
    return _ok(client.get(f"{API}/{kind}/{record_id}"))


# --- test cases ---------------------------------------------------------------------------


def test_stale_test_case_save_is_refused_and_changes_nothing(
    client: TestClient, platform_admin: dict
) -> None:
    case = _case(client, _setup(client, platform_admin))
    opened = case["row_version"]

    first = _ok(
        client.patch(
            f"{API}/test-cases/{case['id']}",
            json={"title": "Saved by the first person", "expected_version": opened},
        )
    )
    assert first["row_version"] == opened + 1

    _stale(
        client.patch(
            f"{API}/test-cases/{case['id']}",
            json={"title": "Saved by the second person", "expected_version": opened},
        )
    )
    after = _get(client, "test-cases", case["id"])
    assert after["title"] == "Saved by the first person"
    assert after["row_version"] == opened + 1


def test_reviewer_cannot_approve_content_they_have_not_seen(
    client: TestClient, platform_admin: dict
) -> None:
    case = _case(client, _setup(client, platform_admin))
    seen = _ok(client.post(f"{API}/test-cases/{case['id']}/submit-review"))["row_version"]
    _ok(
        client.patch(
            f"{API}/test-cases/{case['id']}", json={"expected_result": "Changed during review"}
        )
    )

    _stale(client.post(f"{API}/test-cases/{case['id']}/approve", json={"expected_version": seen}))
    _stale(
        client.post(
            f"{API}/test-cases/{case['id']}/request-changes",
            json={"comment": "Please fix", "expected_version": seen},
        )
    )
    after = _get(client, "test-cases", case["id"])
    assert after["status"] == "ready_for_review"
    assert _ok(client.get(f"{API}/test-cases/{case['id']}/comments")) == []

    approved = _ok(
        client.post(
            f"{API}/test-cases/{case['id']}/approve",
            json={"expected_version": after["row_version"]},
        )
    )
    assert approved["status"] == "approved"


def test_every_review_step_and_module_move_changes_the_test_case_version(
    client: TestClient, platform_admin: dict
) -> None:
    project_id = _setup(client, platform_admin)
    case = _case(client, project_id)
    base = f"{API}/test-cases/{case['id']}"
    versions = [case["row_version"]]

    versions.append(_ok(client.post(f"{base}/submit-review"))["row_version"])
    versions.append(
        _ok(client.post(f"{base}/request-changes", json={"comment": "Again"}))["row_version"]
    )
    module = _ok(client.post(f"{API}/projects/{project_id}/modules", json={"name": "Claims"}))
    _ok(client.post(f"{base}/module", json={"module_id": module["id"]}))
    versions.append(_get(client, "test-cases", case["id"])["row_version"])
    versions.append(_ok(client.post(f"{base}/deprecate"))["row_version"])

    assert versions == list(range(versions[0], versions[0] + len(versions)))


def test_saving_without_a_change_keeps_the_version_and_the_version_is_optional(
    client: TestClient, platform_admin: dict
) -> None:
    case = _case(client, _setup(client, platform_admin))
    same = _ok(client.patch(f"{API}/test-cases/{case['id']}", json={"title": case["title"]}))
    assert same["row_version"] == case["row_version"]
    # API clients that send no version keep working.
    changed = _ok(client.patch(f"{API}/test-cases/{case['id']}", json={"priority": "Low"}))
    assert changed["row_version"] == case["row_version"] + 1


# --- defects ------------------------------------------------------------------------------


def test_stale_defect_save_and_status_change_are_refused(
    client: TestClient, platform_admin: dict
) -> None:
    defect = _defect(client, _setup(client, platform_admin))
    opened = defect["row_version"]
    base = f"{API}/defects/{defect['id']}"

    first = _ok(client.patch(base, json={"title": "First edit", "expected_version": opened}))
    assert first["row_version"] == opened + 1

    _stale(client.patch(base, json={"title": "Second edit", "expected_version": opened}))
    _stale(client.patch(f"{base}/status", json={"status": "Open", "expected_version": opened}))
    after = _get(client, "defects", defect["id"])
    assert (after["title"], after["status"]) == ("First edit", defect["status"])
    assert after["row_version"] == opened + 1


def test_every_kind_of_defect_change_moves_the_version(
    client: TestClient, platform_admin: dict
) -> None:
    defect = _defect(client, _setup(client, platform_admin))
    base = f"{API}/defects/{defect['id']}"
    version = defect["row_version"]

    for method, path, body in (
        ("patch", "/status", {"status": "Open"}),
        ("patch", "/root-cause", {"root_cause": "code_defect"}),
        ("patch", "", {"priority": "Low"}),
        ("patch", "/status", {"status": "Rejected", "resolution": "Not Applicable"}),
        ("post", "/reopen", None),
    ):
        response = client.request(method.upper(), base + path, json=body)
        version += 1
        assert _ok(response)["row_version"] == version, (path, body)

    # Nothing changed, so nothing moves.
    assert _ok(client.patch(base, json={"priority": "Low"}))["row_version"] == version
    assert (
        _ok(client.patch(f"{base}/root-cause", json={"root_cause": "code_defect"}))["row_version"]
        == version
    )


def test_two_saves_at_the_same_moment_cannot_both_succeed(
    client: TestClient, platform_admin: dict
) -> None:
    project_id = _setup(client, platform_admin)
    for kind, record in (
        ("defects", _defect(client, project_id)),
        ("test-cases", _case(client, project_id)),
    ):
        for attempt in range(3):
            version = _get(client, kind, record["id"])["row_version"]

            def save(who: str, *, url=f"{API}/{kind}/{record['id']}", v=version, n=attempt):
                return client.patch(
                    url, json={"title": f"Edit {n} by {who}", "expected_version": v}
                ).status_code

            with ThreadPoolExecutor(max_workers=2) as pool:
                codes = sorted(pool.map(save, ["one", "two"]))
            assert codes == [200, 409], (kind, attempt, codes)
