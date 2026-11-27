"""ADR-138 (finding F-05): the tenant export covers every table, or says why not."""

import io
import json
import re
import zipfile

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.services import export_service, job_service
from tests.test_execution import (
    _bootstrap_tenant,
    _create_approved_case,
    _create_project,
    _login_and_verify,
)

API = "/api/v1"
SECRET_COLUMN = re.compile(r"password|secret|encrypted|token_hash|code_hash")


def test_every_table_is_exported_or_excluded_with_a_reason(owner_engine) -> None:
    with owner_engine.connect() as conn:
        tables = set(
            conn.execute(
                text(
                    "select table_name from information_schema.tables "
                    "where table_schema = 'public' and table_type = 'BASE TABLE' "
                    "and table_name <> 'alembic_version'"
                )
            ).scalars()
        )
    exported = set(export_service.exported_tables())
    excluded = set(export_service.EXCLUDED_TABLES)

    assert tables - exported - excluded == set(), "decide: export it, or exclude it and say why"
    assert (exported | excluded) - tables == set(), "listed, but there is no such table"
    assert exported & excluded == set()
    assert all(reason.strip() for reason in export_service.EXCLUDED_TABLES.values())


def _export(client: TestClient, db_session) -> dict[str, list[dict]]:
    job_id = client.post(f"{API}/export").json()["data"]["job_id"]
    assert job_service.run_once(db_session) is True
    status = client.get(f"{API}/export/jobs/{job_id}").json()["data"]
    assert status["status"] == "succeeded", status
    download = client.get(f"{API}/export/jobs/{job_id}/download")
    assert download.status_code == 200
    with zipfile.ZipFile(io.BytesIO(download.content)) as archive:
        return {
            name.removesuffix(".json"): json.loads(archive.read(name))
            for name in archive.namelist()
            if name != "manifest.json"
        }


def test_export_holds_the_tables_it_used_to_leave_out_and_no_secrets(
    client: TestClient, platform_admin: dict, db_session
) -> None:
    other = _bootstrap_tenant_named(client, platform_admin, "Other Mutual", "other@other.com")
    tenant_id = _bootstrap_tenant(client, platform_admin)["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project_id = _create_project(client)["id"]
    case = _create_approved_case(client, project_id, "Exported test case")
    me = client.get(f"{API}/auth/me").json()["data"]["user_id"]
    for path, body in (
        (f"/projects/{project_id}/members", {"user_id": me}),
        (f"/projects/{project_id}/test-suites", {"name": "Exported suite"}),
        (f"/projects/{project_id}/test-plans", {"name": "Exported plan"}),
    ):
        response = client.post(API + path, json=body)
        assert response.status_code == 200, (path, response.text)

    data = _export(client, db_session)

    assert set(data) == set(export_service.exported_tables())
    assert [r["name"] for r in data["test_suites"]] == ["Exported suite"]
    assert [r["name"] for r in data["test_plans"]] == ["Exported plan"]
    assert [(r["project_id"], r["user_id"]) for r in data["project_members"]] == [(project_id, me)]
    assert [r["id"] for r in data["tenants"]] == [tenant_id]
    assert case["id"] in {r["id"] for r in data["test_cases"]}
    assert any(r["action"] == "testcase.approved" for r in data["audit_logs"])
    role_ids = {r["id"] for r in data["roles"]}
    assert {r["role_id"] for r in data["users"]} <= role_ids
    assert data["role_permissions"]
    assert all(r["role_id"] in role_ids and r["permission_code"] for r in data["role_permissions"])
    for table, rows in data.items():
        for row in rows:
            leaked = [column for column in row if SECRET_COLUMN.search(column)]
            assert not leaked, (table, leaked)
            assert row.get("tenant_id") in (None, tenant_id), table
    assert other not in json.dumps(data)


def _bootstrap_tenant_named(client: TestClient, platform_admin: dict, name: str, email: str) -> str:
    response = client.post(
        f"{API}/platform/tenants",
        headers=platform_admin["headers"],
        json={
            "tenant_name": name,
            "admin_name": "Other Admin",
            "admin_email": email,
            "admin_password": "AdminPassw0rd!",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]["tenant"]["id"]
