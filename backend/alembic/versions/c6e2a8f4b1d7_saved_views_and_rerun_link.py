"""ADR-096: saved_views table and test_runs.original_run_id

Revision ID: c6e2a8f4b1d7
Revises: b1d4f7a2c9e3
Create Date: 2026-11-22 10:00:00.000000
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "c6e2a8f4b1d7"
down_revision = "b1d4f7a2c9e3"
branch_labels = None
depends_on = None

APP_ROLE = "qtesthub_app"


def upgrade() -> None:
    op.add_column(
        "test_runs",
        sa.Column("original_run_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_test_runs_original_run_id", "test_runs", "test_runs", ["original_run_id"], ["id"]
    )

    op.create_table(
        "saved_views",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("list_key", sa.String(), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column(
            "filters",
            postgresql.JSONB(),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("sort", sa.String(length=50), nullable=True),
        sa.Column("is_default", sa.Boolean(), server_default=sa.text("false"), nullable=False),
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
            "list_key in ('test_cases','defects','test_runs')", name="ck_saved_views_list_key"
        ),
        sa.CheckConstraint("char_length(name) between 1 and 60", name="ck_saved_views_name_len"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "list_key", "name", name="uq_saved_views_user_list_name"),
    )
    op.create_index(op.f("ix_saved_views_tenant_id"), "saved_views", ["tenant_id"], unique=False)
    op.create_index(
        "uq_saved_views_one_default",
        "saved_views",
        ["user_id", "list_key"],
        unique=True,
        postgresql_where=sa.text("is_default"),
    )
    op.execute("ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE saved_views FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON saved_views
        USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid)
        """
    )
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON saved_views TO {APP_ROLE}")


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON saved_views")
    op.drop_table("saved_views")
    op.drop_constraint("fk_test_runs_original_run_id", "test_runs", type_="foreignkey")
    op.drop_column("test_runs", "original_run_id")
