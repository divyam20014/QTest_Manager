"""ADR-127: the task migrations apply, reverse and re-apply cleanly on a database with data.

Runs on a throwaway database (never the test database the other tests use): bring it to the
revision before tasks, seed a tenant with a project, a requirement and a defect, upgrade, add
tasks, comments and counters, downgrade, check what is gone and what survived, upgrade again.
"""

import os
import subprocess
import sys
from pathlib import Path

import psycopg
import pytest

BACKEND_ROOT = Path(__file__).resolve().parent.parent
SCRATCH_DB = "qtesthub_task_migration_scratch"
ADMIN_DSN = "postgresql://qtesthub:qtesthub@localhost:5432/postgres"
SCRATCH_DSN = f"postgresql://qtesthub:qtesthub@localhost:5432/{SCRATCH_DB}"
SCRATCH_URL = f"postgresql+psycopg://qtesthub:qtesthub@localhost:5432/{SCRATCH_DB}"
BEFORE_TASKS = "a6c8e0b2d4f7"


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


def _one(cur: psycopg.Cursor, sql: str, params: tuple = ()):
    cur.execute(sql, params)
    return cur.fetchone()[0]


def _seed(conn: psycopg.Connection) -> dict:
    with conn.cursor() as cur:
        role = _one(cur, "SELECT id FROM roles WHERE code = 'admin' AND tenant_id IS NULL")
        tenant = _one(cur, "INSERT INTO tenants (name) VALUES ('Migrating Co') RETURNING id")
        user = _one(
            cur,
            "INSERT INTO users (tenant_id, email, name, role_id, password_hash) "
            "VALUES (%s, 'm@x.com', 'M', %s, 'x') RETURNING id",
            (tenant, role),
        )
        project = _one(
            cur,
            "INSERT INTO projects (tenant_id, name, domain, status, priority, manager_name, "
            "start_date, end_date, budget, currency_code, region, owner_id) VALUES "
            "(%s, 'P', 'Motor', 'On Track', 'High', 'M', '2026-01-01', '2026-12-31', 1, 'USD', "
            "'NA', %s) RETURNING id",
            (tenant, user),
        )
        requirement = _one(
            cur,
            "INSERT INTO requirements (tenant_id, project_id, title, created_by) "
            "VALUES (%s, %s, 'A requirement', %s) RETURNING id",
            (tenant, project, user),
        )
        defect = _one(
            cur,
            "INSERT INTO defects (tenant_id, project_id, title, severity, reported_by) "
            "VALUES (%s, %s, 'A defect', 'High', %s) RETURNING id",
            (tenant, project, user),
        )
    conn.commit()
    return {
        "tenant": tenant,
        "user": user,
        "project": project,
        "requirement": requirement,
        "defect": defect,
    }


def _tables(cur: psycopg.Cursor) -> set[str]:
    cur.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
    return {r[0] for r in cur.fetchall()}


def _columns(cur: psycopg.Cursor, table: str) -> set[str]:
    cur.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_name = %s", (table,)
    )
    return {r[0] for r in cur.fetchall()}


