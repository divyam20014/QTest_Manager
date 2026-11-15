"""Add project-scoped role override to project_members (RBAC Phase 1).

Closes the confirmed project-level-permission gap: a project member can now
optionally be assigned a role that overrides their tenant-wide role for
actions scoped to that one project. Nullable, defaults to NULL for every
existing row, so no existing user's effective permissions change until an
admin/manager explicitly sets an override.

Revision ID: d6e7f8a9b0c1
Revises: a1b2c3d4e5f7
Create Date: 2026-11-15
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "d6e7f8a9b0c1"
down_revision = "a1b2c3d4e5f7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "project_members",
        sa.Column("role_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_project_members_role_id_roles",
        "project_members",
        "roles",
        ["role_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_project_members_role_id", "project_members", ["role_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_project_members_role_id", table_name="project_members")
    op.drop_constraint(
        "fk_project_members_role_id_roles", "project_members", type_="foreignkey"
    )
    op.drop_column("project_members", "role_id")
