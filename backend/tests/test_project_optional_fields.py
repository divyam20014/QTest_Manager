"""ADR-139 (Phase 1A, finding F-07): a project needs only a name, and the list of
domains belongs to the organization."""

import pytest
from fastapi.testclient import TestClient

from tests.test_execution import _bootstrap_tenant, _create_project, _login_and_verify

API = "/api/v1"
INSURANCE = ["Motor", "Health", "Travel", "Life", "Property"]
OPTIONAL = ("domain", "manager_name", "start_date", "end_date", "budget", "region")


def _setup(client: TestClient, platform_admin: dict) -> None:
    tenant_id = _bootstrap_tenant(client, platform_admin)["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")


def _ok(response):
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _name_only(client: TestClient, name: str = "Mobile app") -> dict:
    return _ok(client.post(f"{API}/projects", json={"name": name}))


def test_a_project_needs_only_a_name(client: TestClient, platform_admin: dict) -> None:
    _setup(client, platform_admin)

    project = _name_only(client)

    for field in OPTIONAL:
        assert project[field] is None, field
    assert (project["priority"], project["status"]) == ("Medium", "On Track")
    assert project["currency_code"]
    assert _ok(client.get(f"{API}/projects/{project['id']}"))["name"] == "Mobile app"
    assert [p["name"] for p in _ok(client.get(f"{API}/projects"))["items"]] == ["Mobile app"]


def test_blank_text_means_not_set_and_a_value_can_be_cleared(
    client: TestClient, platform_admin: dict
) -> None:
    _setup(client, platform_admin)
    blank = _ok(
        client.post(
            f"{API}/projects",
            json={"name": "Blank values", "manager_name": "  ", "region": "", "domain": ""},
        )
    )
    assert (blank["manager_name"], blank["region"], blank["domain"]) == (None, None, None)

    full = _create_project(client, "Filled in")
    cleared = _ok(client.patch(f"{API}/projects/{full['id']}", json=dict.fromkeys(OPTIONAL)))
    for field in OPTIONAL:
        assert cleared[field] is None, field


@pytest.mark.parametrize("field", ["name", "priority", "status", "currency_code"])
def test_required_fields_cannot_be_cleared(
    client: TestClient, platform_admin: dict, field: str
) -> None:
    _setup(client, platform_admin)
    project = _name_only(client)
    response = client.patch(f"{API}/projects/{project['id']}", json={field: None})
    assert response.status_code == 422, response.text


def test_dates_are_checked_only_against_each_other(
    client: TestClient, platform_admin: dict
) -> None:
    _setup(client, platform_admin)
    only_end = _ok(
        client.post(f"{API}/projects", json={"name": "Ends only", "end_date": "2026-01-01"})
    )
    assert only_end["start_date"] is None
    bad = client.patch(f"{API}/projects/{only_end['id']}", json={"start_date": "2026-06-01"})
    assert bad.status_code in (409, 422), bad.text
    both = {"name": "Backwards", "start_date": "2026-06-01", "end_date": "2026-01-01"}
    assert client.post(f"{API}/projects", json=both).status_code == 422


def test_sorting_puts_projects_without_a_value_last(
    client: TestClient, platform_admin: dict
) -> None:
    _setup(client, platform_admin)
    _create_project(client, "With budget")
    _name_only(client, "No budget")
    for sort in ("budget", "-budget", "end_date", "-start_date"):
        items = _ok(client.get(f"{API}/projects", params={"sort": sort}))["items"]
        assert [p["name"] for p in items] == ["With budget", "No budget"], sort


# --- the organization's list of domains ----------------------------------------------------


def _domains(client: TestClient) -> list[str]:
    return _ok(client.get(f"{API}/settings/branding"))["project_domains"]


def _set_domains(client: TestClient, domains):
    return client.patch(f"{API}/settings", json={"project_domains": domains})


def test_existing_organizations_keep_the_insurance_domains(
    client: TestClient, platform_admin: dict
) -> None:
    _setup(client, platform_admin)
    assert _domains(client) == INSURANCE
    unknown = client.post(f"{API}/projects", json={"name": "Wrong", "domain": "Fintech"})
    assert unknown.status_code == 422, unknown.text
    assert "domain" in unknown.json()["error"]["fields"]


