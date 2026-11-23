"""ADR-115 step 1: display-id counters, the field-standard migration, constraints.

Covers: sequential TC_/BUG_ ids on create, per-tenant isolation and RLS on
`entity_counters`, bulk range reservation (service and CSV import), uniqueness
under concurrent allocation, immutability, the widened defect status CHECK
(new + legacy codes), the reserved custom-field keys guard, and the migration
itself (up/down/up on a scratch database, backfill correctness).
"""

import io
import os
import subprocess
import sys
import threading
import uuid
from pathlib import Path

import psycopg
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.core.field_standards import (
    ALLOWED_TRANSITIONS,
    DEFECT_STATUSES,
    RESOLUTION_RULES,
    RESOLUTIONS,
    resolution_error,
)

BACKEND_ROOT = Path(__file__).resolve().parent.parent
PASSWORD = "AdminPassw0rd!"


def _bootstrap(client: TestClient, platform_admin: dict, name: str, email: str) -> dict:
    response = client.post(
        "/api/v1/platform/tenants",
        headers=platform_admin["headers"],
        json={
            "tenant_name": name,
            "admin_name": "Admin",
            "admin_email": email,
            "admin_password": PASSWORD,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _login(client: TestClient, tenant_id: str, email: str) -> None:
    login = client.post(
        "/api/v1/auth/login", json={"tenant_id": tenant_id, "email": email, "password": PASSWORD}
    )
    assert login.status_code == 200, login.text
    verify = client.post(
        "/api/v1/auth/mfa/verify", json={"code": login.json()["data"]["debug_code"]}
    )
    assert verify.status_code == 200, verify.text


def _project(client: TestClient, name: str = "Display Id Project") -> dict:
    response = client.post(
        "/api/v1/projects",
        json={
            "name": name,
            "domain": "Motor",
            "priority": "High",
            "manager_name": "Jane Manager",
            "start_date": "2026-01-01",
            "end_date": "2026-12-31",
            "budget": "1000.00",
            "region": "North America",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _case(client: TestClient, project_id: str, title: str) -> dict:
    response = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={
            "title": title,
            "priority": "High",
            "steps": [{"action": "Do it", "expected": "It works"}],
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _defect(client: TestClient, project_id: str, title: str) -> dict:
    response = client.post(
        "/api/v1/defects",
        json={"project_id": project_id, "title": title, "severity": "High"},
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _tenant_with_project(client, platform_admin, name="Horizon", email="admin@horizon.com"):
    data = _bootstrap(client, platform_admin, name, email)
    tenant_id = data["tenant"]["id"]
    _login(client, tenant_id, email)
    return tenant_id, _project(client)


# --- sequential ids / API -------------------------------------------------------


def test_created_cases_and_defects_get_sequential_display_ids(client, platform_admin) -> None:
    _, project = _tenant_with_project(client, platform_admin)
    first = _case(client, project["id"], "First display case")
    second = _case(client, project["id"], "Second display case")
    assert first["display_id"] == "TC_000001"
    assert second["display_id"] == "TC_000002"
    d1 = _defect(client, project["id"], "First display defect")
    d2 = _defect(client, project["id"], "Second display defect")
    assert (d1["display_id"], d2["display_id"]) == ("BUG_000001", "BUG_000002")
    # Counters are independent per kind, and reads expose the id too.
    fetched = client.get(f"/api/v1/test-cases/{first['id']}").json()["data"]
    assert fetched["display_id"] == "TC_000001"
    assert fetched["automation_status"] == "Manual"


def test_display_id_is_immutable(client, platform_admin, owner_engine) -> None:
    _, project = _tenant_with_project(client, platform_admin)
    case = _case(client, project["id"], "Immutable id case")
    defect = _defect(client, project["id"], "Immutable id defect")

    # ADR-116: a different display_id in a PATCH is refused; the same value is tolerated.
    patched = client.patch(
        f"/api/v1/test-cases/{case['id']}",
        json={"title": "Immutable id case renamed", "display_id": "TC_999999"},
    )
    assert patched.status_code == 422, patched.text
    patched = client.patch(
        f"/api/v1/test-cases/{case['id']}",
        json={"title": "Immutable id case renamed", "display_id": "TC_000001"},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["data"]["display_id"] == "TC_000001"
    patched = client.patch(
        f"/api/v1/defects/{defect['id']}",
        json={"title": "Immutable id defect renamed", "display_id": "BUG_999999"},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["data"]["display_id"] == "BUG_000001"

    # The database refuses it as well, even for the table owner.
    for table in ("test_cases", "defects"):
        with owner_engine.connect() as conn, pytest.raises((IntegrityError, DBAPIError)):
            conn.execute(text(f"UPDATE {table} SET display_id = 'X_000009'"))
        with owner_engine.connect() as conn, pytest.raises((IntegrityError, DBAPIError)):
            conn.execute(text(f"UPDATE {table} SET display_seq = 99"))


def test_ids_are_per_tenant(client, platform_admin) -> None:
    _, project_a = _tenant_with_project(client, platform_admin, "Tenant A", "a@a.com")
    _case(client, project_a["id"], "Tenant A case one")
    _case(client, project_a["id"], "Tenant A case two")

    _, project_b = _tenant_with_project(client, platform_admin, "Tenant B", "b@b.com")
    first_b = _case(client, project_b["id"], "Tenant B case one")
    assert first_b["display_id"] == "TC_000001"


def test_csv_import_reserves_a_contiguous_range(client, platform_admin) -> None:
    _, project = _tenant_with_project(client, platform_admin)
    _case(client, project["id"], "Existing display case")
    header = (
        "Title,Module,Sub Module,Project Name,Priority,Status,Description,"
        "Scenario Id,Scenario Description,Prerequisite,Test Data,Assignee Email,Steps\n"
    )
    rows = "".join(
        f'"Imported case {i}","Claims","","{project["name"]}","High","Draft",'
        f'"A functional description for case {i}.","","","","","","Do it|Works"\n'
        for i in range(4)
    )
    files = {"file": ("import.csv", io.BytesIO((header + rows).encode()), "text/csv")}
    report = client.post("/api/v1/test-cases/import", files=files).json()["data"]
    assert report["created_count"] == 4, report

    listing = client.get(f"/api/v1/projects/{project['id']}/test-cases?page_size=50")
    ids = sorted(c["display_id"] for c in listing.json()["data"]["items"])
    assert ids == [f"TC_{n:06d}" for n in range(1, 6)]

    # Defect import reserves from the BUG counter independently.
    dheader = (
        "Title,Project Name,Severity,Priority,Description,Steps to Reproduce,"
        "Expected Result,Actual Result,Environment,Module,Assignee Email\n"
    )
    drows = "".join(
        f'"Imported defect {i}","{project["name"]}","High","Medium","Describes defect {i}",'
        f'"","","","","",""\n'
        for i in range(3)
    )
    files = {"file": ("d.csv", io.BytesIO((dheader + drows).encode()), "text/csv")}
    report = client.post("/api/v1/defects/import", files=files).json()["data"]
    assert report["created_count"] == 3, report
    defects = client.get("/api/v1/defects?page_size=50").json()["data"]["items"]
    assert sorted(d["display_id"] for d in defects) == [f"BUG_{n:06d}" for n in range(1, 4)]


# --- service level: ranges, concurrency, RLS --------------------------------------


def _tenant_uuid(data: dict) -> uuid.UUID:
    return uuid.UUID(data["tenant"]["id"])


def test_bulk_range_reservation_and_rls(client, platform_admin, db_session) -> None:
    from app.core.db import set_tenant_context
    from app.services import display_id_service

    a = _bootstrap(client, platform_admin, "Tenant A", "a@a.com")
    b = _bootstrap(client, platform_admin, "Tenant B", "b@b.com")
    tenant_a, tenant_b = _tenant_uuid(a), _tenant_uuid(b)

    set_tenant_context(db_session, str(tenant_a))
    batch = display_id_service.next_display_ids(db_session, tenant_a, "test_case", 5)
    assert [s for s, _ in batch] == [1, 2, 3, 4, 5]
    assert batch[0][1] == "TC_000001" and batch[-1][1] == "TC_000005"
    assert display_id_service.next_display_id(db_session, tenant_a, "test_case") == (6, "TC_000006")
    assert display_id_service.next_display_id(db_session, tenant_a, "defect") == (1, "BUG_000001")
    db_session.commit()

    # Another tenant starts from one and never sees tenant A's counters.
    set_tenant_context(db_session, str(tenant_b))
    assert display_id_service.next_display_id(db_session, tenant_b, "test_case") == (1, "TC_000001")
    visible = db_session.execute(text("SELECT DISTINCT tenant_id FROM entity_counters")).all()
    assert [str(r[0]) for r in visible] == [str(tenant_b)]
    # WITH CHECK: writing another tenant's counter is refused.
    with pytest.raises((IntegrityError, DBAPIError)):
        db_session.execute(
            text(
                "INSERT INTO entity_counters (tenant_id, kind, next_value) VALUES (:t, 'defect', 9)"
            ),
            {"t": tenant_a},
        )
    db_session.rollback()

    with pytest.raises(ValueError):
        display_id_service.reserve_range(db_session, tenant_b, "test_case", 0)
    with pytest.raises(ValueError):
        display_id_service.reserve_range(db_session, tenant_b, "bogus", 1)


def test_rollback_returns_the_numbers(client, platform_admin, db_session) -> None:
    from app.core.db import set_tenant_context
    from app.services import display_id_service

    tenant = _tenant_uuid(_bootstrap(client, platform_admin, "Tenant A", "a@a.com"))
    set_tenant_context(db_session, str(tenant))
    assert display_id_service.next_display_ids(db_session, tenant, "defect", 3)[0][0] == 1
    db_session.rollback()
    set_tenant_context(db_session, str(tenant))
    assert display_id_service.next_display_id(db_session, tenant, "defect")[0] == 1


def test_concurrent_allocation_never_collides(client, platform_admin) -> None:
    from app.core.db import SessionLocal, set_tenant_context
    from app.services import display_id_service

    tenant = _tenant_uuid(_bootstrap(client, platform_admin, "Tenant A", "a@a.com"))
    workers, loops, per_call = 6, 5, 3
    seen: list[int] = []
    errors: list[BaseException] = []
    lock = threading.Lock()
    barrier = threading.Barrier(workers)

    def work() -> None:
        try:
            barrier.wait()
            for _ in range(loops):
                session = SessionLocal()
                try:
                    set_tenant_context(session, str(tenant))
                    got = display_id_service.next_display_ids(
                        session, tenant, "test_case", per_call
                    )
                    session.commit()
                finally:
                    session.close()
                with lock:
                    seen.extend(seq for seq, _ in got)
        except BaseException as exc:  # noqa: BLE001 - surfaced below
            errors.append(exc)

    threads = [threading.Thread(target=work) for _ in range(workers)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors, errors
    total = workers * loops * per_call
    assert len(seen) == total
    assert sorted(seen) == list(range(1, total + 1))  # unique and gap-free


# --- constraints --------------------------------------------------------------------


def test_defect_status_check_accepts_new_and_legacy_codes(
    client, platform_admin, owner_engine
) -> None:
    _, project = _tenant_with_project(client, platform_admin)
    defect = _defect(client, project["id"], "Status check defect")
    assert len(DEFECT_STATUSES) == 11
    for status in DEFECT_STATUSES:
        with owner_engine.begin() as conn:
            conn.execute(
                text("UPDATE defects SET status = :s WHERE id = :id"),
                {"s": status, "id": defect["id"]},
            )
    fetched = client.get(f"/api/v1/defects/{defect['id']}").json()["data"]
    assert fetched["status"] == "Verified"  # last one written; Out model accepts all 11
    with owner_engine.connect() as conn, pytest.raises(IntegrityError):
        conn.execute(
            text("UPDATE defects SET status = 'Bogus' WHERE id = :id"), {"id": defect["id"]}
        )
    with owner_engine.connect() as conn, pytest.raises(IntegrityError):
        conn.execute(
            text("UPDATE defects SET resolution = 'Nope' WHERE id = :id"), {"id": defect["id"]}
        )
    with owner_engine.begin() as conn:
        conn.execute(
            text("UPDATE defects SET resolution = 'Won''t Fix' WHERE id = :id"),
            {"id": defect["id"]},
        )


def test_run_type_check_allows_retest(client, platform_admin, owner_engine) -> None:
    _, project = _tenant_with_project(client, platform_admin)
    case = _case(client, project["id"], "Retest run case")
    client.post(f"/api/v1/test-cases/{case['id']}/submit-review")
    assert client.post(f"/api/v1/test-cases/{case['id']}/approve").status_code == 200
    run = client.post(
        f"/api/v1/projects/{project['id']}/test-runs",
        json={"name": "Retest candidate", "run_type": "Smoke", "test_case_ids": [case["id"]]},
    ).json()["data"]
    with owner_engine.begin() as conn:
        conn.execute(
            text("UPDATE test_runs SET run_type = 'Retest' WHERE id = :id"), {"id": run["id"]}
        )
    fetched = client.get(f"/api/v1/test-runs/{run['id']}")
    assert fetched.status_code == 200 and fetched.json()["data"]["run_type"] == "Retest"
    # ADR-118: selectable through the API now.
    ok = client.post(
        f"/api/v1/projects/{project['id']}/test-runs",
        json={"name": "Retest via api", "run_type": "Retest", "test_case_ids": [case["id"]]},
    )
    assert ok.status_code == 200 and ok.json()["data"]["run_type"] == "Retest"


def test_new_tenants_get_the_standard_option_sets(client, platform_admin) -> None:
    _tenant_with_project(client, platform_admin)
    for key, expected in (
        ("test_type", {"Functional", "UI", "End-to-End", "API"}),
        ("test_case_severity", {"Critical", "Major", "Minor"}),
        ("defect_severity", {"Low", "Medium", "High", "Critical", "Major", "Minor"}),
        ("test_case_priority", {"Low", "Medium", "High", "Critical"}),
    ):
        response = client.get(f"/api/v1/field-options?field_key={key}")
        assert response.status_code == 200, response.text
        codes = {o["code"] for o in response.json()["data"]}
        assert expected <= codes, (key, codes)


def test_reserved_custom_field_keys_are_refused(client, platform_admin) -> None:
    _tenant_with_project(client, platform_admin)
    for entity, key in (("test_case", "test_type"), ("defect", "resolution"), ("defect", "labels")):
        response = client.post(
            "/api/v1/custom-fields/definitions",
            json={"entity_type": entity, "field_key": key, "label": "Clash", "field_type": "text"},
        )
        assert response.status_code == 422, (entity, key, response.text)
    ok = client.post(
        "/api/v1/custom-fields/definitions",
        json={
            "entity_type": "defect",
            "field_key": "customer_ref",
            "label": "Ref",
            "field_type": "text",
        },
    )
    assert ok.status_code == 200, ok.text


def test_clash_scan_reports_pre_existing_definitions(client, platform_admin, owner_engine) -> None:
    from scripts.custom_field_clash_scan import find_clashes

    data = _bootstrap(client, platform_admin, "Scan Tenant", "scan@scan.com")
    with owner_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO custom_field_definitions (tenant_id, entity_type, field_key, label, "
                "field_type) VALUES (:t, 'test_case', 'severity', 'Sev', 'text'), "
                "(:t, 'test_case', 'fine_key', 'Fine', 'text')"
            ),
            {"t": data["tenant"]["id"]},
        )
    with owner_engine.connect() as conn:
        clashes = find_clashes(conn)
    assert [(c["entity_type"], c["field_key"]) for c in clashes] == [("test_case", "severity")]


# --- pure data ---------------------------------------------------------------------


def test_transition_and_resolution_tables_are_consistent() -> None:
    assert set(ALLOWED_TRANSITIONS) <= set(DEFECT_STATUSES)
    for source, targets in ALLOWED_TRANSITIONS.items():
        assert targets <= set(DEFECT_STATUSES), source
        assert source not in targets
    assert set(RESOLUTION_RULES) == set(DEFECT_STATUSES)
    # Legacy sequence New -> Open -> Fixed -> Verified -> Closed stays walkable.
    for a, b in (("New", "Open"), ("Open", "Fixed"), ("Fixed", "Verified"), ("Verified", "Closed")):
        assert b in ALLOWED_TRANSITIONS[a]
    assert resolution_error("Fixed", "Fixed") is None
    assert resolution_error("Fixed", None) is not None
    assert resolution_error("Rejected", "Fixed") is not None
    assert resolution_error("Rejected", "Duplicate") is None
    assert resolution_error("New", "Fixed") is not None
    assert resolution_error("New", None) is None
    assert all(resolution_error("Closed", r) is None for r in RESOLUTIONS)


# --- the migration itself -------------------------------------------------------------

SCRATCH_DB = "qtesthub_migration_scratch"
ADMIN_DSN = "postgresql://qtesthub:qtesthub@localhost:5432/postgres"
SCRATCH_DSN = f"postgresql://qtesthub:qtesthub@localhost:5432/{SCRATCH_DB}"
SCRATCH_URL = f"postgresql+psycopg://qtesthub:qtesthub@localhost:5432/{SCRATCH_DB}"
PREVIOUS_HEAD = "b4d6f8a0c2e3"


def _alembic(*args: str) -> str:
    env = {**os.environ, "MIGRATION_DATABASE_URL": SCRATCH_URL, "PYTHONPATH": str(BACKEND_ROOT)}
    result = subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=600,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    return result.stdout + result.stderr


def _seed_pre_migration(conn: psycopg.Connection) -> dict:
    """Two tenants of legacy-shaped data; created_at deliberately out of id order."""
    ids: dict = {}
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM roles WHERE code = 'admin' AND tenant_id IS NULL")
        role_id = cur.fetchone()[0]
        for key in ("a", "b"):
            cur.execute("INSERT INTO tenants (name) VALUES (%s) RETURNING id", (f"Tenant {key}",))
            tenant = cur.fetchone()[0]
            cur.execute(
                "INSERT INTO users (tenant_id, email, name, role_id, password_hash) "
                "VALUES (%s, %s, 'U', %s, 'x') RETURNING id",
                (tenant, f"{key}@x.com", role_id),
            )
            user = cur.fetchone()[0]
            cur.execute(
                "INSERT INTO projects (tenant_id, name, domain, status, priority, manager_name, "
                "start_date, end_date, budget, currency_code, region, owner_id) VALUES "
                "(%s, 'P', 'Motor', 'On Track', 'High', 'M', '2026-01-01', '2026-12-31', 1, 'USD', "
                "'NA', %s) RETURNING id",
                (tenant, user),
            )
            project = cur.fetchone()[0]
            cases = []
            for n, days in enumerate((1, 3, 2)):  # created order: n=1 oldest, then n=2, then n=0
                cur.execute(
                    "INSERT INTO test_cases (tenant_id, project_id, title, priority, created_by, "
                    "created_at) VALUES (%s, %s, %s, 'High', %s, "
                    "now() - make_interval(days => %s)) "
                    "RETURNING id",
                    (tenant, project, f"Case {key}{n} title", user, days),
                )
                cases.append(cur.fetchone()[0])
            ids[key] = {"tenant": tenant, "user": user, "project": project, "cases": cases}
        a = ids["a"]
        cur.execute(
            "INSERT INTO test_runs (tenant_id, project_id, name, run_type, executed_by) "
            "VALUES (%s, %s, 'Run 1', 'Smoke', %s) RETURNING id",
            (a["tenant"], a["project"], a["user"]),
        )
        run = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO test_runs (tenant_id, project_id, name, run_type, executed_by) "
            "VALUES (%s, %s, 'Run 2', 'Smoke', %s) RETURNING id",
            (a["tenant"], a["project"], a["user"]),
        )
        run2 = cur.fetchone()[0]
        version_ids = []
        for case in a["cases"]:
            cur.execute(
                "INSERT INTO test_case_versions (tenant_id, test_case_id, version_number, title, "
                "created_by) VALUES (%s, %s, 1, 'v', %s) RETURNING id",
                (a["tenant"], case, a["user"]),
            )
            version_ids.append(cur.fetchone()[0])
        run_cases = []
        # run 1: cases 0 and 1 once each; run 2: case 0 twice (ambiguous).
        for run_id, case_idx in ((run, 0), (run, 1), (run2, 0), (run2, 0)):
            cur.execute(
                "INSERT INTO test_run_cases (tenant_id, test_run_id, test_case_id, "
                "test_case_version_id) VALUES (%s, %s, %s, %s) RETURNING id",
                (a["tenant"], run_id, a["cases"][case_idx], version_ids[case_idx]),
            )
            run_cases.append(cur.fetchone()[0])
        defects = {}
        for name, (run_id, case_idx, deleted) in {
            "linked": (run, 0, False),
            "ambiguous": (run2, 0, False),
            "unlinked": (None, None, False),
            "deleted": (run, 1, True),
        }.items():
            cur.execute(
                "INSERT INTO defects (tenant_id, project_id, title, severity, reported_by, "
                "test_run_id, test_case_id, status, deleted_at, created_at) VALUES "
                "(%s, %s, %s, 'High', %s, %s, %s, 'Fixed', %s, now() - make_interval(hours => %s)) "
                "RETURNING id",
                (
                    a["tenant"],
                    a["project"],
                    f"Defect {name} title",
                    a["user"],
                    run_id,
                    a["cases"][case_idx] if case_idx is not None else None,
                    "2026-01-01" if deleted else None,
                    {"linked": 4, "ambiguous": 3, "unlinked": 2, "deleted": 1}[name],
                ),
            )
            defects[name] = cur.fetchone()[0]
        ids["a"].update(run_cases=run_cases, defects=defects)
    conn.commit()
    return ids


def test_migration_up_down_up_with_backfill() -> None:
    admin = psycopg.connect(ADMIN_DSN, autocommit=True)
    try:
        with admin.cursor() as cur:
            cur.execute(f"DROP DATABASE IF EXISTS {SCRATCH_DB} WITH (FORCE)")
            cur.execute(f"CREATE DATABASE {SCRATCH_DB}")

        _alembic("upgrade", PREVIOUS_HEAD)
        conn = psycopg.connect(SCRATCH_DSN)
        ids = _seed_pre_migration(conn)
        conn.close()

        _alembic("upgrade", "head")
        heads = _alembic("heads")
        assert heads.count("(head)") == 1, heads

        def check_backfill() -> None:
            with psycopg.connect(SCRATCH_DSN) as c, c.cursor() as cur:
                a, b = ids["a"], ids["b"]
                cur.execute(
                    "SELECT id, display_seq, display_id, automation_status FROM test_cases "
                    "WHERE tenant_id = %s ORDER BY created_at, id",
                    (a["tenant"],),
                )
                rows = cur.fetchall()
                # created order was cases[1] (3 days), cases[2] (2 days), cases[0] (1 day)
                assert [r[0] for r in rows] == [a["cases"][1], a["cases"][2], a["cases"][0]]
                assert [r[2] for r in rows] == ["TC_000001", "TC_000002", "TC_000003"]
                assert [r[1] for r in rows] == [1, 2, 3]
                assert {r[3] for r in rows} == {"Manual"}
                cur.execute(
                    "SELECT display_id FROM test_cases WHERE tenant_id = %s ORDER BY display_seq",
                    (b["tenant"],),
                )
                assert [r[0] for r in cur.fetchall()] == ["TC_000001", "TC_000002", "TC_000003"]
                # soft-deleted defect keeps a number; oldest first
                cur.execute(
                    "SELECT title, display_id FROM defects WHERE tenant_id = %s "
                    "ORDER BY display_seq",
                    (a["tenant"],),
                )
                assert cur.fetchall() == [
                    ("Defect linked title", "BUG_000001"),
                    ("Defect ambiguous title", "BUG_000002"),
                    ("Defect unlinked title", "BUG_000003"),
                    ("Defect deleted title", "BUG_000004"),
                ]
                cur.execute(
                    "SELECT tenant_id, kind, next_value FROM entity_counters "
                    "ORDER BY kind, next_value"
                )
                counters = {(str(t), k): n for t, k, n in cur.fetchall()}
                assert counters[(str(a["tenant"]), "test_case")] == 4
                assert counters[(str(a["tenant"]), "defect")] == 5
                assert (str(b["tenant"]), "defect") not in counters
                # defect -> run case derivation only where unambiguous
                cur.execute(
                    "SELECT id, test_run_case_id FROM defects WHERE tenant_id = %s", (a["tenant"],)
                )
                links = dict(cur.fetchall())
                assert links[a["defects"]["linked"]] == a["run_cases"][0]
                assert links[a["defects"]["deleted"]] == a["run_cases"][1]
                assert links[a["defects"]["ambiguous"]] is None
                assert links[a["defects"]["unlinked"]] is None
                # seeded options and permissions
                cur.execute(
                    "SELECT count(*) FROM field_options "
                    "WHERE tenant_id = %s AND field_key = 'test_type'",
                    (a["tenant"],),
                )
                # 12 from ADR-115 + UI and End-to-End from ADR-116 (Sanity / UAT are kept).
                assert cur.fetchone()[0] == 14
                cur.execute(
                    "SELECT code FROM field_options WHERE tenant_id = %s "
                    "AND field_key = 'defect_severity' ORDER BY code",
                    (a["tenant"],),
                )
                # only the additive Major/Minor; the legacy four come from the app seed
                assert cur.fetchall() == [("Major",), ("Minor",)]
                cur.execute(
                    "SELECT r.code, count(*) FROM role_permissions rp "
                    "JOIN roles r ON r.id = rp.role_id "
                    "JOIN permissions p ON p.id = rp.permission_id "
                    "WHERE r.tenant_id IS NULL AND p.code IN ('defect.edit','defect.assign',"
                    "'defect.change_status','defect.import','defect.export','testcase.execute',"
                    "'testcase.export') GROUP BY r.code"
                )
                grants = dict(cur.fetchall())
                assert grants["admin"] == 7 and grants["manager"] == 7
                assert grants["tester"] == 5  # edit, change_status, import, execute, export
                cur.execute(
                    "SELECT count(*) FROM pg_indexes WHERE indexname IN "
                    "('uq_test_cases_tenant_display_id','uq_defects_tenant_display_id',"
                    "'ix_defects_labels_gin','ix_test_run_cases_executed_by')"
                )
                assert cur.fetchone()[0] == 4

        check_backfill()

        # The widened constraints accept new codes; map-back happens on downgrade.
        with psycopg.connect(SCRATCH_DSN) as c, c.cursor() as cur:
            cur.execute(
                "UPDATE defects SET status = 'Retest' WHERE id = %s",
                (ids["a"]["defects"]["linked"],),
            )
            cur.execute(
                "UPDATE defects SET status = 'Rejected' WHERE id = %s",
                (ids["a"]["defects"]["ambiguous"],),
            )
            cur.execute(
                "UPDATE defects SET status = 'Assigned' WHERE id = %s",
                (ids["a"]["defects"]["unlinked"],),
            )
            cur.execute("UPDATE test_runs SET run_type = 'Retest' WHERE name = 'Run 2'")
            cur.execute(
                "INSERT INTO field_options (tenant_id, field_key, code, label) "
                "VALUES (%s, 'test_type', 'Extra', 'Extra')",
                (ids["a"]["tenant"],),
            )

        _alembic("downgrade", PREVIOUS_HEAD)
        with psycopg.connect(SCRATCH_DSN) as c, c.cursor() as cur:
            cur.execute(
                "SELECT id, status FROM defects WHERE tenant_id = %s", (ids["a"]["tenant"],)
            )
            statuses = dict(cur.fetchall())
            assert statuses[ids["a"]["defects"]["linked"]] == "Fixed"  # Retest -> Fixed
            assert statuses[ids["a"]["defects"]["ambiguous"]] == "Closed"  # Rejected -> Closed
            assert statuses[ids["a"]["defects"]["unlinked"]] == "Open"  # Assigned -> Open
            cur.execute("SELECT run_type FROM test_runs WHERE name = 'Run 2'")
            assert cur.fetchone()[0] == "Regression"
            cur.execute("SELECT to_regclass('entity_counters')")
            assert cur.fetchone()[0] is None
            cur.execute(
                "SELECT count(*) FROM information_schema.columns WHERE table_name = 'defects' "
                "AND column_name IN ('display_id','labels','resolution','test_run_case_id')"
            )
            assert cur.fetchone()[0] == 0
            cur.execute("SELECT count(*) FROM permissions WHERE code = 'defect.edit'")
            assert cur.fetchone()[0] == 0
            with pytest.raises(psycopg.errors.CheckViolation):
                cur.execute("UPDATE defects SET status = 'Retest'")

        _alembic("upgrade", "head")
        check_backfill()
    finally:
        with admin.cursor() as cur:
            cur.execute(f"DROP DATABASE IF EXISTS {SCRATCH_DB} WITH (FORCE)")
        admin.close()
