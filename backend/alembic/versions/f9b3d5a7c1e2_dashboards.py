"""ADR-099: dashboards and dashboard_widgets tables

Revision ID: f9b3d5a7c1e2
Revises: e8a4c2f6b9d1
Create Date: 2026-11-24 10:00:00.000000
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "f9b3d5a7c1e2"
down_revision = "e8a4c2f6b9d1"
branch_labels = None
depends_on = None

APP_ROLE = "qtesthub_app"
_POLICY = """
CREATE POLICY tenant_isolation ON {t}
USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
"""


def _pk() -> sa.Column:
    return sa.Column(
        "id",
        postgresql.UUID(as_uuid=True),
        server_default=sa.text("gen_random_uuid()"),
        nullable=False,
    )


def upgrade() -> None:
    op.create_table(
        "dashboards",
        _pk(),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("is_team_default", sa.Boolean(), server_default=sa.text("false"), nullable=False),
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
        sa.CheckConstraint("char_length(name) between 1 and 60", name="ck_dashboards_name_len"),
        sa.CheckConstraint(
            "(is_team_default and owner_user_id is null) or "
            "(not is_team_default and owner_user_id is not null)",
            name="ck_dashboards_owner_vs_default",
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_dashboards_tenant_id"), "dashboards", ["tenant_id"])
    op.create_index("ix_dashboards_owner", "dashboards", ["owner_user_id"])
    op.create_index(
        "uq_dashboards_one_team_default",
        "dashboards",
        ["tenant_id"],
        unique=True,
        postgresql_where=sa.text("is_team_default"),
    )
    op.create_table(
        "dashboard_widgets",
        _pk(),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("dashboard_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("widget_type", sa.String(length=40), nullable=False),
        sa.Column("size", sa.String(length=1), server_default=sa.text("'M'"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column(
            "settings",
            postgresql.JSONB(),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.CheckConstraint("size in ('S','M','L')", name="ck_dashboard_widgets_size"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["dashboard_id"], ["dashboards.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_dashboard_widgets_tenant_id"), "dashboard_widgets", ["tenant_id"])
    op.create_index(
        "ix_dashboard_widgets_dashboard", "dashboard_widgets", ["dashboard_id", "position"]
    )
    for table in ("dashboards", "dashboard_widgets"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(_POLICY.format(t=table))
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO {APP_ROLE}")


def downgrade() -> None:
    for table in ("dashboard_widgets", "dashboards"):
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.drop_table(table)
