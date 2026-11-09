from fastapi.testclient import TestClient


def _bootstrap_tenant(client: TestClient, platform_admin: dict) -> dict:
    response = client.post(
        "/api/v1/platform/tenants",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={
            "tenant_name": "Horizon Mutual",
            "admin_name": "Admin A",
            "admin_email": "admin@horizon.com",
            "admin_password": "AdminPassw0rd!",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _login_and_verify(client: TestClient, tenant_id: str, email: str, password: str) -> None:
    login_response = client.post(
        "/api/v1/auth/login",
        json={"tenant_id": tenant_id, "email": email, "password": password},
    )
    assert login_response.status_code == 200, login_response.text
    code = login_response.json()["data"]["debug_code"]
    verify_response = client.post("/api/v1/auth/mfa/verify", json={"code": code})
    assert verify_response.status_code == 200, verify_response.text


def _create_user(client: TestClient, email: str, name: str, role: str, password: str) -> str:
    response = client.post(
        "/api/v1/users", json={"email": email, "name": name, "role": role, "password": password}
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]["id"]


def _create_project(client: TestClient, name: str = "Apex Motor Claims") -> dict:
    response = client.post(
        "/api/v1/projects",
        json={
            "name": name,
            "domain": "Motor",
            "priority": "High",
            "manager_name": "Jane Manager",
            "start_date": "2026-01-01",
            "end_date": "2026-12-31",
            "budget": "450000.00",
            "region": "North America",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _sample_steps() -> list[dict]:
    return [
        {
            "action": "Input Policy Number with Comprehensive Endorsement",
            "expected": "System displays ACV",
        },
        {"action": "Input Theft Police Report Date within 48h", "expected": "Verified flag set"},
        {"action": "Apply $500 deductible", "expected": "Payout equals ACV minus $500"},
    ]


def _setup_admin_and_project(client: TestClient, platform_admin: dict) -> tuple[str, str]:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project = _create_project(client)
    return tenant_id, project["id"]


def test_create_test_case_starts_as_draft_version_one(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)

    response = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={
            "title": "Verify Total Loss Settlement Calculation",
            "priority": "Critical",
            "steps": _sample_steps(),
        },
    )
    assert response.status_code == 200, response.text
    case = response.json()["data"]
    assert case["status"] == "draft"
    assert case["version_number"] == 1
    assert len(case["steps"]) == 3
    assert case["steps"][0]["step_number"] == 1


def test_at_least_one_step_required(client: TestClient, platform_admin: dict) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    response = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={"title": "Case with no steps", "priority": "Low", "steps": []},
    )
    assert response.status_code == 422


def test_title_minimum_length_enforced(client: TestClient, platform_admin: dict) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    response = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={"title": "abc", "priority": "Low", "steps": _sample_steps()},
    )
    assert response.status_code == 422


def test_full_approval_workflow(client: TestClient, platform_admin: dict) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    case = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={"title": "Verify Deductible Math", "priority": "High", "steps": _sample_steps()},
    ).json()["data"]
    case_id = case["id"]

    submit_response = client.post(f"/api/v1/test-cases/{case_id}/submit-review")
    assert submit_response.status_code == 200
    assert submit_response.json()["data"]["status"] == "ready_for_review"

    approve_response = client.post(f"/api/v1/test-cases/{case_id}/approve")
    assert approve_response.status_code == 200
    assert approve_response.json()["data"]["status"] == "approved"

    versions = client.get(f"/api/v1/test-cases/{case_id}/versions").json()["data"]
    assert len(versions) == 1
    assert versions[0]["approved_by"] is not None


def test_tester_cannot_approve(client: TestClient, platform_admin: dict) -> None:
    tenant_id, project_id = _setup_admin_and_project(client, platform_admin)
    case = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={"title": "Tester Cannot Approve This", "priority": "Low", "steps": _sample_steps()},
    ).json()["data"]
    case_id = case["id"]
    client.post(f"/api/v1/test-cases/{case_id}/submit-review")

    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project_id}/members", json={"user_id": tester_id})

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")

    approve_response = tester_client.post(f"/api/v1/test-cases/{case_id}/approve")
    assert approve_response.status_code == 403


