"""tenant RLS policies, audit log hardening, rbac seed data

ADR-007: Row-Level Security backstop for tenant isolation, keyed on the
session variable app.current_tenant set by the backend per request.

ADR-006: audit_logs is insert-only. The application connects as a
non-owner role (qtesthub_app) with UPDATE/DELETE revoked on that table;
only the migration/owner role can alter it.

ADR-014: roles/permissions seeded from the fixed BRD §3.2 matrix.

Revision ID: 7bca6b69ef88
Revises: f5d4daf618a8
Create Date: 2026-11-09 14:17:08.520820

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7bca6b69ef88'
down_revision: Union[str, None] = 'f5d4daf618a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TENANT_SCOPED_TABLES = [
    "users",
    "sessions",
    "mfa_challenges",
    "projects",
    "test_cases",
    "test_case_versions",
    "test_case_version_steps",
    "attachments",
    "test_runs",
    "test_run_cases",
    "execution_steps",
    "defects",
    "defect_links",
    "audit_logs",
]

ROLES = [
    ("admin", "Admin"),
    ("manager", "Manager"),
    ("tester", "Tester"),
]

PERMISSIONS = [
    ("user.manage", "Provision users and assign roles"),
    ("audit.view", "View tenant audit logs"),
    ("project.create", "Create projects"),
    ("project.edit", "Edit projects"),
    ("project.delete", "Delete projects"),
    ("project.members.manage", "Assign/unassign project team members"),
    ("testcase.create", "Author test cases"),
    ("testcase.edit", "Edit test cases"),
    ("testcase.delete", "Delete test cases"),
    ("testcase.approve", "Approve test cases for execution"),
    ("testcase.bulk_import_export", "Bulk import/export test cases via CSV"),
    ("testrun.create", "Create and launch test runs"),
    ("executionstep.record", "Record step execution verdicts and timings"),
    ("defect.create", "Log defects (standalone or in-run)"),
    ("defect.close", "Transition a defect to Closed"),
    ("report.view", "View executive reporting and charts"),
    ("report.compliance_export", "Export formal compliance reports"),
]

# BRD §3.2 RBAC matrix, condensed into permission codes.
ROLE_PERMISSIONS: dict[str, list[str]] = {
    "admin": [code for code, _ in PERMISSIONS],
    "manager": [
        "project.create",
        "project.edit",
        "project.delete",
        "project.members.manage",
        "testcase.create",
        "testcase.edit",
        "testcase.delete",
        "testcase.approve",
        "testcase.bulk_import_export",
        "testrun.create",
        "executionstep.record",
        "defect.create",
        "defect.close",
        "report.view",
        "report.compliance_export",
    ],
    "tester": [
        "testcase.create",
        "testcase.edit",
        "testcase.bulk_import_export",
        "testrun.create",
        "executionstep.record",
        "defect.create",
        "report.view",
    ],
}

APP_ROLE = "qtesthub_app"


def upgrade() -> None:
    # --- Least-privilege application role (ADR-006) ---
    op.execute(
        f"""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{APP_ROLE}') THEN
                CREATE ROLE {APP_ROLE} LOGIN PASSWORD 'qtesthub_app';
            END IF;
        END
        $$;
        """
    )
    op.execute(f"GRANT CONNECT ON DATABASE qtesthub TO {APP_ROLE}")
    op.execute(f"GRANT USAGE ON SCHEMA public TO {APP_ROLE}")
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {APP_ROLE}")
    op.execute(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {APP_ROLE}")
    op.execute(
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA public "
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {APP_ROLE}"
    )
    # Insert-only enforcement on the audit trail: the app role may append
    # and read, but never rewrite or erase history.
    op.execute(f"REVOKE UPDATE, DELETE ON audit_logs FROM {APP_ROLE}")

    # --- Row-Level Security (ADR-007) ---
    for table in TENANT_SCOPED_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"""
            CREATE POLICY tenant_isolation ON {table}
            USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
            WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid)
            """
        )

    # --- RBAC seed data (ADR-014, fixed set, no custom roles in this phase) ---
    conn = op.get_bind()

    role_ids: dict[str, str] = {}
    for code, name in ROLES:
        row = conn.execute(
            sa.text(
                "INSERT INTO roles (code, name) VALUES (:code, :name) "
                "ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name "
                "RETURNING id"
            ),
            {"code": code, "name": name},
        ).fetchone()
        role_ids[code] = row[0]

    permission_ids: dict[str, str] = {}
    for code, description in PERMISSIONS:
        row = conn.execute(
            sa.text(
                "INSERT INTO permissions (code, description) VALUES (:code, :description) "
                "ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description "
                "RETURNING id"
            ),
            {"code": code, "description": description},
        ).fetchone()
        permission_ids[code] = row[0]

    for role_code, perm_codes in ROLE_PERMISSIONS.items():
        for perm_code in perm_codes:
            conn.execute(
                sa.text(
                    "INSERT INTO role_permissions (role_id, permission_id) "
                    "VALUES (:role_id, :permission_id) ON CONFLICT DO NOTHING"
                ),
                {"role_id": role_ids[role_code], "permission_id": permission_ids[perm_code]},
            )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("DELETE FROM role_permissions"))
    conn.execute(sa.text("DELETE FROM permissions"))
    conn.execute(sa.text("DELETE FROM roles"))

    for table in TENANT_SCOPED_TABLES:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")

    op.execute(
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA public "
        f"REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM {APP_ROLE}"
    )
    op.execute(f"REVOKE ALL ON ALL TABLES IN SCHEMA public FROM {APP_ROLE}")
    op.execute(f"REVOKE ALL ON SCHEMA public FROM {APP_ROLE}")
    op.execute(f"REVOKE ALL ON DATABASE qtesthub FROM {APP_ROLE}")
