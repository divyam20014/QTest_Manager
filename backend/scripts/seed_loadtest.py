"""Seed ONE throwaway large-data tenant ('LoadTest Perf') for performance work. NOT part of pytest.

Creates (at --scale 1.0): 20 projects, 200k test cases (+versions, ~30% with 3-5 steps),
50k test runs, 500k run cases / 1M execution step results, 100k defects, 10k requirements
(+links), 50k notifications, 500k audit_logs rows with a VALID hash chain (same canonical
hashing as app.core.audit), 20 users (admin/manager/tester with a known password).

All bulk data is inserted with the DB owner (MIGRATION_DATABASE_URL, bypasses RLS) in
per-project batches so memory stays low; tenant_id is always set explicitly. The tenant
and admin are created through the app's own create_tenant_with_admin.

Run inside the api container (code is baked into the image, so docker cp the file first):
    docker cp backend/scripts/seed_loadtest.py <api>:/app/scripts/
    docker compose exec -T api python -m scripts.seed_loadtest [--scale 0.1] [--skip-audit]
Remove everything again:
    docker compose exec -T api python -m scripts.seed_loadtest --drop

Logins (tenant id printed at the end): lt-admin@loadtest-perf.com, lt-manager@loadtest-perf.com,
lt-tester@loadtest-perf.com, password PASSWORD below. Never touches any other tenant.
"""

import argparse
import hashlib
import os
import sys
import time
import uuid
from datetime import UTC, datetime, timedelta

TENANT_NAME = "LoadTest Perf"
PASSWORD = "LoadTest#Perf2024xyz"
ADMIN_EMAIL = "lt-admin@loadtest-perf.com"
MANAGER_EMAIL = "lt-manager@loadtest-perf.com"
TESTER_EMAIL = "lt-tester@loadtest-perf.com"
WORDS = "login payment claim policy premium quote renewal refund endorsement underwriting"


def _owner_dsn() -> str:
    url = os.environ["MIGRATION_DATABASE_URL"]
    return url.replace("postgresql+psycopg://", "postgresql://")


def _parse() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--scale", type=float, default=1.0)
    p.add_argument("--skip-audit", action="store_true")
    p.add_argument("--drop", action="store_true", help="delete the load tenant and all its rows")
    return p.parse_args()


def _find_tenant(conn):
    r = conn.execute("select id from tenants where name = %s", (TENANT_NAME,)).fetchone()
    return r[0] if r else None


def drop(conn) -> None:
    tid = _find_tenant(conn)
    if tid is None:
        print("No load tenant found.")
        return
    tabs = [
        r[0]
        for r in conn.execute(
            "select table_name from information_schema.columns where table_schema='public' "
            "and column_name='tenant_id' and table_name <> 'tenants' order by 1"
        ).fetchall()
    ]
    conn.execute("set session_replication_role = replica")  # skip FK/immutability triggers
    for t in tabs:
        n = conn.execute(f'delete from "{t}" where tenant_id = %s', (tid,)).rowcount
        if n:
            print(f"  {t}: {n}")
    conn.execute("delete from audit_chain_checkpoints where scope = %s", (f"tenant:{tid}",))
    conn.execute("delete from tenants where id = %s", (tid,))
    conn.commit()
    print(f"Dropped tenant {tid}. Run VACUUM (ANALYZE) afterwards to reclaim space.")


def create_tenant() -> uuid.UUID:
    from app.core.db import SessionLocal
    from app.schemas.platform import TenantCreateRequest
    from app.services.platform_service import create_tenant_with_admin

    with SessionLocal() as db:
        tenant, _ = create_tenant_with_admin(
            db,
            TenantCreateRequest(
                tenant_name=TENANT_NAME,
                admin_name="Load Admin",
                admin_email=ADMIN_EMAIL,
                admin_password=PASSWORD,
            ),
        )
        db.commit()
        return tenant.id


def seed_users(conn, tid) -> list[str]:
    from app.core.security import hash_password

    pw = hash_password(PASSWORD)
    roles = dict(conn.execute("select code, id from roles where tenant_id is null").fetchall())
    admin_id = conn.execute(
        "select id from users where tenant_id=%s and email=%s", (tid, ADMIN_EMAIL)
    ).fetchone()[0]
    spec = [(MANAGER_EMAIL, "Load Manager", "manager"), (TESTER_EMAIL, "Load Tester", "tester")]
    spec += [(f"lt-manager{i}@loadtest-perf.com", f"Manager {i}", "manager") for i in range(2, 5)]
    spec += [(f"lt-tester{i}@loadtest-perf.com", f"Tester {i}", "tester") for i in range(2, 18)]
    for email, name, code in spec:
        conn.execute(
            "insert into users (tenant_id, email, name, role_id, password_hash) "
            "values (%s,%s,%s,%s,%s) on conflict do nothing",
            (tid, email, name, roles[code], pw),
        )
    conn.commit()
    ids = [
        str(r[0])
        for r in conn.execute(
            "select id from users where tenant_id=%s order by email", (tid,)
        ).fetchall()
    ]
    assert str(admin_id) in ids
    print(f"users: {len(ids)}")
    return ids