def test_an_admin_can_replace_the_list_and_old_projects_keep_their_domain(
    client: TestClient, platform_admin: dict
) -> None:
    _setup(client, platform_admin)
    motor = _create_project(client, "Claims")

    _ok(_set_domains(client, [" Fintech ", "Retail", "fintech"]))

    assert _domains(client) == ["Fintech", "Retail"]
    assert _ok(client.post(f"{API}/projects", json={"name": "Pay", "domain": "Fintech"}))
    # A project's own domain stays valid when it is saved again unchanged.
    same = _ok(
        client.patch(f"{API}/projects/{motor['id']}", json={"domain": "Motor", "name": "Claims 2"})
    )
    assert same["domain"] == "Motor"
    assert (
        client.post(f"{API}/projects", json={"name": "New", "domain": "Motor"}).status_code == 422
    )

    # null goes back to the built-in list; an empty list means no domains at all.
    _ok(_set_domains(client, []))
    assert _domains(client) == []
    _ok(_set_domains(client, None))
    assert _domains(client) == INSURANCE


@pytest.mark.parametrize(
    "domains", [["x" * 61], ["", "Retail"], [f"D{i}" for i in range(31)], ["No domain"]]
)
def test_bad_domain_lists_are_refused(
    client: TestClient, platform_admin: dict, domains: list[str]
) -> None:
    _setup(client, platform_admin)
    assert _set_domains(client, domains).status_code == 422


# --- reports with missing values -----------------------------------------------------------


def test_reports_handle_projects_without_a_domain_or_budget(
    client: TestClient, platform_admin: dict
) -> None:
    _setup(client, platform_admin)
    plain = _name_only(client)
    _ok(
        client.post(
            f"{API}/projects/{plain['id']}/test-cases",
            json={
                "title": "Case in a plain project",
                "priority": "Low",
                "steps": [{"action": "Open", "expected": "Opens"}],
            },
        )
    )

    distribution = _ok(client.get(f"{API}/dashboard/domain-distribution"))
    by_domain = {d["domain"]: d for d in distribution}
    assert list(by_domain) == INSURANCE + ["No domain"]
    assert by_domain["No domain"]["project_count"] == 1
    assert by_domain["No domain"]["test_case_count"] == 1

    grouped = client.get(
        f"{API}/reports/aggregate", params={"metric": "priority", "group_by": "domain"}
    )
    assert "No domain" in grouped.text and grouped.status_code == 200, grouped.text

    for path in (
        "compliance-detail",
        "compliance-detail/pdf",
        "compliance-export",
        "compliance-export.xlsx",
    ):
        exported = client.get(f"{API}/reports/{path}")
        assert exported.status_code == 200, (path, exported.text[:300])


def test_domain_distribution_without_projects_that_lack_a_domain_is_unchanged(
    client: TestClient, platform_admin: dict
) -> None:
    _setup(client, platform_admin)
    _create_project(client, "Claims")
    distribution = _ok(client.get(f"{API}/dashboard/domain-distribution"))
    assert [d["domain"] for d in distribution] == INSURANCE


def test_dates_money_and_the_manager_account_can_be_saved(
    client: TestClient, platform_admin: dict
) -> None:
    """Each of these answered 500: the audit entry could not hold the value. The settings
    screen sends all of them on every save."""
    _setup(client, platform_admin)
    project = _create_project(client, "Edited")
    me = _ok(client.get(f"{API}/auth/me"))["user_id"]
    changes = {
        "start_date": "2026-02-01",
        "end_date": "2026-11-01",
        "budget": "10.50",
        "manager_user_id": me,
    }

    saved = _ok(
        client.patch(
            f"{API}/projects/{project['id']}",
            json={**changes, "expected_version": project["version"]},
        )
    )

    for field, value in changes.items():
        assert saved[field] == value, field
    events = _ok(client.get(f"{API}/audit-logs", params={"page_size": 50}))
    assert any(e["action"] == "project.updated" for e in events)
