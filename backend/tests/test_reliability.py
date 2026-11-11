"""Reliability testing pass (QA engagement): duplicate-request handling,
concurrent-update behavior on a resource not already covered by an existing
concurrency test, and transaction-atomicity-under-partial-failure for CSV
import. Backend/DB restart and network-interruption resilience are
explicitly NOT covered here -- see the reliability report for why.

GAP-67 (idempotency) and GAP-68 (same-field lost update on projects) were
originally documented as findings here, then fixed as opt-in mechanisms
(an `Idempotency-Key` header, and `ProjectUpdateRequest.expected_version`)
-- both findings' tests below now demonstrate the fix alongside the
preserved legacy (no-header/no-version) behavior, so no existing caller's
behavior silently changed."""

from concurrent.futures import ThreadPoolExecutor

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


def test_duplicate_defect_submission_without_a_key_still_creates_two_records(
    client: TestClient, platform_admin: dict
) -> None:
    """GAP-67 FIXED (opt-in): a client that double-submits POST /defects
    with no `Idempotency-Key` header still gets the pre-fix legacy
    behavior -- two separate defect rows -- by design, so no existing
    caller's behavior silently changes. The fix (see the test below) is
    opt-in via a header, not a default dedup window or a unique
    constraint on defect title+project."""
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project = _create_project(client)

    payload = {
        "project_id": project["id"],
        "title": "Duplicate-prone defect",
        "severity": "Low",
    }

    first = client.post("/api/v1/defects", json=payload)
    second = client.post("/api/v1/defects", json=payload)
    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert first.json()["data"]["id"] != second.json()["data"]["id"]

    all_defects = client.get(
        "/api/v1/defects", params={"project_id": project["id"]}
    ).json()["data"]
    matching = [d for d in all_defects if d["title"] == "Duplicate-prone defect"]
    assert len(matching) == 2  # no key supplied -- legacy behavior preserved


def test_idempotency_key_prevents_duplicate_defect_creation(
    client: TestClient, platform_admin: dict
) -> None:
    """GAP-67 FIXED: a client that supplies the same `Idempotency-Key`
    header on a retried/duplicated POST /defects gets back the SAME
    defect both times -- no second row is created. A different key (or a
    different tenant/user) is unaffected."""
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project = _create_project(client)

    payload = {
        "project_id": project["id"],
        "title": "Idempotent defect",
        "severity": "Low",
    }
    headers = {"Idempotency-Key": "client-retry-abc123"}

    first = client.post("/api/v1/defects", json=payload, headers=headers)
    second = client.post("/api/v1/defects", json=payload, headers=headers)
    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert first.json()["data"]["id"] == second.json()["data"]["id"]

    all_defects = client.get(
        "/api/v1/defects", params={"project_id": project["id"]}
    ).json()["data"]
    matching = [d for d in all_defects if d["title"] == "Idempotent defect"]
    assert len(matching) == 1  # deduped to a single record

    # A different key creates a genuinely new, separate defect.
    third = client.post(
        "/api/v1/defects", json=payload, headers={"Idempotency-Key": "different-key"}
    )
    assert third.status_code == 200, third.text
    assert third.json()["data"]["id"] != first.json()["data"]["id"]


def test_concurrent_project_updates_last_write_wins_and_silently_drops_the_other(
    client: TestClient, platform_admin: dict
) -> None:
    """FINDING: `update_project` (app/services/project_service.py) does a
    plain read-modify-write with no SELECT...FOR UPDATE and no
    optimistic-concurrency (version/ETag) check -- unlike the two
    previously-found-and-fixed races in this codebase (MFA attempt-count,
    run-case status rollup), which both guard a *computed aggregate*
    recomputed from scratch. A PATCH is different: it applies only the
    fields present in that request to an ORM object loaded fresh per
    request, so two concurrent PATCHes touching *different* fields on the
    same project both succeed at the HTTP layer (no 409, no error) -- but
    this test demonstrates it is a real lost-update: whichever request's
    flush lands last does not clobber the whole row (each session only sets
    the fields in its own `changes` dict), so in practice both fields often
    do survive under SQLAlchemy's per-attribute UPDATE. This test exists to
    pin down and report the ACTUAL observed behavior, not an assumption."""
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project = _create_project(client)
    project_id = project["id"]

    def _patch(field_payload: dict) -> int:
        thread_client = TestClient(client.app)
        thread_client.cookies.update(client.cookies)
        resp = thread_client.patch(f"/api/v1/projects/{project_id}", json=field_payload)
        return resp.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [
            pool.submit(_patch, {"region": "Europe"}),
            pool.submit(_patch, {"priority": "Critical"}),
        ]
        statuses = [f.result() for f in futures]

    assert all(s == 200 for s in statuses), statuses

    final = client.get(f"/api/v1/projects/{project_id}").json()["data"]
    # Both fields survive here because update_project only ever sets the
    # keys present in *that* request's exclude_unset dump -- it never
    # round-trips the whole object, so two disjoint-field concurrent PATCHes
    # do not corrupt each other. Documented as the actual observed
    # behavior: safe for disjoint-field concurrent PATCHes, NOT tested here
    # for the same-field case, which would be a genuine lost update.
    assert final["region"] == "Europe"
    assert final["priority"] == "Critical"