def seed_project(conn, tid, idx, users, admin_id, manager_id, scale) -> None:
    n_cases = max(10, int(10000 * scale))
    n_runs = max(5, int(2500 * scale))
    n_defects = max(10, int(5000 * scale))
    n_reqs = max(5, int(500 * scale))
    n_notif = max(10, int(2500 * scale))
    pid = uuid.uuid4()
    domains = ["Motor", "Health", "Travel", "Life", "Property"]
    arr = "ARRAY[" + ",".join(f"'{u}'" for u in users) + "]::uuid[]"
    nu = len(users)
    T = f"'{tid}'::uuid"
    P = f"'{pid}'::uuid"
    A = f"'{admin_id}'::uuid"
    ex = conn.execute
    ex(
        "insert into projects (id, tenant_id, name, domain, status, priority, manager_name, "
        "start_date, end_date, budget, currency_code, region, owner_id, manager_user_id, version) "
        "values (%s,%s,%s,%s,'On Track','High','Load Manager','2024-01-01','2027-12-31',100000,"
        "'USD','US',%s,%s,1)",
        (pid, tid, f"LoadTest Project {idx:02d}", domains[idx % 5], admin_id, manager_id),
    )
    ex(
        f"insert into project_members (project_id, user_id) select {P}, u from unnest({arr}) u"
    )
    ex(
        f"insert into test_modules (id, tenant_id, project_id, name) "
        f"select gen_random_uuid(), {T}, {P}, 'Module ' || g from generate_series(1,10) g"
    )
    ex(
        f"create temp table _mods on commit drop as select id, row_number() over (order by name) n "
        f"from test_modules where project_id = {P}"
    )
    words = "ARRAY[" + ",".join(f"'{w}'" for w in WORDS.split()) + "]"
    ex(
        f"""insert into test_cases (id, tenant_id, project_id, title, priority, status, assignee_id,
              created_by, created_at, module_id)
            select gen_random_uuid(), {T}, {P},
              'Verify ' || ({words})[1 + i % 10] || ' flow case ' || i,
              (ARRAY['Critical','High','Medium','Low'])[1 + (i*7) % 4],
              (ARRAY['draft','approved','approved','approved','ready_for_review','deprecated'])[1 + (i*11) % 6],
              ({arr})[1 + i % {nu}], {A},
              now() - (random() * interval '700 days'),
              (select id from _mods where n = 1 + i % 10)
            from generate_series(1, {n_cases}) i"""
    )
    ex(
        f"""create temp table _vid on commit drop as
            select id case_id, gen_random_uuid() ver_id from test_cases where project_id = {P}"""
    )
    ex(
        f"""insert into test_case_versions (id, tenant_id, test_case_id, version_number, title,
              created_by, created_at, description)
            select v.ver_id, tc.tenant_id, tc.id, 1, tc.title, tc.created_by, tc.created_at,
              'Description for ' || tc.title
            from test_cases tc join _vid v on v.case_id = tc.id where tc.project_id = {P}"""
    )
    ex(
        "update test_cases tc set current_version_id = v.ver_id from _vid v where v.case_id = tc.id"
    )
    ex(
        f"""insert into test_case_version_steps (id, tenant_id, test_case_version_id, step_number,
              action, expected)
            select gen_random_uuid(), {T}, tc.current_version_id, s,
              'Action ' || s || ' of ' || tc.title, 'Expected result ' || s
            from test_cases tc cross join generate_series(1,5) s
            where tc.project_id = {P} and abs(hashtext(tc.id::text)) % 10 < 3
              and s <= 3 + abs(hashtext(tc.id::text)) % 3"""
    )
    ex(
        f"""create temp table _st on commit drop as
            select row_number() over (order by tc.id) n, tc.id case_id, tc.current_version_id ver_id,
                   s1.id step1, s2.id step2
            from test_cases tc
            join test_case_version_steps s1 on s1.test_case_version_id = tc.current_version_id and s1.step_number = 1
            join test_case_version_steps s2 on s2.test_case_version_id = tc.current_version_id and s2.step_number = 2
            where tc.project_id = {P}"""
    )
    nst = ex("select count(*) from _st").fetchone()[0]
    ex(
        f"""create temp table _r on commit drop as
            select i rn, gen_random_uuid() id from generate_series(1,{n_runs}) i"""
    )
    ex(
        f"""insert into test_runs (id, tenant_id, project_id, name, run_type, executed_by,
              created_at, finished_at)
            select id, {T}, {P}, 'Run ' || rn, (ARRAY['Regression','Smoke','Sanity'])[1 + rn % 3],
              ({arr})[1 + rn % {nu}], now() - (random() * interval '365 days'),
              case when rn % 5 <> 0 then now() - (random() * interval '300 days') end
            from _r"""
    )
    ex(
        f"""create temp table _rc on commit drop as
            select gen_random_uuid() id, r.id run_id, st.case_id, st.ver_id, st.step1, st.step2,
              (ARRAY['passed','passed','passed','passed','passed','passed','failed','failed',
                     'pending','pending','blocked','in_progress'])[1 + (r.rn*13 + j*5) % 12] status,
              ({arr})[1 + (r.rn + j) % {nu}] who
            from _r r cross join generate_series(0,9) j
            join _st st on st.n = 1 + (r.rn*10 + j) % {nst}"""
    )
    ex(
        f"""insert into test_run_cases (id, tenant_id, test_run_id, test_case_id, test_case_version_id,
              status, assigned_to, started_at, completed_at)
            select id, {T}, run_id, case_id, ver_id, status, who,
              now() - interval '10 days', case when status in ('passed','failed') then now() - interval '9 days' end
            from _rc"""
    )
    ex(
        f"""insert into execution_steps (id, tenant_id, test_run_case_id, test_case_version_step_id,
              verdict, opened_at, closed_at, duration_ms, executed_by)
            select gen_random_uuid(), {T}, rc.id, case s when 1 then rc.step1 else rc.step2 end,
              case when rc.status = 'failed' and s = 2 then 'fail' else 'pass' end,
              now() - interval '10 days', now() - interval '10 days' + interval '3 seconds',
              1000 + (abs(hashtext(rc.id::text)) % 5000), rc.who
            from _rc rc cross join generate_series(1,2) s
            where rc.status in ('passed','failed')"""
    )
    # Pending/blocked/in_progress run cases carry no step results, so top up so the project reaches
    # ~2 step results per run case on average by also recording an 'ignore' verdict on those.
    ex(
        f"""insert into execution_steps (id, tenant_id, test_run_case_id, test_case_version_step_id,
              verdict, opened_at, closed_at, duration_ms, executed_by)
            select gen_random_uuid(), {T}, rc.id, case s when 1 then rc.step1 else rc.step2 end,
              'ignore', now() - interval '10 days', now() - interval '10 days', 500, rc.who
            from _rc rc cross join generate_series(1,2) s
            where rc.status not in ('passed','failed')"""
    )
    ex(
        f"""create temp table _tcl on commit drop as
            select row_number() over (order by id) n, id, current_version_id v, module_id
            from test_cases where project_id = {P}"""
    )
    ex(
        f"""insert into defects (id, tenant_id, project_id, test_case_id, test_case_version_id,
              test_run_id, title, severity, status, description, reported_by, created_at, closed_at,
              assigned_to, priority, module_id, root_cause, actual_result, expected_result)
            select gen_random_uuid(), {T}, {P}, c.id, c.v, (select id from _r where rn = 1 + i % {n_runs}),
              'Defect ' || i || ' in ' || ({words})[1 + i % 10] || ' handling',
              (ARRAY['Critical','High','Medium','Medium','Low'])[1 + (i*3) % 5],
              (ARRAY['New','New','Open','Open','Fixed','Verified','Closed','Closed','Closed','Closed'])[1 + (i*7) % 10],
              'Steps to reproduce defect ' || i, ({arr})[1 + i % {nu}],
              now() - (random() * interval '600 days'),
              case when (i*7) % 10 >= 6 then now() - (random() * interval '100 days') end,
              ({arr})[1 + (i*3) % {nu}], (ARRAY['Low','Medium','High'])[1 + i % 3], c.module_id,
              case when i % 4 = 0 then 'code_defect' end, 'Actual ' || i, 'Expected ' || i
            from generate_series(1,{n_defects}) i join _tcl c on c.n = 1 + (i*37) % {n_cases}"""
    )
    ex(
        f"""create temp table _req on commit drop as
            select i, gen_random_uuid() id, gen_random_uuid() ver from generate_series(1,{n_reqs}) i"""
    )
    ex(
        f"""insert into requirements (id, tenant_id, project_id, title, created_by)
            select id, {T}, {P}, 'REQ-' || i || ' ' || ({words})[1 + i % 10] || ' requirement', {A}
            from _req"""
    )
    ex(
        f"""insert into requirement_versions (id, tenant_id, requirement_id, version_number, title,
              description, created_by)
            select ver, {T}, id, 1, 'REQ-' || i || ' ' || ({words})[1 + i % 10] || ' requirement',
              'Requirement description ' || i, {A} from _req"""
    )
    ex("update requirements r set current_version_id = q.ver from _req q where q.id = r.id")
    ex(
        f"""insert into requirement_test_case_links (id, tenant_id, requirement_id, test_case_id, linked_by)
            select gen_random_uuid(), {T}, r.id, c.id, {A}
            from _req r cross join generate_series(0,2) j join _tcl c on c.n = 1 + (r.i*3 + j) % {n_cases}"""
    )
    ex(
        f"""insert into notifications (id, tenant_id, recipient_id, type, title, body, entity_type,
              entity_id, read_at, created_at)
            select gen_random_uuid(), {T}, ({arr})[1 + i % {nu}],
              (ARRAY['mention','test_case_assigned','defect_closed','run_case_assigned'])[1 + i % 4],
              'Notification ' || i, 'Body ' || i, 'test_case', c.id,
              case when i % 3 = 0 then now() end, now() - (random() * interval '90 days')
            from generate_series(1,{n_notif}) i join _tcl c on c.n = 1 + i % {n_cases}"""
    )
    conn.commit()