def test_cannot_approve_from_draft_directly(client: TestClient, platform_admin: dict) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    case = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={"title": "Still In Draft Status", "priority": "Low", "steps": _sample_steps()},
    ).json()["data"]

    approve_response = client.post(f"/api/v1/test-cases/{case['id']}/approve")
    assert approve_response.status_code == 409


def test_editing_approved_case_forks_version_and_reverts_to_draft(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    case = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={
            "title": "Will Be Approved Then Edited",
            "priority": "Medium",
            "steps": _sample_steps(),
        },
    ).json()["data"]
    case_id = case["id"]
    client.post(f"/api/v1/test-cases/{case_id}/submit-review")
    client.post(f"/api/v1/test-cases/{case_id}/approve")

    new_steps = _sample_steps() + [{"action": "Extra new step", "expected": "Extra outcome"}]
    edit_response = client.patch(f"/api/v1/test-cases/{case_id}", json={"steps": new_steps})
    assert edit_response.status_code == 200
    edited = edit_response.json()["data"]
    assert edited["status"] == "draft"
    assert edited["version_number"] == 2
    assert len(edited["steps"]) == 4

    versions = client.get(f"/api/v1/test-cases/{case_id}/versions").json()["data"]
    assert len(versions) == 2
    assert len(versions[0]["steps"]) == 3  # original version untouched
    assert versions[0]["approved_by"] is not None  # historical approval preserved


def test_editing_draft_does_not_create_new_version(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    case = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={"title": "Draft Edited In Place", "priority": "Low", "steps": _sample_steps()},
    ).json()["data"]

    edit_response = client.patch(f"/api/v1/test-cases/{case['id']}", json={"priority": "Critical"})
    assert edit_response.status_code == 200
    edited = edit_response.json()["data"]
    assert edited["version_number"] == 1
    assert edited["priority"] == "Critical"

    versions = client.get(f"/api/v1/test-cases/{case['id']}/versions").json()["data"]
    assert len(versions) == 1


def test_tester_can_delete_own_draft_but_not_others(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project_id = _setup_admin_and_project(client, platform_admin)
    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project_id}/members", json={"user_id": tester_id})

    admin_case = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={"title": "Admin Owned Draft Case", "priority": "Low", "steps": _sample_steps()},
    ).json()["data"]

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")
    own_case = tester_client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={"title": "Tester Owned Draft Case", "priority": "Low", "steps": _sample_steps()},
    ).json()["data"]

    # Tester cannot delete someone else's draft.
    forbidden_response = tester_client.delete(f"/api/v1/test-cases/{admin_case['id']}")
    assert forbidden_response.status_code == 403

    # Tester can delete their own draft.
    ok_response = tester_client.delete(f"/api/v1/test-cases/{own_case['id']}")
    assert ok_response.status_code == 200


def test_tester_cannot_delete_own_approved_case(client: TestClient, platform_admin: dict) -> None:
    tenant_id, project_id = _setup_admin_and_project(client, platform_admin)
    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project_id}/members", json={"user_id": tester_id})

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")
    own_case = tester_client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={"title": "Will Get Approved Case", "priority": "Low", "steps": _sample_steps()},
    ).json()["data"]
    tester_client.post(f"/api/v1/test-cases/{own_case['id']}/submit-review")
    client.post(f"/api/v1/test-cases/{own_case['id']}/approve")

    delete_response = tester_client.delete(f"/api/v1/test-cases/{own_case['id']}")
    assert delete_response.status_code == 403


