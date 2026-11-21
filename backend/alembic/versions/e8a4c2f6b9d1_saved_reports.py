"""ADR-098: saved_reports table

Revision ID: e8a4c2f6b9d1
Revises: d7f3b9a1c5e2
Create Date: 2026-11-23 10:00:00.000000
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "e8a4c2f6b9d1"
down_revision = "d7f3b9a1c5e2"
branch_labels = None
depends_on = None

APP_ROLE = "qtesthub_app"


def upgrade() -> None:
    op.create_table(
        "saved_reports",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("definition", postgresql.JSONB(), nullable=False),
        sa.Column("is_shared", sa.Boolean(), server_default=sa.text("false"), nullable=False),
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
        sa.CheckConstraint(
            "source in ('test_cases','test_runs','defects')", name="ck_saved_reports_source"
        ),
        sa.CheckConstraint("char_length(name) between 1 and 80", name="ck_saved_reports_name_len"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "name", name="uq_saved_reports_user_name"),
    )
    op.create_index(op.f("ix_saved_reports_tenant_id"), "saved_reports", ["tenant_id"])
    op.execute("ALTER TABLE saved_reports ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE saved_reports FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON saved_reports
        USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid)
        """
    )
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON saved_reports TO {APP_ROLE}")


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON saved_reports")
    op.drop_table("saved_reports")