def seed_audit(conn, tid, users, total) -> None:
    from app.core.audit import _canonical

    # Drop the few chain rows written by tenant creation so the seeded chain starts at genesis
    # (throwaway tenant only; replica role skips the immutability triggers).
    conn.execute("set session_replication_role = replica")
    conn.execute("delete from audit_logs where tenant_id = %s", (tid,))
    conn.execute("set session_replication_role = origin")
    conn.commit()
    base = datetime(2025, 1, 1, tzinfo=UTC)
    step_ms = int(365 * 86400 * 1000 / max(total, 1))
    prev = "0" * 64
    actions = [
        ("test_case.updated", "test_case"),
        ("defect.status_changed", "defect"),
        ("test_run.completed", "test_run"),
        ("test_case.created", "test_case"),
    ]
    with conn.cursor() as cur:
        with cur.copy(
            "copy audit_logs (id, tenant_id, user_id, platform_admin_id, service_token_id, "
            "action, entity_type, entity_id, metadata, prev_hash, record_hash, created_at) from stdin"
        ) as cp:
            for i in range(total):
                ts = base + timedelta(milliseconds=step_ms * i)
                action, et = actions[i % 4]
                eid, uid = uuid.uuid4(), users[i % len(users)]
                meta = {"i": i, "field": "status", "old": "Open", "new": "Closed"}
                payload = {
                    "tenant_id": str(tid),
                    "user_id": uid,
                    "platform_admin_id": None,
                    "service_token_id": None,
                    "action": action,
                    "entity_type": et,
                    "entity_id": str(eid),
                    "metadata": meta,
                    "created_at": ts.isoformat(),
                    "prev_hash": prev,
                }
                h = hashlib.sha256(_canonical(payload).encode()).hexdigest()
                cp.write_row(
                    (uuid.uuid4(), tid, uid, None, None, action, et, eid, _canonical(meta), prev, h, ts)
                )
                prev = h
                if i and i % 100000 == 0:
                    print(f"  audit {i}/{total}", flush=True)
    conn.commit()


