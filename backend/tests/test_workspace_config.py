"""ADR-125: tenant workspace defaults (sidebar entries, project tabs, list view modes).

Covers validation, who may read / replace them, the audit trail, the "reset stores nothing"
rule and tenant isolation.
"""

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import text

from app.schemas.workspace import SidebarConfig
from app.services import workspace_service
from tests.test_tester_visibility import _as, _setup

API = "/api/v1"
URL = f"{API}/settings/workspace"

DEFAULTS = {
    "sidebar": {"order": [], "hidden": []},
    "project_tabs": {"order": [], "hidden": []},
    "view_modes": {},
}


@pytest.fixture
def ws(client: TestClient, platform_admin: dict) -> dict:
    return _setup(client, platform_admin, "Workspace Cfg")


def _put(client: TestClient, body: object):
    return client.put(URL, json=body)


def test_unset_returns_the_built_in_defaults(client: TestClient, ws: dict) -> None:
    got = client.get(URL)
    assert got.status_code == 200, got.text
    assert got.json()["data"] == DEFAULTS


def test_round_trip_and_reset_stores_null(client: TestClient, ws: dict, owner_engine) -> None:
    config = {
        "sidebar": {"order": ["defects", "home"], "hidden": ["test-cases", "reports"]},
        "project_tabs": {"order": ["overview", "defects"], "hidden": ["releases"]},
        "view_modes": {"defects": ["list"], "test_runs": ["list", "calendar"]},
    }
    saved = _put(client, config)
    assert saved.status_code == 200, saved.text
    assert saved.json()["data"] == config
    assert client.get(URL).json()["data"] == config
    # An empty body is the defaults and is stored as NULL, not as an empty document.
    assert _put(client, {}).json()["data"] == DEFAULTS
    with owner_engine.begin() as conn:
        raw = conn.execute(
            text("SELECT workspace_config FROM tenants WHERE id = :t"), {"t": ws["tenant_id"]}
        ).scalar_one()
    assert raw is None


@pytest.mark.parametrize(
    "body",
    [
        {"sidebar": {"hidden": ["home"]}},  # core entries can never be hidden
        {"sidebar": {"hidden": ["projects"]}},
        {"sidebar": {"hidden": ["my-work"]}},
        {"sidebar": {"hidden": ["admin"]}},
        {"sidebar": {"order": ["calendar"]}},  # unknown (and never offered) entry
        {"sidebar": {"hidden": ["documents"]}},
        {"sidebar": {"order": ["home", "home"]}},  # duplicates
        {"sidebar": {"hidden": ["defects", "defects"]}},
        {"sidebar": {"hidden": ["Defects"]}},  # case-sensitive
        {"project_tabs": {"hidden": ["overview"]}},  # core project tabs (Phase 3 rule)
        {"project_tabs": {"hidden": ["settings"]}},
        {"project_tabs": {"hidden": ["documents"]}},
        {"project_tabs": {"order": ["team", "team"]}},
        {"view_modes": {"defects": ["board"]}},  # list is always available
        {"view_modes": {"defects": []}},
        {"view_modes": {"defects": ["list", "calendar"]}},  # defects offers no calendar
        {"view_modes": {"test_cases": ["list", "calendar"]}},
        {"view_modes": {"projects": ["list"]}},  # unknown list
        {"view_modes": {"test_runs": ["list", "list"]}},
        {"view_modes": {"test_runs": ["list", "gantt"]}},
        {"surprise": True},  # unknown top-level key
        {"sidebar": {"order": [], "extra": 1}},  # unknown key inside a section
    ],
)
def test_invalid_configs_are_rejected_and_store_nothing(
    client: TestClient, ws: dict, body: object
) -> None:
    assert _put(client, body).status_code == 422, body
    assert client.get(URL).json()["data"] == DEFAULTS


def test_replace_is_audited_with_before_and_after(
    client: TestClient, ws: dict, owner_engine
) -> None:
    assert _put(client, {"sidebar": {"hidden": ["defects"]}}).status_code == 200
    # Saving the same document again is not a change and writes no second entry.
    assert _put(client, {"sidebar": {"hidden": ["defects"]}}).status_code == 200
    with owner_engine.begin() as conn:
        rows = conn.execute(
            text(
                "SELECT metadata FROM audit_logs WHERE action = 'tenant.workspace_updated' "
                "AND tenant_id = :t"
            ),
            {"t": ws["tenant_id"]},
        ).all()
    assert len(rows) == 1
    meta = rows[0][0]
    assert meta["from"] == DEFAULTS
    assert meta["to"]["sidebar"]["hidden"] == ["defects"]


def test_a_stale_stored_document_falls_back_to_defaults(
    client: TestClient, ws: dict, owner_engine
) -> None:
    """A value that no longer validates (for example a removed entry) must not break the shell."""
    with owner_engine.begin() as conn:
        conn.execute(
            text("UPDATE tenants SET workspace_config = CAST(:v AS jsonb) WHERE id = :t"),
            {"v": '{"sidebar": {"hidden": ["home"]}}', "t": ws["tenant_id"]},
        )
    assert client.get(URL).json()["data"] == DEFAULTS


def test_requires_a_session(client: TestClient, ws: dict) -> None:
    client.cookies.clear()
    assert client.get(URL).status_code == 401
    assert _put(client, {}).status_code == 401


def test_other_tenants_never_see_or_change_the_config(
    client: TestClient, platform_admin: dict, ws: dict
) -> None:
    config = {"sidebar": {"hidden": ["reports"]}}
    assert _put(client, config).status_code == 200
    other_client = TestClient(client.app)
    other = _setup(other_client, platform_admin, "Workspace Other")
    assert other["tenant_id"] != ws["tenant_id"]
    assert other_client.get(URL).json()["data"] == DEFAULTS
    assert _put(other_client, {"view_modes": {"defects": ["list"]}}).status_code == 200
    # The first tenant still has exactly its own document.
    got = client.get(URL).json()["data"]
    assert got["sidebar"]["hidden"] == ["reports"] and got["view_modes"] == {}
    _as(other_client, other, "tester")
    assert other_client.get(URL).json()["data"]["view_modes"] == {"defects": ["list"]}


def test_a_layout_saved_with_the_old_group_ids_keeps_its_meaning() -> None:
    saved = {
        "sidebar": {
            "order": ["defects", "test-execution", "home", "test-management"],
            "hidden": ["test-management"],
        },
        "view_modes": {"defects": ["list"]},
    }
    config = workspace_service._load(saved)
    assert config.sidebar.order == ["defects", "test-runs", "home", "test-cases"]
    assert config.sidebar.hidden == ["test-cases"]
    # The rest of the document survives with it.
    assert config.view_modes == {"defects": ["list"]}


def test_old_and_new_ids_together_collapse_but_other_repeats_are_refused() -> None:
    config = SidebarConfig.model_validate(
        {"order": ["test-runs", "test-execution", "home"], "hidden": []}
    )
    assert config.order == ["test-runs", "home"]
    with pytest.raises(ValidationError):
        SidebarConfig.model_validate({"order": ["home", "home"], "hidden": []})
