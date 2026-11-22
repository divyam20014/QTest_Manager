"""ADR-113: performance indexes (sort/filter/FK/trigram) for large tenants

Revision ID: b4d6f8a0c2e3
Revises: f9b3d5a7c1e2
Create Date: 2026-11-25 09:00:00.000000

Every index is built CONCURRENTLY (inside `autocommit_block`, since CONCURRENTLY
cannot run in a transaction) so a production upgrade does not take write locks
on the big tables. All statements are IF NOT EXISTS / IF EXISTS, so a build that
was interrupted (leaving an INVALID index) can be repaired by dropping it and
re-running. The indexes follow the DB audit's findings (see ADR-113):

* test_run_cases(tenant_id, test_case_id) and a partial execution_steps lookup
  fix the per-test-case "last execution" lookups (a 2.5 billion-row seq scan).
* (tenant_id, created_at, id) style indexes serve the list endpoints' ORDER BY +
  LIMIT/keyset paging, and audit_logs' chain-head lookup on every write.
* GIN trigram indexes serve the `ILIKE '%term%'` searches.
* Small partial FK indexes cover the filters/joins/ON DELETE paths that were
  sequential scans.

Downgrade drops them again. pg_trgm is intentionally left installed on downgrade
(other objects may rely on it and it is harmless).
"""

from alembic import op

revision = "b4d6f8a0c2e3"
down_revision = "f9b3d5a7c1e2"
branch_labels = None
depends_on = None

# (name, table, definition-after-table)
_INDEXES: list[tuple[str, str, str]] = [
    # --- last-execution lookups / tester visibility -------------------------
    ("ix_test_run_cases_tenant_case", "test_run_cases", "(tenant_id, test_case_id)"),
    (
        "ix_execution_steps_case_closed",
        "execution_steps",
        "(test_run_case_id, closed_at DESC) WHERE closed_at IS NOT NULL",
    ),
    (
        "ix_test_run_cases_assigned_to",
        "test_run_cases",
        "(assigned_to, test_case_id) WHERE assigned_to IS NOT NULL",
    ),
    (
        "ix_test_runs_tenant_executed_by",
        "test_runs",
        "(tenant_id, executed_by) WHERE deleted_at IS NULL",
    ),
    # --- sort / keyset indexes ---------------------------------------------
    ("ix_test_cases_tenant_created", "test_cases", "(tenant_id, created_at, id)"),
    (
        "ix_test_cases_tenant_project_created",
        "test_cases",
        "(tenant_id, project_id, created_at, id)",
    ),
    (
        "ix_defects_tenant_created",
        "defects",
        "(tenant_id, created_at DESC, id) WHERE deleted_at IS NULL",
    ),
    (
        "ix_defects_tenant_project_created",
        "defects",
        "(tenant_id, project_id, created_at DESC, id) WHERE deleted_at IS NULL",
    ),
    ("ix_audit_logs_tenant_created", "audit_logs", "(tenant_id, created_at DESC, id DESC)"),
    (
        "ix_test_runs_tenant_created",
        "test_runs",
        "(tenant_id, created_at DESC, id) WHERE deleted_at IS NULL",
    ),
    (
        "ix_test_runs_tenant_project",
        "test_runs",
        "(tenant_id, project_id) WHERE deleted_at IS NULL",
    ),
    # --- foreign keys used by filters / joins / cascades --------------------
    (
        "ix_defects_tenant_status",
        "defects",
        "(tenant_id, status) WHERE deleted_at IS NULL",
    ),
    (
        "ix_defects_tenant_test_case",
        "defects",
        "(tenant_id, test_case_id) WHERE test_case_id IS NOT NULL",
    ),
    (
        "ix_defects_tenant_test_run",
        "defects",
        "(tenant_id, test_run_id) WHERE test_run_id IS NOT NULL",
    ),
    (
        "ix_defects_tenant_assigned_to",
        "defects",
        "(tenant_id, assigned_to) WHERE assigned_to IS NOT NULL",
    ),
    ("ix_defects_tenant_reported_by", "defects", "(tenant_id, reported_by)"),
    (
        "ix_test_cases_tenant_assignee",
        "test_cases",
        "(tenant_id, assignee_id) WHERE assignee_id IS NOT NULL",
    ),
    (
        "ix_test_cases_tenant_module",
        "test_cases",
        "(tenant_id, module_id) WHERE module_id IS NOT NULL",
    ),
    (
        "ix_requirement_test_case_links_test_case",
        "requirement_test_case_links",
        "(test_case_id)",
    ),
    (
        "ix_execution_steps_version_step",
        "execution_steps",
        "(test_case_version_step_id)",
    ),
    # --- trigram (ILIKE '%term%') -------------------------------------------
    ("ix_test_cases_title_trgm", "test_cases", "USING gin (title gin_trgm_ops)"),
    ("ix_defects_title_trgm", "defects", "USING gin (title gin_trgm_ops)"),
    ("ix_requirements_title_trgm", "requirements", "USING gin (title gin_trgm_ops)"),
    ("ix_test_runs_name_trgm", "test_runs", "USING gin (name gin_trgm_ops)"),
]

# Exact duplicates of a UNIQUE index on the same single column (db_audit #12).
_DUPLICATES: list[tuple[str, str, str]] = [
    ("ix_sso_configs_tenant_id", "sso_configs", "(tenant_id)"),
    ("ix_subscriptions_tenant_id", "subscriptions", "(tenant_id)"),
]


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    with op.get_context().autocommit_block():
        for name, table, definition in _INDEXES:
            # A previously interrupted CONCURRENTLY build leaves an INVALID index
            # behind that IF NOT EXISTS would silently keep; drop it first.
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")
            op.execute(f"CREATE INDEX CONCURRENTLY {name} ON {table} {definition}")
        for name, _table, _definition in _DUPLICATES:
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")


def downgrade() -> None:
    with op.get_context().autocommit_block():
        for name, table, definition in _DUPLICATES:
            op.execute(f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {name} ON {table} {definition}")
        for name, _table, _definition in reversed(_INDEXES):
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")
