"""ADR-120: import_sessions, the server-side store behind preview-then-commit import

Revision ID: c7d1e5a9b3f2
Revises: b6e0c2a8d4f7
Create Date: 2026-11-30 09:00:00.000000

One additive table. A preview parses and validates an uploaded csv/xlsx without writing any
test case or defect; the parsed rows are kept here (gzip-compressed JSON) under an
unguessable id, scoped to tenant + user, until the commit or until ``expires_at``
(about 30 minutes). RLS and grants like every tenant table. Downgrade drops the table.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "c7d1e5a9b3f2"
down_revision: str | None = "b6e0c2a8d4f7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

APP_ROLE = "qtesthub_app"


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    op.create_table(
        "import_sessions",
        sa.Column("id", uuid, server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("tenant_id", uuid, nullable=False),
        sa.Column("user_id", uuid, nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("project_id", uuid, nullable=False),
        sa.Column("filename", sa.String(), nullable=True),
        sa.Column("status", sa.String(), server_default="pending", nullable=False),
        sa.Column("payload", sa.LargeBinary(), nullable=False),
        sa.Column("row_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("valid_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("error_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("kind in ('test_case','defect')", name="ck_import_sessions_kind"),
        sa.CheckConstraint(
            "status in ('pending','queued','committed')", name="ck_import_sessions_status"
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_import_sessions_tenant_id"), "import_sessions", ["tenant_id"])
    op.create_index(
        "ix_import_sessions_tenant_expires", "import_sessions", ["tenant_id", "expires_at"]
    )
    op.execute("ALTER TABLE import_sessions ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE import_sessions FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON import_sessions
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        """
    )
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON import_sessions TO {APP_ROLE}")


def downgrade() -> None:
    op.drop_table("import_sessions")
