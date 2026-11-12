"""add report_schedules table, report.schedule_manage permission (ADR-065)

Pass 4: recurring compliance-report email delivery. RLS-protected like any
ordinary tenant-owned config row (tenant_id always known from the
authenticated session before this table is ever queried) -- unlike
BackgroundJob/ServiceToken, nothing needs to resolve one of these rows
before a tenant context exists.

Revision ID: 7a8b9c0d1e2f
Revises: d9e0f1a2b3c4
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "7a8b9c0d1e2f"
down_revision: str | Sequence[str] | None = "d9e0f1a2b3c4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

APP_ROLE = "qtesthub_app"
PERMISSION_CODE = "report.schedule_manage"
PERMISSION_DESCRIPTION = "Create, edit, and delete scheduled report deliveries"
GRANTED_TO_ROLES = ["admin"]


def upgrade() -> None:
    op.create_table(
        "report_schedules",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("report_type", sa.String(), server_default="compliance", nullable=False),
        sa.Column("cadence", sa.String(), nullable=False),
        sa.Column("recipient_emails", postgresql.ARRAY(sa.String()), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.CheckConstraint("report_type in ('compliance')", name="ck_report_schedules_type"),
        sa.CheckConstraint(
            "cadence in ('daily','weekly','monthly')", name="ck_report_schedules_cadence"
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_report_schedules_tenant_id"), "report_schedules", ["tenant_id"], unique=False
    )
    op.execute("ALTER TABLE report_schedules ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE report_schedules FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON report_schedules
        USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid)
        """
    )
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON report_schedules TO {APP_ROLE}")

    conn = op.get_bind()
    permission_id = conn.execute(
        sa.text(
            "INSERT INTO permissions (code, description) VALUES (:code, :description) "
            "ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description "
            "RETURNING id"
        ),
        {"code": PERMISSION_CODE, "description": PERMISSION_DESCRIPTION},
    ).scalar_one()
    for role_code in GRANTED_TO_ROLES:
        role_id = conn.execute(
            sa.text("SELECT id FROM roles WHERE code = :code AND tenant_id IS NULL"),
            {"code": role_code},
        ).scalar_one()
        conn.execute(
            sa.text(
                "INSERT INTO role_permissions (role_id, permission_id) "
                "VALUES (:role_id, :permission_id) ON CONFLICT DO NOTHING"
            ),
            {"role_id": role_id, "permission_id": permission_id},
        )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "DELETE FROM role_permissions WHERE permission_id = "
            "(SELECT id FROM permissions WHERE code = :code)"
        ),
        {"code": PERMISSION_CODE},
    )
    conn.execute(sa.text("DELETE FROM permissions WHERE code = :code"), {"code": PERMISSION_CODE})
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON report_schedules")
    op.drop_table("report_schedules")