def test_tester_restricted_to_assigned_project_for_test_cases(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project_id = _setup_admin_and_project(client, platform_admin)
    _create_user(client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!")
    # Not added as a project member.

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")

    list_response = tester_client.get(f"/api/v1/projects/{project_id}/test-cases")
    assert list_response.status_code == 403

    create_response = tester_client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={"title": "Should Be Blocked Here", "priority": "Low", "steps": _sample_steps()},
    )
    assert create_response.status_code == 403


def test_description_field_persists_and_versions_with_edits(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    case = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={
            "title": "Verify Total Loss Settlement Calculation",
            "description": "Covers the ACV minus deductible payout path.",
            "priority": "Critical",
            "steps": _sample_steps(),
        },
    ).json()["data"]
    assert case["description"] == "Covers the ACV minus deductible payout path."

    updated = client.patch(
        f"/api/v1/test-cases/{case['id']}", json={"description": "Updated description."}
    ).json()["data"]
    assert updated["description"] == "Updated description."


def test_list_search_filter_sort_and_pagination(client: TestClient, platform_admin: dict) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    for title, priority in [
        ("Verify Alpha Settlement Flow", "Low"),
        ("Verify Beta Claims Intake", "High"),
        ("Gamma Policy Renewal Check", "Critical"),
    ]:
        client.post(
            f"/api/v1/projects/{project_id}/test-cases",
            json={"title": title, "priority": priority, "steps": _sample_steps()},
        )

    search = client.get(
        f"/api/v1/projects/{project_id}/test-cases", params={"search": "verify"}
    ).json()["data"]
    assert search["total"] == 2

    by_priority = client.get(
        f"/api/v1/projects/{project_id}/test-cases", params={"priority": "Critical"}
    ).json()["data"]
    assert by_priority["total"] == 1
    assert by_priority["items"][0]["title"] == "Gamma Policy Renewal Check"

    sorted_desc = client.get(
        f"/api/v1/projects/{project_id}/test-cases", params={"sort": "-title"}
    ).json()["data"]
    titles = [c["title"] for c in sorted_desc["items"]]
    assert titles == sorted(titles, reverse=True)

    page1 = client.get(
        f"/api/v1/projects/{project_id}/test-cases", params={"page": 1, "page_size": 2}
    ).json()["data"]
    assert page1["total"] == 3
    assert len(page1["items"]) == 2
    page2 = client.get(
        f"/api/v1/projects/{project_id}/test-cases", params={"page": 2, "page_size": 2}
    ).json()["data"]
    assert len(page2["items"]) == 1


def test_list_filter_by_assignee(client: TestClient, platform_admin: dict) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project_id}/members", json={"user_id": tester_id})

    assigned = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={
            "title": "Assigned To Tester Case",
            "priority": "Low",
            "assignee_id": tester_id,
            "steps": _sample_steps(),
        },
    ).json()["data"]
    client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={"title": "Unassigned Case Here", "priority": "Low", "steps": _sample_steps()},
    )

    filtered = client.get(
        f"/api/v1/projects/{project_id}/test-cases", params={"assignee_id": tester_id}
    ).json()["data"]
    assert filtered["total"] == 1
    assert filtered["items"][0]["id"] == assigned["id"]


def test_version_compare_shows_step_and_title_diff(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    case = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={
            "title": "Verify Total Loss Settlement Calculation",
            "priority": "Critical",
            "steps": _sample_steps(),
        },
    ).json()["data"]
    client.post(f"/api/v1/test-cases/{case['id']}/submit-review")
    client.post(f"/api/v1/test-cases/{case['id']}/approve")

    # Editing an approved case forks version 2.
    new_steps = _sample_steps()
    new_steps[0]["action"] = "Input Policy Number with Updated Comprehensive Endorsement"
    new_steps.append({"action": "New follow-up step", "expected": "Follow-up confirmed"})
    client.patch(
        f"/api/v1/test-cases/{case['id']}",
        json={"title": "Verify Total Loss Settlement Calculation (Revised)", "steps": new_steps},
    )

    compare = client.get(
        f"/api/v1/test-cases/{case['id']}/versions/compare", params={"from": 1, "to": 2}
    ).json()["data"]
    assert compare["title_changed"] is True
    assert compare["old_title"] == "Verify Total Loss Settlement Calculation"
    assert compare["new_title"] == "Verify Total Loss Settlement Calculation (Revised)"

    step_changes = {s["step_number"]: s["change"] for s in compare["steps"]}
    assert step_changes[1] == "modified"
    assert step_changes[2] == "unchanged"
    assert step_changes[4] == "added"


def test_deprecate_requires_admin_or_manager_and_is_terminal(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project_id = _setup_admin_and_project(client, platform_admin)
    case = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={"title": "Legacy Case To Retire", "priority": "Low", "steps": _sample_steps()},
    ).json()["data"]

    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project_id}/members", json={"user_id": tester_id})
    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")
    denied = tester_client.post(f"/api/v1/test-cases/{case['id']}/deprecate")
    assert denied.status_code == 403

    approved = client.post(f"/api/v1/test-cases/{case['id']}/deprecate")
    assert approved.status_code == 200
    assert approved.json()["data"]["status"] == "deprecated"

    again = client.post(f"/api/v1/test-cases/{case['id']}/deprecate")
    assert again.status_code == 409
