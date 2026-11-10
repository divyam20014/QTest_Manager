"""Phase 3 (AI/SaaS vision roadmap): AI Test Case Generator (GAP-72, first of
three sequenced AI capabilities) -- Gemini-backed, provider-agnostic
abstraction, tenant-level enable/disable + encrypted credential storage
(reusing Phase 1's settings), usage/token metering, and the
draft-not-published invariant (generated test cases are always created as
normal `draft` test cases a human must review)."""

from fastapi.testclient import TestClient

from app.core.ai.base import (
    AIChangeImpactResult,
    AIGenerationResult,
    AIProviderError,
    AIReviewResult,
    ChangeImpactFinding,
    GeneratedStep,
    GeneratedTestCase,
    ReviewSuggestion,
)


class FakeProvider:
    """Deterministic stand-in for GeminiProvider -- these tests exercise the
    service/API layer's AI-enabled/disabled branching, draft-creation,
    linking, review suggestions, change-impact analysis, and usage
    metering, not a real network call to Gemini."""

    def __init__(
        self,
        cases: list[GeneratedTestCase] | None = None,
        suggestions: list[ReviewSuggestion] | None = None,
        findings: list[ChangeImpactFinding] | None = None,
        raises: bool = False,
    ):
        self.cases = cases if cases is not None else _default_cases()
        self.suggestions = suggestions if suggestions is not None else _default_suggestions()
        self.findings = findings
        self.raises = raises
        self.calls: list[dict] = []
        self.review_calls: list[dict] = []
        self.change_impact_calls: list[dict] = []

    def generate_test_cases(
        self, *, api_key, requirement_title, requirement_description, max_cases
    ):
        self.calls.append(
            {
                "api_key": api_key,
                "requirement_title": requirement_title,
                "requirement_description": requirement_description,
                "max_cases": max_cases,
            }
        )
        if self.raises:
            raise AIProviderError("simulated provider failure")
        return AIGenerationResult(
            test_cases=self.cases[:max_cases],
            prompt_tokens=42,
            completion_tokens=58,
            total_tokens=100,
        )

    def review_test_case(self, *, api_key, title, description, steps):
        self.review_calls.append(
            {"api_key": api_key, "title": title, "description": description, "steps": steps}
        )
        if self.raises:
            raise AIProviderError("simulated provider failure")
        return AIReviewResult(
            suggestions=self.suggestions,
            prompt_tokens=5,
            completion_tokens=15,
            total_tokens=20,
        )

    def analyze_requirement_change(
        self, *, api_key, old_title, old_description, new_title, new_description, candidates
    ):
        self.change_impact_calls.append(
            {
                "api_key": api_key,
                "old_title": old_title,
                "old_description": old_description,
                "new_title": new_title,
                "new_description": new_description,
                "candidates": candidates,
            }
        )
        if self.raises:
            raise AIProviderError("simulated provider failure")
        findings = (
            self.findings
            if self.findings is not None
            else [
                ChangeImpactFinding(index=c.index, needs_review=True, reason="Wording changed")
                for c in candidates
            ]
        )
        return AIChangeImpactResult(
            findings=findings, prompt_tokens=8, completion_tokens=12, total_tokens=20
        )


def _default_suggestions() -> list[ReviewSuggestion]:
    return [
        ReviewSuggestion(category="clarity", message="Title could be more specific"),
        ReviewSuggestion(category="missing_steps", message="No step covers the failure path"),
    ]


def _default_cases() -> list[GeneratedTestCase]:
    return [
        GeneratedTestCase(
            title="Verify ACV calculation on total loss",
            description="Checks the ACV formula against a seeded vehicle value",
            steps=[GeneratedStep(action="Submit a total loss claim", expected="ACV is computed")],
        ),
        GeneratedTestCase(
            title="Verify ACV calculation handles zero salvage value",
            description="Edge case: salvage value is zero",
            steps=[
                GeneratedStep(action="Submit claim with zero salvage", expected="ACV equals value")
            ],
        ),
    ]


def _patch_provider(monkeypatch, provider) -> FakeProvider:
    monkeypatch.setattr("app.services.ai_service.get_provider", lambda name: provider)
    return provider