def test_task_migrations_up_down_up_with_data() -> None:
    admin = psycopg.connect(ADMIN_DSN, autocommit=True)
    try:
        with admin.cursor() as cur:
            cur.execute(f"DROP DATABASE IF EXISTS {SCRATCH_DB} WITH (FORCE)")
            cur.execute(f"CREATE DATABASE {SCRATCH_DB}")

        _alembic("upgrade", BEFORE_TASKS)
        conn = psycopg.connect(SCRATCH_DSN)
        ids = _seed(conn)
        conn.close()

        _alembic("upgrade", "head")
        assert _alembic("heads").count("(head)") == 1

        with psycopg.connect(SCRATCH_DSN) as c, c.cursor() as cur:
            # Existing tenants are seeded: three statuses (one default), three priorities.
            cur.execute(
                "SELECT code, category, is_default FROM task_statuses "
                "WHERE tenant_id = %s ORDER BY sort_order",
                (ids["tenant"],),
            )
            assert cur.fetchall() == [
                ("todo", "todo", True),
                ("in_progress", "in_progress", False),
                ("done", "done", False),
            ]
            cur.execute(
                "SELECT code FROM field_options WHERE tenant_id = %s "
                "AND field_key = 'task_priority' ORDER BY sort_order",
                (ids["tenant"],),
            )
            assert [r[0] for r in cur.fetchall()] == ["High", "Medium", "Low"]
            # Permissions: Admin and Manager manage, every role transitions, only Admin configures.
            cur.execute(
                "SELECT p.code, array_agg(r.code ORDER BY r.code) FROM role_permissions rp "
                "JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id "
                "WHERE r.tenant_id IS NULL AND p.code LIKE 'task%%' GROUP BY p.code"
            )
            assert dict(cur.fetchall()) == {
                "task.manage": ["admin", "manager"],
                "task.transition": ["admin", "manager", "tester"],
                "task_status.manage": ["admin"],
            }
            # Old rows are untouched and unassigned.
            assert (
                _one(cur, "SELECT task_id FROM requirements WHERE id = %s", (ids["requirement"],))
                is None
            )
            assert _one(cur, "SELECT task_id FROM defects WHERE id = %s", (ids["defect"],)) is None

            # Tasks, a sub-task, links, a task comment and a task counter all fit.
            todo = _one(
                cur,
                "SELECT id FROM task_statuses WHERE tenant_id = %s AND code = 'todo'",
                (ids["tenant"],),
            )
            parent = _one(
                cur,
                "INSERT INTO tasks (tenant_id, project_id, depth, title, status_id, created_by) "
                "VALUES (%s, %s, 0, 'Parent task', %s, %s) RETURNING id",
                (ids["tenant"], ids["project"], todo, ids["user"]),
            )
            cur.execute(
                "INSERT INTO tasks (tenant_id, project_id, parent_task_id, depth, title, "
                "status_id, created_by) VALUES (%s, %s, %s, 1, 'Child task', %s, %s)",
                (ids["tenant"], ids["project"], parent, todo, ids["user"]),
            )
            cur.execute(
                "UPDATE requirements SET task_id = %s WHERE id = %s", (parent, ids["requirement"])
            )
            cur.execute("UPDATE defects SET task_id = %s WHERE id = %s", (parent, ids["defect"]))
            cur.execute(
                "INSERT INTO comments (tenant_id, owner_type, owner_id, body, author_id) "
                "VALUES (%s, 'task', %s, 'on a task', %s)",
                (ids["tenant"], parent, ids["user"]),
            )
            cur.execute(
                "INSERT INTO entity_counters (tenant_id, kind, next_value) VALUES (%s, 'task', 3)",
                (ids["tenant"],),
            )
            c.commit()

        _alembic("downgrade", BEFORE_TASKS)
        with psycopg.connect(SCRATCH_DSN) as c, c.cursor() as cur:
            tables = _tables(cur)
            assert not ({"tasks", "task_statuses", "task_test_case_links"} & tables)
            assert "task_id" not in _columns(cur, "requirements")
            assert "task_id" not in _columns(cur, "defects")
            assert _one(cur, "SELECT count(*) FROM permissions WHERE code LIKE 'task%%'") == 0
            assert _one(cur, "SELECT count(*) FROM comments WHERE owner_type = 'task'") == 0
            assert _one(cur, "SELECT count(*) FROM entity_counters WHERE kind = 'task'") == 0
            assert (
                _one(cur, "SELECT count(*) FROM field_options WHERE field_key = 'task_priority'")
                == 0
            )
            # The data that existed before tasks is still there.
            assert _one(
                cur, "SELECT title FROM requirements WHERE id = %s", (ids["requirement"],)
            ) == ("A requirement")
            assert (
                _one(cur, "SELECT title FROM defects WHERE id = %s", (ids["defect"],)) == "A defect"
            )
            # The old constraints are back: no 'task' owner, no 'task' counter.
            with pytest.raises(psycopg.errors.CheckViolation):
                cur.execute(
                    "INSERT INTO comments (tenant_id, owner_type, owner_id, body, author_id) "
                    "VALUES (%s, 'task', %s, 'x', %s)",
                    (ids["tenant"], ids["defect"], ids["user"]),
                )

        _alembic("upgrade", "head")
        with psycopg.connect(SCRATCH_DSN) as c, c.cursor() as cur:
            assert (
                _one(
                    cur, "SELECT count(*) FROM task_statuses WHERE tenant_id = %s", (ids["tenant"],)
                )
                == 3
            )
            assert _one(cur, "SELECT count(*) FROM tasks") == 0
            assert _one(cur, "SELECT count(*) FROM permissions WHERE code LIKE 'task%%'") == 3
            assert "task_id" in _columns(cur, "requirements")
    finally:
        with admin.cursor() as cur:
            cur.execute(f"DROP DATABASE IF EXISTS {SCRATCH_DB} WITH (FORCE)")
        admin.close()
