"""ADR-127: tasks can own comments and attachments

Widens the polymorphic owner_type checks of ``comments`` and ``attachments`` with 'task'.

Revision ID: d1f4a6c8e0b3
Revises: c8e2a4b6d0f1
Create Date: 2026-11-25 14:00:00.000000
"""

from alembic import op

revision = "d1f4a6c8e0b3"
down_revision = "c8e2a4b6d0f1"
branch_labels = None
depends_on = None

OLD_COMMENT_OWNERS = "'test_case','defect','execution_step'"
OLD_ATTACHMENT_OWNERS = "'test_case','test_case_version','defect','execution_step','requirement'"


def _swap(table: str, name: str, owners: str) -> None:
    op.execute(f"ALTER TABLE {table} DROP CONSTRAINT {name}")
    op.execute(f"ALTER TABLE {table} ADD CONSTRAINT {name} CHECK (owner_type in ({owners}))")


def upgrade() -> None:
    _swap("comments", "ck_comments_owner_type", OLD_COMMENT_OWNERS + ",'task'")
    _swap("attachments", "ck_attachments_owner_type", OLD_ATTACHMENT_OWNERS + ",'task'")


def downgrade() -> None:
    op.execute("DELETE FROM comments WHERE owner_type = 'task'")
    op.execute("DELETE FROM attachments WHERE owner_type = 'task'")
    _swap("comments", "ck_comments_owner_type", OLD_COMMENT_OWNERS)
    _swap("attachments", "ck_attachments_owner_type", OLD_ATTACHMENT_OWNERS)