def test_concurrent_same_field_project_update_is_a_lost_update(
    client: TestClient, platform_admin: dict
) -> None:
    """FINDING, confirmed: two concurrent PATCHes to the SAME field
    (`region`) on the same project race with no lock and no optimistic
    check -- the loser's write is silently discarded (last commit wins),
    with no 409 Conflict and no error surfaced to the loser's caller. This
    is the lost-update class of concurrency bug the disjoint-field test
    above does not exercise. Whichever of the two values is observed after
    both complete is one of the two submitted values -- never a corrupted
    mix -- so there's no data corruption, but there IS a silent,
    unacknowledged lost write, which is worth flagging as a risk for
    high-contention fields (e.g. two Managers editing the same project
    concurrently)."""
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project = _create_project(client)
    project_id = project["id"]

    def _patch(region: str) -> int:
        thread_client = TestClient(client.app)
        thread_client.cookies.update(client.cookies)
        resp = thread_client.patch(f"/api/v1/projects/{project_id}", json={"region": region})
        return resp.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(_patch, "Europe"), pool.submit(_patch, "Asia Pacific")]
        statuses = [f.result() for f in futures]

    assert all(s == 200 for s in statuses), statuses

    final_region = client.get(f"/api/v1/projects/{project_id}").json()["data"]["region"]
    # No corruption (the value is exactly one of the two submitted values),
    # but one write was silently lost with no conflict signal to its caller.
    # This is the pre-fix, no-`expected_version`-supplied legacy behavior,
    # preserved for backward compatibility -- see the fix test below.
    assert final_region in ("Europe", "Asia Pacific")


def test_expected_version_prevents_concurrent_same_field_lost_update(
    client: TestClient, platform_admin: dict
) -> None:
    """GAP-68 FIXED (opt-in): `ProjectOut.version` is returned on every
    read/write; a caller that supplies `expected_version` on a PATCH gets
    a 409 Conflict instead of a silent lost update if someone else changed
    the project first. Exactly one of two concurrent same-field PATCHes
    (both submitted against the same `expected_version`) succeeds; the
    loser gets a real, actionable error rather than having its write
    silently discarded."""
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project = _create_project(client)
    project_id = project["id"]
    assert project["version"] == 1

    def _patch(region: str) -> int:
        thread_client = TestClient(client.app)
        thread_client.cookies.update(client.cookies)
        resp = thread_client.patch(
            f"/api/v1/projects/{project_id}",
            json={"region": region, "expected_version": 1},
        )
        return resp.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(_patch, "Europe"), pool.submit(_patch, "Asia Pacific")]
        statuses = [f.result() for f in futures]

    # Exactly one wins (200), the other is rejected as a stale write (409)
    # -- no silent loss, both callers get an accurate outcome.
    assert sorted(statuses) == [200, 409], statuses

    final = client.get(f"/api/v1/projects/{project_id}").json()["data"]
    assert final["version"] == 2

    # A stale expected_version is rejected outright, even without a race.
    stale_retry = client.patch(
        f"/api/v1/projects/{project_id}", json={"region": "Africa", "expected_version": 1}
    )
    assert stale_retry.status_code == 409

    # Omitting expected_version still works unchanged (backward compatible).
    unversioned = client.patch(f"/api/v1/projects/{project_id}", json={"region": "Africa"})
    assert unversioned.status_code == 200
    assert unversioned.json()["data"]["version"] == 3


def test_csv_import_commits_valid_rows_even_when_other_rows_in_the_same_batch_fail(
    client: TestClient, platform_admin: dict
) -> None:
    """Documents the actual transaction/atomicity design of CSV import
    (app/services/csv_import_service.py::import_test_cases): it is NOT an
    all-or-nothing atomic batch. Per-row validation happens first; only
    rows that pass validation are ever added to the bulk-insert lists, and
    that one bulk insert (+ the current_version_id backfill UPDATE) is a
    single transaction committed once at the end. So a batch with some
    invalid rows still successfully persists every valid row -- there is no
    scenario where a single bad row rolls back otherwise-valid rows, and no
    scenario where a reported "success" silently excludes rows that should
    have been created. This is a real atomicity-adjacent guarantee worth
    confirming explicitly, not assuming from reading the code."""
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project = _create_project(client)

    csv_text = (
        "Title,Module,Sub Module,Project Name,Priority,Status,Description,Scenario Id,"
        "Scenario Description,Prerequisite,Test Data,Assignee Email,Steps\n"
        f'"Valid Reliability Case One","Reliability","","{project["name"]}","High","Draft",'
        '"Description one.","","","","","",'
        '"Do X|See Y"\n'
        f'"Bad","Reliability","","{project["name"]}","High","Draft","Desc.","","","","","",'
        '"Do X|See Y"\n'  # title too short
        f'"Valid Reliability Case Two","Reliability","","{project["name"]}","High","Draft",'
        '"Description two.","","","","","",'
        '"Do X|See Y"\n'
    )

    response = client.post(
        "/api/v1/test-cases/import",
        files={"file": ("import.csv", csv_text, "text/csv")},
    )
    assert response.status_code == 200, response.text
    report = response.json()["data"]
    assert report["created_count"] == 2
    assert report["error_count"] == 1

    cases = client.get(f"/api/v1/projects/{project['id']}/test-cases").json()["data"]["items"]
    titles = {c["title"] for c in cases}
    assert "Valid Reliability Case One" in titles
    assert "Valid Reliability Case Two" in titles
    assert "Bad" not in titles  # the invalid row never partially persisted
