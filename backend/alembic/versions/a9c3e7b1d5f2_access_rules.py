"""ADR-092 / RBAC Phase 4: access_rules table + access_rule.manage permission

Tenant-configured time/environment access rules (release-freeze windows,
restricted environments). Off by default: no rows, no behaviour change.
RLS like every tenant table. Seeds `access_rule.manage` to the Admin role.
Idempotent seed, reversible.

Revision ID: a9c3e7b1d5f2
Revises: f8b2d6a4c0e1
Create Date: 2026-11-21 09:00:00.000000
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "a9c3e7b1d5f2"
down_revision = "f8b2d6a4c0e1"
branch_labels = None
depends_on = None

APP_ROLE = "qtesthub_app"
PERMISSION_CODE = "access_rule.manage"
PERMISSION_DESCRIPTION = "Manage release-freeze windows and environment access rules"


def upgrade() -> None:
    op.create_table(
        "access_rules",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("rule_type", sa.String(), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("environment", sa.String(), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("blocked_actions", postgresql.ARRAY(sa.String()), nullable=False),
        sa.Column(
            "exempt_roles",
            postgresql.ARRAY(sa.String()),
            server_default=sa.text("ARRAY['admin']::varchar[]"),
            nullable=False,
        ),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "rule_type IN ('freeze_window','environment_restriction')",
            name="ck_access_rules_rule_type",
        ),
    )
    op.create_index(op.f("ix_access_rules_tenant_id"), "access_rules", ["tenant_id"])
    op.create_index("ix_access_rules_tenant_enabled", "access_rules", ["tenant_id", "enabled"])

    op.execute("ALTER TABLE access_rules ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE access_rules FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON access_rules
        USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid)
        """
    )
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON access_rules TO {APP_ROLE}")

    conn = op.get_bind()
    permission_id = conn.execute(
        sa.text(
            "INSERT INTO permissions (code, description) VALUES (:code, :description) "
            "ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description "
            "RETURNING id"
        ),
        {"code": PERMISSION_CODE, "description": PERMISSION_DESCRIPTION},
    ).scalar_one()
    role_id = conn.execute(sa.text("SELECT id FROM roles WHERE code = 'admin'")).scalar_one()
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
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON access_rules")
    op.drop_index("ix_access_rules_tenant_enabled", table_name="access_rules")
    op.drop_index(op.f("ix_access_rules_tenant_id"), table_name="access_rules")
    op.drop_table("access_rules")