def _bootstrap_tenant(
    client: TestClient, platform_admin: dict, name: str = "Horizon Mutual"
) -> dict:
    response = client.post(
        "/api/v1/platform/tenants",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={
            "tenant_name": name,
            "admin_name": "Admin A",
            "admin_email": "admin@horizon.com",
            "admin_password": "AdminPassw0rd!",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _login_and_verify(client: TestClient, tenant_id: str, email: str, password: str) -> None:
    login_response = client.post(
        "/api/v1/auth/login", json={"tenant_id": tenant_id, "email": email, "password": password}
    )
    assert login_response.status_code == 200, login_response.text
    code = login_response.json()["data"]["debug_code"]
    verify_response = client.post("/api/v1/auth/mfa/verify", json={"code": code})
    assert verify_response.status_code == 200, verify_response.text


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


def _create_test_case(client: TestClient, project_id: str, title: str) -> dict:
    response = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={
            "title": title,
            "priority": "High",
            "steps": [{"action": "Do X", "expected": "Y happens"}],
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _setup_admin_project_and_requirement(
    client: TestClient, platform_admin: dict
) -> tuple[str, str, str]:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project = _create_project(client)
    requirement = client.post(
        f"/api/v1/projects/{project['id']}/requirements",
        json={"title": "System shall calculate ACV on total loss", "description": "Per BRD FR-7"},
    ).json()["data"]
    return tenant_id, project["id"], requirement["id"]


def _enable_ai(client: TestClient) -> None:
    client.patch("/api/v1/settings", json={"ai_api_key": "test-gemini-key"})
    enabled = client.patch("/api/v1/settings", json={"ai_enabled": True})
    assert enabled.status_code == 200, enabled.text


def test_generation_is_rejected_when_ai_is_not_enabled(
    client: TestClient, platform_admin: dict, monkeypatch
) -> None:
    _, _, requirement_id = _setup_admin_project_and_requirement(client, platform_admin)
    _patch_provider(monkeypatch, FakeProvider())

    response = client.post(f"/api/v1/requirements/{requirement_id}/generate-test-cases", json={})
    assert response.status_code == 409, response.text


def test_generation_creates_draft_test_cases_linked_to_the_requirement(
    client: TestClient, platform_admin: dict, monkeypatch
) -> None:
    _, project_id, requirement_id = _setup_admin_project_and_requirement(client, platform_admin)
    _enable_ai(client)
    provider = _patch_provider(monkeypatch, FakeProvider())

    response = client.post(
        f"/api/v1/requirements/{requirement_id}/generate-test-cases", json={"max_cases": 2}
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert len(data["items"]) == 2
    assert data["total_tokens"] == 100
    # Draft-not-published invariant: AI never produces anything but a draft.
    assert all(item["status"] == "draft" for item in data["items"])
    assert len(provider.calls) == 1
    assert provider.calls[0]["max_cases"] == 2
    assert provider.calls[0]["requirement_title"] == "System shall calculate ACV on total loss"

    detail = client.get(f"/api/v1/requirements/{requirement_id}").json()["data"]
    assert detail["linked_test_case_count"] == 2

    coverage = client.get(f"/api/v1/projects/{project_id}/requirements/coverage").json()["data"]
    assert coverage["covered_requirements"] == 1


def test_generation_records_usage_including_on_provider_failure(
    client: TestClient, platform_admin: dict, monkeypatch
) -> None:
    _, _, requirement_id = _setup_admin_project_and_requirement(client, platform_admin)
    _enable_ai(client)
    _patch_provider(monkeypatch, FakeProvider())

    client.post(f"/api/v1/requirements/{requirement_id}/generate-test-cases", json={"max_cases": 1})
    usage = client.get("/api/v1/ai/usage").json()["data"]
    assert usage["total_requests"] == 1
    assert usage["successful_requests"] == 1
    assert usage["total_tokens"] == 100

    _patch_provider(monkeypatch, FakeProvider(raises=True))
    failed = client.post(
        f"/api/v1/requirements/{requirement_id}/generate-test-cases", json={"max_cases": 1}
    )
    assert failed.status_code == 409, failed.text

    usage_after = client.get("/api/v1/ai/usage").json()["data"]
    assert usage_after["total_requests"] == 2
    assert usage_after["successful_requests"] == 1


def test_tester_without_project_membership_cannot_generate(
    client: TestClient, platform_admin: dict, monkeypatch
) -> None:
    tenant_id, _, requirement_id = _setup_admin_project_and_requirement(client, platform_admin)
    _enable_ai(client)
    _patch_provider(monkeypatch, FakeProvider())

    client.post(
        "/api/v1/users",
        json={
            "email": "tester@horizon.com",
            "name": "Tester One",
            "role": "tester",
            "password": "TesterPassw0rd!",
        },
    )
    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")

    response = tester_client.post(
        f"/api/v1/requirements/{requirement_id}/generate-test-cases", json={}
    )
    assert response.status_code == 403, response.text


def test_ai_disabled_core_test_case_creation_is_unaffected(
    client: TestClient, platform_admin: dict
) -> None:
    """AI stays additive (ADR-045): with AI untouched (disabled, default),
    manual test case creation on the same project works exactly as before."""
    _, project_id, _ = _setup_admin_project_and_requirement(client, platform_admin)

    response = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={
            "title": "Manually authored case",
            "priority": "High",
            "steps": [{"action": "Do X", "expected": "Y happens"}],
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"]["status"] == "draft"


def test_ai_usage_is_tenant_isolated(client: TestClient, platform_admin: dict, monkeypatch) -> None:
    _, _, requirement_id = _setup_admin_project_and_requirement(client, platform_admin)
    _enable_ai(client)
    _patch_provider(monkeypatch, FakeProvider())
    client.post(f"/api/v1/requirements/{requirement_id}/generate-test-cases", json={"max_cases": 1})

    other_client = TestClient(client.app)
    other_bootstrap = _bootstrap_tenant(other_client, platform_admin, name="Summit Casualty")
    _login_and_verify(
        other_client, other_bootstrap["tenant"]["id"], "admin@horizon.com", "AdminPassw0rd!"
    )

    other_usage = other_client.get("/api/v1/ai/usage").json()["data"]
    assert other_usage["total_requests"] == 0


# --- Phase 4: AI Test Case Reviewer (GAP-72, second of three AI capabilities) ---


def test_review_is_rejected_when_ai_is_not_enabled(
    client: TestClient, platform_admin: dict, monkeypatch
) -> None:
    _, project_id, _ = _setup_admin_project_and_requirement(client, platform_admin)
    case = _create_test_case(client, project_id, "Verify ACV Calculation")
    _patch_provider(monkeypatch, FakeProvider())

    response = client.post(f"/api/v1/test-cases/{case['id']}/ai-review")
    assert response.status_code == 409, response.text


def test_review_returns_suggestions_and_does_not_mutate_the_test_case(
    client: TestClient, platform_admin: dict, monkeypatch
) -> None:
    _, project_id, _ = _setup_admin_project_and_requirement(client, platform_admin)
    case = _create_test_case(client, project_id, "Verify ACV Calculation")
    _enable_ai(client)
    provider = _patch_provider(monkeypatch, FakeProvider())

    before = client.get(f"/api/v1/test-cases/{case['id']}").json()["data"]

    response = client.post(f"/api/v1/test-cases/{case['id']}/ai-review")
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert len(data["suggestions"]) == 2
    assert data["suggestions"][0]["category"] == "clarity"
    assert data["total_tokens"] == 20
    assert len(provider.review_calls) == 1
    assert provider.review_calls[0]["title"] == "Verify ACV Calculation"

    # No-auto-mutation invariant: the test case itself is untouched.
    after = client.get(f"/api/v1/test-cases/{case['id']}").json()["data"]
    assert after == before


def test_review_records_usage_including_on_provider_failure(
    client: TestClient, platform_admin: dict, monkeypatch
) -> None:
    _, project_id, _ = _setup_admin_project_and_requirement(client, platform_admin)
    case = _create_test_case(client, project_id, "Verify ACV Calculation")
    _enable_ai(client)
    _patch_provider(monkeypatch, FakeProvider())

    client.post(f"/api/v1/test-cases/{case['id']}/ai-review")
    usage = client.get("/api/v1/ai/usage").json()["data"]
    assert usage["total_requests"] == 1
    assert usage["successful_requests"] == 1
    assert usage["total_tokens"] == 20

    _patch_provider(monkeypatch, FakeProvider(raises=True))
    failed = client.post(f"/api/v1/test-cases/{case['id']}/ai-review")
    assert failed.status_code == 409, failed.text

    usage_after = client.get("/api/v1/ai/usage").json()["data"]
    assert usage_after["total_requests"] == 2
    assert usage_after["successful_requests"] == 1


def test_review_with_no_issues_returns_empty_suggestions(
    client: TestClient, platform_admin: dict, monkeypatch
) -> None:
    _, project_id, _ = _setup_admin_project_and_requirement(client, platform_admin)
    case = _create_test_case(client, project_id, "Verify ACV Calculation")
    _enable_ai(client)
    _patch_provider(monkeypatch, FakeProvider(suggestions=[]))

    response = client.post(f"/api/v1/test-cases/{case['id']}/ai-review")
    assert response.status_code == 200, response.text
    assert response.json()["data"]["suggestions"] == []


def test_tester_without_project_membership_cannot_review(
    client: TestClient, platform_admin: dict, monkeypatch
) -> None:
    tenant_id, project_id, _ = _setup_admin_project_and_requirement(client, platform_admin)
    case = _create_test_case(client, project_id, "Verify ACV Calculation")
    _enable_ai(client)
    _patch_provider(monkeypatch, FakeProvider())

    client.post(
        "/api/v1/users",
        json={
            "email": "tester@horizon.com",
            "name": "Tester One",
            "role": "tester",
            "password": "TesterPassw0rd!",
        },
    )
    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")

    response = tester_client.post(f"/api/v1/test-cases/{case['id']}/ai-review")
    assert response.status_code == 403, response.text


def test_tester_with_project_membership_can_review_view_level_access(
    client: TestClient, platform_admin: dict, monkeypatch
) -> None:
    """Review reuses view-level access (same as GET /test-cases/{id}), not
    the create/edit permission -- an assigned Tester can request a review
    even though they could also just edit the case themselves."""
    tenant_id, project_id, _ = _setup_admin_project_and_requirement(client, platform_admin)
    case = _create_test_case(client, project_id, "Verify ACV Calculation")
    _enable_ai(client)
    _patch_provider(monkeypatch, FakeProvider())

    tester_id = client.post(
        "/api/v1/users",
        json={
            "email": "tester@horizon.com",
            "name": "Tester One",
            "role": "tester",
            "password": "TesterPassw0rd!",
        },
    ).json()["data"]["id"]
    client.post(f"/api/v1/projects/{project_id}/members", json={"user_id": tester_id})

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")

    response = tester_client.post(f"/api/v1/test-cases/{case['id']}/ai-review")
    assert response.status_code == 200, response.text


# --- Phase 5: Requirement Change Analyzer (GAP-72, third and final AI capability) ---


def test_analyze_change_is_rejected_when_ai_is_not_enabled(
    client: TestClient, platform_admin: dict, monkeypatch
) -> None:
    _, project_id, requirement_id = _setup_admin_project_and_requirement(client, platform_admin)
    case = _create_test_case(client, project_id, "Verify ACV Calculation")
    client.post(
        f"/api/v1/requirements/{requirement_id}/test-cases", json={"test_case_id": case["id"]}
    )
    client.patch(f"/api/v1/requirements/{requirement_id}", json={"description": "v2 text"})
    _patch_provider(monkeypatch, FakeProvider())

    response = client.post(f"/api/v1/requirements/{requirement_id}/analyze-change")
    assert response.status_code == 409, response.text


def test_analyze_change_requires_a_prior_version(
    client: TestClient, platform_admin: dict, monkeypatch
) -> None:
    """A requirement still on version 1 has nothing to compare against."""
    _, project_id, requirement_id = _setup_admin_project_and_requirement(client, platform_admin)
    case = _create_test_case(client, project_id, "Verify ACV Calculation")
    client.post(
        f"/api/v1/requirements/{requirement_id}/test-cases", json={"test_case_id": case["id"]}
    )
    _enable_ai(client)
    _patch_provider(monkeypatch, FakeProvider())

    response = client.post(f"/api/v1/requirements/{requirement_id}/analyze-change")
    assert response.status_code == 409, response.text


def test_analyze_change_returns_findings_and_does_not_mutate_anything(
    client: TestClient, platform_admin: dict, monkeypatch
) -> None:
    _, project_id, requirement_id = _setup_admin_project_and_requirement(client, platform_admin)
    case_a = _create_test_case(client, project_id, "Verify ACV Calculation")
    case_b = _create_test_case(client, project_id, "Verify Unrelated Flow")
    client.post(
        f"/api/v1/requirements/{requirement_id}/test-cases", json={"test_case_id": case_a["id"]}
    )
    client.post(
        f"/api/v1/requirements/{requirement_id}/test-cases", json={"test_case_id": case_b["id"]}
    )
    client.patch(f"/api/v1/requirements/{requirement_id}", json={"description": "v2 text"})
    _enable_ai(client)
    findings = [
        ChangeImpactFinding(index=1, needs_review=True, reason="ACV formula touched"),
        ChangeImpactFinding(index=2, needs_review=False, reason="Unrelated"),
    ]
    provider = _patch_provider(monkeypatch, FakeProvider(findings=findings))

    before_req = client.get(f"/api/v1/requirements/{requirement_id}").json()["data"]
    before_a = client.get(f"/api/v1/test-cases/{case_a['id']}").json()["data"]

    response = client.post(f"/api/v1/requirements/{requirement_id}/analyze-change")
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["old_version_number"] == 1
    assert data["new_version_number"] == 2
    assert len(data["findings"]) == 2
    by_id = {f["test_case_id"]: f for f in data["findings"]}
    assert by_id[case_a["id"]]["needs_review"] is True
    assert by_id[case_b["id"]]["needs_review"] is False
    assert len(provider.change_impact_calls) == 1
    assert provider.change_impact_calls[0]["new_description"] == "v2 text"

    # No-auto-mutation invariant: neither the requirement nor the test case changed.
    after_req = client.get(f"/api/v1/requirements/{requirement_id}").json()["data"]
    after_a = client.get(f"/api/v1/test-cases/{case_a['id']}").json()["data"]
    assert after_req == before_req
    assert after_a == before_a


def test_analyze_change_with_no_linked_test_cases_returns_empty_without_calling_provider(
    client: TestClient, platform_admin: dict, monkeypatch
) -> None:
    _, _, requirement_id = _setup_admin_project_and_requirement(client, platform_admin)
    client.patch(f"/api/v1/requirements/{requirement_id}", json={"description": "v2 text"})
    _enable_ai(client)
    provider = _patch_provider(monkeypatch, FakeProvider())

    response = client.post(f"/api/v1/requirements/{requirement_id}/analyze-change")
    assert response.status_code == 200, response.text
    assert response.json()["data"]["findings"] == []
    assert len(provider.change_impact_calls) == 0


def test_analyze_change_records_usage_including_on_provider_failure(
    client: TestClient, platform_admin: dict, monkeypatch
) -> None:
    _, project_id, requirement_id = _setup_admin_project_and_requirement(client, platform_admin)
    case = _create_test_case(client, project_id, "Verify ACV Calculation")
    client.post(
        f"/api/v1/requirements/{requirement_id}/test-cases", json={"test_case_id": case["id"]}
    )
    client.patch(f"/api/v1/requirements/{requirement_id}", json={"description": "v2 text"})
    _enable_ai(client)
    _patch_provider(monkeypatch, FakeProvider())

    client.post(f"/api/v1/requirements/{requirement_id}/analyze-change")
    usage = client.get("/api/v1/ai/usage").json()["data"]
    assert usage["total_requests"] == 1
    assert usage["successful_requests"] == 1

    _patch_provider(monkeypatch, FakeProvider(raises=True))
    failed = client.post(f"/api/v1/requirements/{requirement_id}/analyze-change")
    assert failed.status_code == 409, failed.text

    usage_after = client.get("/api/v1/ai/usage").json()["data"]
    assert usage_after["total_requests"] == 2
    assert usage_after["successful_requests"] == 1


def test_tester_without_project_membership_cannot_analyze_change(
    client: TestClient, platform_admin: dict, monkeypatch
) -> None:
    tenant_id, project_id, requirement_id = _setup_admin_project_and_requirement(
        client, platform_admin
    )
    case = _create_test_case(client, project_id, "Verify ACV Calculation")
    client.post(
        f"/api/v1/requirements/{requirement_id}/test-cases", json={"test_case_id": case["id"]}
    )
    client.patch(f"/api/v1/requirements/{requirement_id}", json={"description": "v2 text"})
    _enable_ai(client)
    _patch_provider(monkeypatch, FakeProvider())

    client.post(
        "/api/v1/users",
        json={
            "email": "tester@horizon.com",
            "name": "Tester One",
            "role": "tester",
            "password": "TesterPassw0rd!",
        },
    )
    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")

    response = tester_client.post(f"/api/v1/requirements/{requirement_id}/analyze-change")
    assert response.status_code == 403, response.text
