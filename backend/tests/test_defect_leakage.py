"""ADR-097: defect leakage and test effectiveness report."""

from fastapi.testclient import TestClient
from sqlalchemy import text

from tests.test_project_role_scoping import (
    _bootstrap_tenant,
    _create_project,
    _create_user,
    _login_and_verify,
)

ADMIN_PW = "AdminPassw0rd!"
USER_PW = "UserPassw0rd!!"


def _defect(client: TestClient, project_id: str, title: str, severity: str, **extra) -> str:
    r = client.post(
        "/api/v1/defects",
        json={"project_id": project_id, "title": title, "severity": severity, **extra},
    )
    assert r.status_code == 200, r.text
    return r.json()["data"]["id"]


def _setup(client: TestClient, platform_admin: dict, owner_engine, name: str) -> dict:
    slug = name.lower().replace(" ", "")
    boot = _bootstrap_tenant(client, platform_admin, name)
    tenant_id = boot["tenant"]["id"]
    admin_email = f"admin@{slug}.example.com"
    _login_and_verify(client, tenant_id, admin_email, ADMIN_PW)
    project = _create_project(client, f"{name} Claims")
    pid = project["id"]
    other = _create_project(client, f"{name} Other")

    released = client.post(
        f"/api/v1/projects/{pid}/releases", json={"name": "R1", "release_date": "2020-01-01"}
    ).json()["data"]
    future = client.post(
        f"/api/v1/projects/{pid}/releases", json={"name": "R2", "release_date": "2099-01-01"}
    ).json()["data"]
    prod = client.post("/api/v1/environments", json={"name": "Production"}).json()["data"]
    staging = client.post("/api/v1/environments", json={"name": "Staging"}).json()["data"]

    d1 = _defect(client, pid, "Defect one high", "High")
    d2 = _defect(client, pid, "Defect two low", "Low")
    d3 = _defect(client, pid, "Defect three crit", "Critical", environment_id=prod["id"])
    _defect(client, pid, "Defect four med", "Medium", environment="PROD")
    d5 = _defect(client, pid, "Defect five med", "Medium")
    d6 = _defect(client, pid, "Defect six low", "Low", environment_id=staging["id"])
    for d, rel in ((d1, released), (d2, released), (d5, future)):
        r = client.patch(
            f"/api/v1/defects/{d}/build-release", json={"fixed_in_release_id": rel["id"]}
        )
        assert r.status_code == 200, r.text
    with owner_engine.begin() as conn:
        conn.execute(
            text("UPDATE defects SET created_at = now() - interval '20 days' WHERE id = :i"),
            {"i": d2},
        )
        conn.execute(
            text("UPDATE defects SET created_at = now() - interval '40 days' WHERE id = :i"),
            {"i": d3},
        )
    return {
        "tenant_id": tenant_id,
        "admin_email": admin_email,
        "project_id": pid,
        "other_project_id": other["id"],
        "released_id": released["id"],
        "future_id": future["id"],
        "slug": slug,
        "d6": d6,
    }


def test_known_fixture_counts(client: TestClient, platform_admin: dict, owner_engine) -> None:
    s = _setup(client, platform_admin, owner_engine, "Leak Counts")
    r = client.get("/api/v1/reports/defect-leakage", params={"project_id": s["project_id"]})
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    assert d["total_defects"] == 6
    assert d["escaped_defects"] == 4
    assert d["leakage_percentage"] == 66.7
    assert d["detection_effectiveness_percentage"] == 33.3
    assert d["open_escaped_defects"] == 4
    assert d["open_escaped_age_buckets"] == {"under_7d": 2, "d7_to_30": 1, "over_30d": 1}
    assert d["escaped_by_severity"] == {"High": 1, "Low": 1, "Critical": 1, "Medium": 1}
    rows = {x["release_name"]: x for x in d["releases"]}
    assert rows["R1"]["escaped_defects"] == 2 and rows["R1"]["leakage_percentage"] == 100.0
    assert rows["R1"]["detection_effectiveness_percentage"] == 0.0
    assert rows["R2"]["total_defects"] == 1 and rows["R2"]["escaped_defects"] == 0
    assert rows["No release"]["total_defects"] == 3 and rows["No release"]["escaped_defects"] == 2
    assert d["quarantined_test_cases"] == 0
    assert sum(p["total_defects"] for p in d["trend"]) == 6


def test_zero_defects_is_null_not_error(
    client: TestClient, platform_admin: dict, owner_engine
) -> None:
    s = _setup(client, platform_admin, owner_engine, "Leak Empty")
    r = client.get("/api/v1/reports/defect-leakage", params={"project_id": s["other_project_id"]})
    d = r.json()["data"]
    assert d["total_defects"] == 0
    assert d["leakage_percentage"] is None
    assert d["detection_effectiveness_percentage"] is None
    assert d["releases"] == [] and d["trend"] == []


def test_date_range_and_project_scope(
    client: TestClient, platform_admin: dict, owner_engine
) -> None:
    s = _setup(client, platform_admin, owner_engine, "Leak Range")
    future = client.get("/api/v1/reports/defect-leakage", params={"date_from": "2099-01-01"})
    assert future.json()["data"]["total_defects"] == 0
    everything = client.get("/api/v1/reports/defect-leakage").json()["data"]
    assert everything["total_defects"] == 6
    other = client.get(
        "/api/v1/reports/defect-leakage", params={"project_id": s["other_project_id"]}
    ).json()["data"]
    assert other["total_defects"] == 0
    bad = client.get("/api/v1/reports/defect-leakage", params={"project_id": "not-a-uuid"})
    assert bad.status_code == 422


def test_tester_scope_and_hidden(client: TestClient, platform_admin: dict, owner_engine) -> None:
    s = _setup(client, platform_admin, owner_engine, "Leak Tester")
    _create_user(client, f"tester@{s['slug']}.example.com", "Tess", "tester", USER_PW)
    _login_and_verify(client, s["tenant_id"], f"tester@{s['slug']}.example.com", USER_PW)
    # Not a member of any project: sees nothing and cannot ask for a project.
    assert client.get("/api/v1/reports/defect-leakage").json()["data"]["total_defects"] == 0
    r = client.get("/api/v1/reports/defect-leakage", params={"project_id": s["project_id"]})
    assert r.status_code == 403
    _login_and_verify(client, s["tenant_id"], s["admin_email"], ADMIN_PW)
    assert (
        client.patch("/api/v1/settings", json={"reports_hidden_from_testers": True}).status_code
        == 200
    )
    _login_and_verify(client, s["tenant_id"], f"tester@{s['slug']}.example.com", USER_PW)
    assert client.get("/api/v1/reports/defect-leakage").status_code == 403
    assert client.get("/api/v1/reports/defect-leakage/export.xlsx").status_code == 403


def test_export_xlsx(client: TestClient, platform_admin: dict, owner_engine) -> None:
    s = _setup(client, platform_admin, owner_engine, "Leak Export")
    r = client.get(
        "/api/v1/reports/defect-leakage/export.xlsx", params={"project_id": s["project_id"]}
    )
    assert r.status_code == 200
    assert r.content[:2] == b"PK"
    assert "spreadsheetml" in r.headers["content-type"]
