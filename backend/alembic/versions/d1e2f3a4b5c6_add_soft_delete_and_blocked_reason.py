"""BRD gap Phase 2: soft delete for test runs/defects, blocked-case reason

Adds:
  * test_runs.deleted_at / deleted_by   -- soft delete (restore is a manual DB
    operation today; see ADR-070)
  * defects.deleted_at / deleted_by     -- soft delete
  * test_run_cases.blocked_reason       -- required reason when a case is
    marked Blocked (the 'blocked' status already existed in
    ck_test_run_cases_status but nothing could record it)
  * permissions testrun.delete and defect.delete (admin + manager only)

New columns on existing tables are covered by the table-level grants and RLS
policies those tables already carry for qtesthub_app, so no GRANT/POLICY
changes are needed.

Revision ID: d1e2f3a4b5c6
Revises: e7f8a9b0c1d2
Create Date: 2026-11-16 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "d1e2f3a4b5c6"
down_revision: Union[str, None] = "e7f8a9b0c1d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PERMISSIONS = [
    ("testrun.delete", "Delete (soft-delete) a test run", ["admin", "manager"]),
    ("defect.delete", "Delete (soft-delete) a defect", ["admin", "manager"]),
]


def upgrade() -> None:
    for table in ("test_runs", "defects"):
        op.add_column(table, sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
        op.add_column(
            table,
            sa.Column(
                "deleted_by",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id"),
                nullable=True,
            ),
        )
    op.add_column("test_run_cases", sa.Column("blocked_reason", sa.Text(), nullable=True))

    conn = op.get_bind()
    for code, description, roles in PERMISSIONS:
        permission_id = conn.execute(
            sa.text(
                "INSERT INTO permissions (code, description) VALUES (:code, :description) "
                "ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description "
                "RETURNING id"
            ),
            {"code": code, "description": description},
        ).scalar_one()
        for role_code in roles:
            role_id = conn.execute(
                sa.text("SELECT id FROM roles WHERE code = :code AND tenant_id IS NULL"),
                {"code": role_code},
            ).scalar_one_or_none()
            if role_id is None:
                continue
            conn.execute(
                sa.text(
                    "INSERT INTO role_permissions (role_id, permission_id) "
                    "VALUES (:role_id, :permission_id) ON CONFLICT DO NOTHING"
                ),
                {"role_id": role_id, "permission_id": permission_id},
            )


def downgrade() -> None:
    conn = op.get_bind()
    for code, _description, _roles in PERMISSIONS:
        conn.execute(
            sa.text(
                "DELETE FROM role_permissions WHERE permission_id = "
                "(SELECT id FROM permissions WHERE code = :code)"
            ),
            {"code": code},
        )
        conn.execute(sa.text("DELETE FROM permissions WHERE code = :code"), {"code": code})

    op.drop_column("test_run_cases", "blocked_reason")
    for table in ("defects", "test_runs"):
        op.drop_column(table, "deleted_by")
        op.drop_column(table, "deleted_at")
