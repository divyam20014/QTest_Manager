"""Tier 1 / ADR-053: DB-backed background job queue (SR-6.10), wired up
for CSV import off the request path. No Celery/Redis -- see
app/services/job_service.py's docstring."""

import io
import threading

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.db import SessionLocal, set_tenant_context
from app.core.security import hash_password
from app.models.background_job import BackgroundJob
from app.models.identity import Role, User
from app.models.tenant import Tenant
from app.services import job_service


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
        "/api/v1/auth/login", json={"tenant_id": tenant_id, "email": email, "password": password}
    )
    assert login_response.status_code == 200, login_response.text
    code = login_response.json()["data"]["debug_code"]
    verify_response = client.post("/api/v1/auth/mfa/verify", json={"code": code})
    assert verify_response.status_code == 200, verify_response.text


def _create_project(client: TestClient, name: str) -> dict:
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


def _setup_admin_and_project(client: TestClient, platform_admin: dict, project_name: str) -> dict:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    return _create_project(client, project_name)


def test_async_csv_import_enqueues_and_completes_via_the_worker(
    client: TestClient, platform_admin: dict
) -> None:
    project = _setup_admin_and_project(client, platform_admin, "Apex Motor Claims Modernization")
    csv_text = (
        "Title,Project Name,Priority,Status,Assignee Email,Steps\n"
        '"Verify Total Loss Settlement","Apex Motor Claims Modernization","Critical","Draft",,'
        '"Input Policy Number|ACV displayed;Apply $500 deductible|Payout = ACV - 500"\n'
    )
    files = {"file": ("import.csv", io.BytesIO(csv_text.encode("utf-8")), "text/csv")}
    enqueue_response = client.post("/api/v1/test-cases/import/async", files=files)
    assert enqueue_response.status_code == 200, enqueue_response.text
    job_id = enqueue_response.json()["data"]["job_id"]
    assert enqueue_response.json()["data"]["status"] == "queued"

    pending = client.get(f"/api/v1/test-cases/import/jobs/{job_id}")
    assert pending.json()["data"]["status"] == "queued"

    # No worker process runs in this test process -- simulate it directly,
    # exercising the exact same claim/run path app/worker.py uses.
    worker_db = SessionLocal()
    try:
        claimed = job_service.run_once(worker_db)
        assert claimed is True
    finally:
        worker_db.close()

    done = client.get(f"/api/v1/test-cases/import/jobs/{job_id}")
    assert done.status_code == 200, done.text
    data = done.json()["data"]
    assert data["status"] == "succeeded"
    assert data["result"]["created_count"] == 1

    cases = client.get(f"/api/v1/projects/{project['id']}/test-cases").json()["data"]["items"]
    assert len(cases) == 1


def test_async_csv_import_failure_is_recorded_on_the_job(
    client: TestClient, platform_admin: dict
) -> None:
    _setup_admin_and_project(client, platform_admin, "Apex Motor Claims Modernization")
    # Wrong headers -> import_test_cases raises ValidationAppError.
    csv_text = "Not,The,Right,Headers\n"
    files = {"file": ("import.csv", io.BytesIO(csv_text.encode("utf-8")), "text/csv")}
    enqueue_response = client.post("/api/v1/test-cases/import/async", files=files)
    assert enqueue_response.status_code == 200, enqueue_response.text
    job_id = enqueue_response.json()["data"]["job_id"]

    worker_db = SessionLocal()
    try:
        job_service.run_once(worker_db)
    finally:
        worker_db.close()

    done = client.get(f"/api/v1/test-cases/import/jobs/{job_id}")
    data = done.json()["data"]
    assert data["status"] == "failed"
    assert data["error"]


def test_a_tenant_cannot_read_another_tenants_job(client: TestClient, platform_admin: dict) -> None:
    project_a = _setup_admin_and_project(client, platform_admin, "Apex Motor Claims Modernization")
    csv_text = (
        "Title,Project Name,Priority,Status,Assignee Email,Steps\n"
        f'"Verify Case","{project_a["name"]}","Critical","Draft",,'
        '"Step|Expected"\n'
    )
    files = {"file": ("import.csv", io.BytesIO(csv_text.encode("utf-8")), "text/csv")}
    job_id = client.post("/api/v1/test-cases/import/async", files=files).json()["data"]["job_id"]

    bootstrap_b = client.post(
        "/api/v1/platform/tenants",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={
            "tenant_name": "Apex Insurance",
            "admin_name": "Admin B",
            "admin_email": "admin@apex.com",
            "admin_password": "AdminPassw0rd!",
        },
    ).json()["data"]
    _login_and_verify(client, bootstrap_b["tenant"]["id"], "admin@apex.com", "AdminPassw0rd!")

    response = client.get(f"/api/v1/test-cases/import/jobs/{job_id}")
    assert response.status_code == 404, response.text


def test_concurrent_workers_claim_each_job_exactly_once() -> None:
    """Correctness-by-construction for `FOR UPDATE SKIP LOCKED`: seeds N
    queued jobs, runs several threads (each its own DB session, mirroring
    separate worker processes) claiming in a tight loop until the queue is
    empty, and asserts every job was claimed exactly once with no job
    claimed twice or left behind."""
    setup_db = SessionLocal()
    try:
        tenant = Tenant(name="Concurrency Co", status="approved")
        setup_db.add(tenant)
        setup_db.flush()

        set_tenant_context(setup_db, str(tenant.id))
        admin_role_id = setup_db.execute(select(Role.id).where(Role.code == "admin")).scalar_one()
        user = User(
            tenant_id=tenant.id,
            email="admin@concurrency.co",
            name="Admin",
            role_id=admin_role_id,
            password_hash=hash_password("AdminPassw0rd!"),
        )
        setup_db.add(user)
        setup_db.flush()

        job_ids = []
        for _ in range(20):
            job = BackgroundJob(
                tenant_id=tenant.id,
                job_type="noop",
                payload={},
                created_by=user.id,
            )
            setup_db.add(job)
            setup_db.flush()
            job_ids.append(job.id)
        setup_db.commit()
    finally:
        setup_db.close()

    claimed_ids: list = []
    lock = threading.Lock()

    def worker_loop() -> None:
        db = SessionLocal()
        try:
            while True:
                job = job_service.claim_one(db)
                if job is None:
                    return
                with lock:
                    claimed_ids.append(job.id)
        finally:
            db.close()

    threads = [threading.Thread(target=worker_loop) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)

    assert sorted(claimed_ids) == sorted(job_ids)
    assert len(claimed_ids) == len(set(claimed_ids))

    verify_db = SessionLocal()
    try:
        remaining = verify_db.execute(
            select(BackgroundJob).where(
                BackgroundJob.id.in_(job_ids), BackgroundJob.status == "queued"
            )
        ).scalars().all()
        assert remaining == []
    finally:
        verify_db.close()
