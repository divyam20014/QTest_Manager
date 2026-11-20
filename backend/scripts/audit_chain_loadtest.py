"""Load and size test for the audit hash chain (GAP-12, ADR-087). NOT part of pytest.

Part 1 (write load): N concurrent writer threads append events to ONE throwaway
tenant through the app's own `record_audit_event` path (one session and one
transaction per event, tenant context bound, commit, like an API request). It
reports throughput, p50/p95/max latency, advisory-lock wait and errors, then
checks the chain (no fork, no gap, strictly increasing timestamps, and
`verify_chain`). A second run spreads the same writers over TWO tenants to show
whether tenants contend on one lock.

Part 2 (verification cost): builds chains of the requested sizes by bulk COPY
(correctly hashed rows), then times `verify_chain` without and with signed
checkpoints, and records peak Python memory (tracemalloc, measured in a separate
pass because tracemalloc slows the run).

Safety: it never touches your dev database. It creates its own database
(default `qtesthub_loadtest`, dropped at the end unless --keep-db) on the server
named by --admin-dsn, runs the migrations there, and refuses to run when
ENVIRONMENT=production or when a pre-existing database of that name holds a
protected demo tenant (unless the database is `qtesthub_test`).

Usage (from backend/, with the dev Postgres reachable on localhost:5432):
    python -m scripts.audit_chain_loadtest                       # defaults
    python -m scripts.audit_chain_loadtest --writers 20 --events 3000 \
        --sizes 10000,50000,100000
    python -m scripts.audit_chain_loadtest --skip-write --sizes 10000
"""

import argparse
import os
import statistics
import sys
import threading
import time
import tracemalloc
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

PROTECTED_NAMES = ("Quantique", "Indicosmic", "Meridian Auto Insurance")
BACKEND_ROOT = Path(__file__).resolve().parent.parent


def _parse() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--writers", type=int, default=20)
    p.add_argument("--events", type=int, default=3000, help="total events per write run")
    p.add_argument("--sizes", default="10000,50000,100000", help="chain sizes, comma separated")
    p.add_argument("--skip-write", action="store_true")
    p.add_argument("--skip-verify", action="store_true")
    p.add_argument("--database", default="qtesthub_loadtest")
    p.add_argument("--admin-dsn", default="postgresql://qtesthub:qtesthub@localhost:5432/postgres")
    p.add_argument("--keep-db", action="store_true")
    return p.parse_args()


def _pct(values: list[float], q: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(len(ordered) * q))]


def _prepare_database(args) -> str:
    import psycopg

    host_part = args.admin_dsn.rsplit("/", 1)[0]
    admin = psycopg.connect(args.admin_dsn, autocommit=True)
    with admin.cursor() as cur:
        cur.execute("select 1 from pg_database where datname = %s", (args.database,))
        if cur.fetchone() and args.database != "qtesthub_test":
            with psycopg.connect(f"{host_part}/{args.database}", autocommit=True) as old:
                names = [r[0] for r in old.execute("select name from tenants").fetchall()]
            if any(n in PROTECTED_NAMES for n in names):
                print(f"Refusing: {args.database} holds a protected demo tenant.", file=sys.stderr)
                raise SystemExit(1)
        cur.execute(f'DROP DATABASE IF EXISTS "{args.database}" WITH (FORCE)')
        cur.execute(f'CREATE DATABASE "{args.database}"')
    admin.close()
    return host_part