def main() -> int:
    import psycopg

    args = _parse()
    conn = psycopg.connect(_owner_dsn())
    if args.drop:
        drop(conn)
        return 0
    t0 = time.time()
    tid = _find_tenant(conn)
    if tid is not None:
        print(f"Load tenant already exists ({tid}); run --drop first.", file=sys.stderr)
        return 1
    tid = create_tenant()
    print(f"TENANT_ID={tid}", flush=True)
    users = seed_users(conn, tid)
    admin_id = conn.execute(
        "select id from users where tenant_id=%s and email=%s", (tid, ADMIN_EMAIL)
    ).fetchone()[0]
    manager_id = conn.execute(
        "select id from users where tenant_id=%s and email=%s", (tid, MANAGER_EMAIL)
    ).fetchone()[0]
    for idx in range(20):
        seed_project(conn, tid, idx, users, admin_id, manager_id, args.scale)
        print(f"project {idx + 1}/20 done ({time.time() - t0:.0f}s)", flush=True)
    if not args.skip_audit:
        seed_audit(conn, tid, users, int(500000 * args.scale))
        print(f"audit done ({time.time() - t0:.0f}s)", flush=True)
    conn.autocommit = True
    conn.execute("analyze")
    for t in ("test_cases", "test_runs", "test_run_cases", "execution_steps", "defects", "audit_logs"):
        n = conn.execute(f"select count(*) from {t} where tenant_id = %s", (tid,)).fetchone()[0]
        print(f"{t}: {n}")
    print(f"DONE in {time.time() - t0:.0f}s  TENANT_ID={tid}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