def _migrate(owner_url: str) -> None:
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(BACKEND_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    cfg.set_main_option("sqlalchemy.url", owner_url)
    command.upgrade(cfg, "head")


def main() -> int:
    args = _parse()
    if os.environ.get("ENVIRONMENT", "").lower() == "production":
        print("Refusing to run with ENVIRONMENT=production.", file=sys.stderr)
        return 1
    host_part = _prepare_database(args)
    sa_host = host_part.replace("postgresql://", "postgresql+psycopg://")
    owner_url = f"{sa_host.replace('qtesthub:qtesthub', 'qtesthub:qtesthub')}/{args.database}"
    app_url = owner_url.replace("qtesthub:qtesthub@", "qtesthub_app:qtesthub_app@")
    os.environ["DATABASE_URL"] = app_url
    os.environ["MIGRATION_DATABASE_URL"] = owner_url
    os.environ["IDENTIFY_DATABASE_URL"] = owner_url.replace(
        "qtesthub:qtesthub@", "qtesthub_identify:qtesthub_identify@"
    )
    os.environ["ENVIRONMENT"] = "development"
    os.environ.setdefault(
        "AI_CREDENTIAL_ENCRYPTION_KEY", "kEdknj1w6XzjMsv2T86nToujCkYjMqSYnr3CoPxuKAI="
    )
    sys.path.insert(0, str(BACKEND_ROOT))
    try:
        print(f"Database {args.database}: migrating ...", flush=True)
        _migrate(owner_url)
        _run(args, owner_url)
    finally:
        if not args.keep_db:
            import psycopg

            with psycopg.connect(args.admin_dsn, autocommit=True) as admin:
                admin.execute(f'DROP DATABASE IF EXISTS "{args.database}" WITH (FORCE)')
            print(f"Dropped database {args.database}.")
    return 0


def _run(args, owner_url: str) -> None:
    from sqlalchemy import create_engine, event, text
    from sqlalchemy.orm import Session

    from app.core.audit import record_audit_event
    from app.core.db import set_tenant_context

    owner = create_engine(owner_url)
    writer_engine = create_engine(
        os.environ["DATABASE_URL"], pool_size=args.writers, max_overflow=0
    )
    local = threading.local()

    @event.listens_for(writer_engine, "before_cursor_execute")
    def _before(conn, cur, stmt, params, ctx, many):
        if "pg_advisory_xact_lock" in stmt:
            local.t0 = time.perf_counter()

    @event.listens_for(writer_engine, "after_cursor_execute")
    def _after(conn, cur, stmt, params, ctx, many):
        if "pg_advisory_xact_lock" in stmt:
            local.lock_wait = time.perf_counter() - local.t0

    def new_tenant(label: str) -> uuid.UUID:
        tid = uuid.uuid4()
        with owner.begin() as c:
            c.execute(
                text("insert into tenants (id, name, status) values (:i, :n, 'approved')"),
                {"i": tid, "n": f"Loadtest {label} {int(time.time() * 1000)}-1"},
            )
        return tid

    def write_run(tenants: list[uuid.UUID], total: int, writers: int) -> dict:
        counter = iter(range(total))
        guard = threading.Lock()
        lat: list[float] = []
        waits: list[float] = []
        errors: list[str] = []

        def worker() -> None:
            while True:
                with guard:
                    n = next(counter, None)
                if n is None:
                    return
                tid = tenants[n % len(tenants)]
                t0 = time.perf_counter()
                try:
                    with Session(writer_engine) as s:
                        set_tenant_context(s, str(tid))
                        record_audit_event(
                            s,
                            tenant_id=tid,
                            user_id=None,
                            action="loadtest.event",
                            entity_type="loadtest",
                            entity_id=uuid.uuid4(),
                            metadata={"n": n, "note": "x" * 40},
                        )
                        s.commit()
                    dt = time.perf_counter() - t0
                    with guard:
                        lat.append(dt)
                        waits.append(getattr(local, "lock_wait", 0.0))
                except Exception as exc:  # noqa: BLE001 - report every failure kind
                    with guard:
                        errors.append(type(exc).__name__ + ": " + str(exc)[:100])

        threads = [threading.Thread(target=worker) for _ in range(writers)]
        start = time.perf_counter()
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        wall = time.perf_counter() - start
        return {"ok": len(lat), "wall": wall, "lat": lat, "waits": waits, "errors": errors}

    def chain_check(tid: uuid.UUID) -> str:
        from app.services import audit_service

        with owner.connect() as c:
            rows = c.execute(
                text(
                    "select id, prev_hash, record_hash, created_at from audit_logs "
                    "where tenant_id = :t order by created_at, id"
                ),
                {"t": tid},
            ).all()
        prev, last, problems = "0" * 64, None, 0
        for r in rows:
            if r.prev_hash != prev:
                problems += 1  # a fork or a gap
            if last is not None and r.created_at <= last:
                problems += 1  # tie or non-increasing timestamp
            prev, last = r.record_hash, r.created_at
        with Session(writer_engine) as s:
            set_tenant_context(s, str(tid))
            res = audit_service.verify_chain(s, tid)
        return f"rows={len(rows)} link/timestamp problems={problems} verify_chain.valid={res.valid}"

    if not args.skip_write:
        print(f"\n== Write load: {args.writers} writers, {args.events} events ==")
        write_run([new_tenant("warmup")], min(200, args.events), args.writers)  # pool warm-up
        for label, ntenants in (("one tenant", 1), ("two tenants", 2)):
            tenants = [new_tenant(f"w{i}") for i in range(ntenants)]
            r = write_run(tenants, args.events, args.writers)
            lat = r["lat"]
            print(
                f"[{label}] ok={r['ok']} errors={len(r['errors'])} wall={r['wall']:.1f}s "
                f"throughput={r['ok'] / r['wall']:.1f} ev/s "
                f"lat p50={statistics.median(lat) * 1000:.0f}ms p95={_pct(lat, .95) * 1000:.0f}ms "
                f"max={max(lat) * 1000:.0f}ms "
                f"lock-wait p50={statistics.median(r['waits']) * 1000:.0f}ms "
                f"p95={_pct(r['waits'], .95) * 1000:.0f}ms max={max(r['waits']) * 1000:.0f}ms"
            )
            for e in sorted(set(r["errors"]))[:5]:
                print(f"   error: {e}")
            for tid in tenants:
                print(f"   chain {tid}: {chain_check(tid)}")

    if args.skip_verify:
        return
    import hashlib

    from app.core.audit import _canonical
    from app.services import audit_checkpoint_service as cps
    from app.services import audit_service

    def build_chain(n: int) -> uuid.UUID:
        tid = new_tenant(f"v{n}")
        base = datetime(2024, 1, 1, tzinfo=UTC)
        prev = "0" * 64
        raw = owner.raw_connection()
        try:
            cur = raw.cursor()
            with cur.copy(
                "copy audit_logs (id, tenant_id, user_id, platform_admin_id, service_token_id, "
                "action, entity_type, entity_id, metadata, prev_hash, record_hash, created_at) "
                "from stdin"
            ) as cp:
                for i in range(n):
                    ts = base + timedelta(milliseconds=7 * i)
                    rid, eid = uuid.uuid4(), uuid.uuid4()
                    meta = {"i": i, "field": "status", "old": "Open", "new": "Closed"}
                    payload = {
                        "tenant_id": str(tid),
                        "user_id": None,
                        "platform_admin_id": None,
                        "service_token_id": None,
                        "action": "loadtest.event",
                        "entity_type": "loadtest",
                        "entity_id": str(eid),
                        "metadata": meta,
                        "created_at": ts.isoformat(),
                        "prev_hash": prev,
                    }
                    h = hashlib.sha256(_canonical(payload).encode()).hexdigest()
                    cp.write_row(
                        (
                            rid,
                            tid,
                            None,
                            None,
                            None,
                            "loadtest.event",
                            "loadtest",
                            eid,
                            _canonical(meta),
                            prev,
                            h,
                            ts,
                        )
                    )
                    prev = h
            raw.commit()
        finally:
            raw.close()
        return tid

    def add_checkpoints(tid: uuid.UUID, n: int, parts: int = 4) -> None:
        scope = cps.tenant_scope(tid)
        prev_hash, ts_cp = "0" * 64, datetime.now(UTC)
        with owner.begin() as c:
            for k in range(1, parts + 1):
                count = n * k // parts
                row = c.execute(
                    text(
                        "select id, created_at, record_hash from audit_logs where tenant_id=:t "
                        "order by created_at, id offset :o limit 1"
                    ),
                    {"t": tid, "o": count - 1},
                ).one()
                ts_cp += timedelta(seconds=1)
                h = cps.compute_checkpoint_hash(
                    scope=scope,
                    record_count=count,
                    head_hash=row.record_hash,
                    prev_checkpoint_hash=prev_hash,
                    created_at=ts_cp,
                    last_record_id=row.id,
                    last_created_at=row.created_at,
                )
                c.execute(
                    text(
                        "insert into audit_chain_checkpoints (id, scope, last_record_id, "
                        "last_created_at, record_count, head_hash, prev_checkpoint_hash, "
                        "checkpoint_hash, signature, created_at) values (:id, :s, :lr, :lc, :rc, "
                        ":hh, :ph, :ch, :sig, :ca)"
                    ),
                    {
                        "id": uuid.uuid4(),
                        "s": scope,
                        "lr": row.id,
                        "lc": row.created_at,
                        "rc": count,
                        "hh": row.record_hash,
                        "ph": prev_hash,
                        "ch": h,
                        "sig": cps.sign(h),
                        "ca": ts_cp,
                    },
                )
                prev_hash = h

    def timed_verify(tid: uuid.UUID, **kw):
        with Session(writer_engine) as s:
            set_tenant_context(s, str(tid))
            t0 = time.perf_counter()
            res = audit_service.verify_chain(s, tid, **kw)
            return time.perf_counter() - t0, res

    def peak_mem(tid: uuid.UUID, **kw) -> float:
        tracemalloc.start()
        try:
            timed_verify(tid, **kw)
            return tracemalloc.get_traced_memory()[1] / 1024 / 1024
        finally:
            tracemalloc.stop()

    has_since = "since_checkpoint" in audit_service.verify_chain.__code__.co_varnames
    print("\n== Verification cost ==")
    print(
        "size | build s | verify s (no cp) | peak MB (no cp) | verify s (4 cp) | peak MB (4 cp)"
        + (" | verify s (since cp) | peak MB (since cp)" if has_since else "")
    )
    for n in (int(x) for x in args.sizes.split(",")):
        t0 = time.perf_counter()
        tid = build_chain(n)
        build = time.perf_counter() - t0
        t_plain, res = timed_verify(tid)
        m_plain = peak_mem(tid)
        add_checkpoints(tid, n)
        t_cp, res_cp = timed_verify(tid)
        m_cp = peak_mem(tid)
        line = (
            f"{n} | {build:.1f} | {t_plain:.1f} (valid={res.valid}) | {m_plain:.0f} | "
            f"{t_cp:.1f} (valid={res_cp.valid}, cps={res_cp.checkpoints_checked}) | {m_cp:.0f}"
        )
        if has_since:
            t_s, res_s = timed_verify(tid, since_checkpoint=True)
            m_s = peak_mem(tid, since_checkpoint=True)
            line += f" | {t_s:.1f} (valid={res_s.valid}, walked={res_s.checked_count}) | {m_s:.0f}"
        print(line, flush=True)


if __name__ == "__main__":
    raise SystemExit(main())
