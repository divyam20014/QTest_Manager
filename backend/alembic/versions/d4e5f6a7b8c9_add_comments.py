"""add Comments (Phase 8: comments + mentions, reusing the Attachment
polymorphic owner_type pattern)

AI/SaaS vision roadmap Phase 8 (PV-9.1, GAP-74): a polymorphic `comments`
table (same owner_type taxonomy as `attachments`: test_case/defect/
execution_step) plus a `comment_mentions` join table for @-mentions, kept
relational rather than a JSONB list so Phase 9's real notifications can
later query "mentions for user X" directly. No new permission -- commenting
reuses each owner type's own existing project-access check (same dispatcher
Phase 7's attachment wiring already established).

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-11-10 17:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

APP_ROLE = "qtesthub_app"
TENANT_SCOPED_TABLES = ["comments", "comment_mentions"]


def _apply_rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(
        f"""
        CREATE POLICY tenant_isolation ON {table}
        USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid)
        """
    )
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO {APP_ROLE}")


def upgrade() -> None:
    op.create_table(
        'comments',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('owner_type', sa.String(), nullable=False),
        sa.Column('owner_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('body', sa.String(), nullable=False),
        sa.Column('author_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("owner_type in ('test_case','defect','execution_step')", name='ck_comments_owner_type'),
        sa.CheckConstraint('char_length(body) >= 1', name='ck_comments_body_len'),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id']),
        sa.ForeignKeyConstraint(['author_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_comments_tenant_id'), 'comments', ['tenant_id'], unique=False)
    op.create_index('ix_comments_owner', 'comments', ['owner_type', 'owner_id'], unique=False)

    op.create_table(
        'comment_mentions',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('comment_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id']),
        sa.ForeignKeyConstraint(['comment_id'], ['comments.id']),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_comment_mentions_tenant_id'), 'comment_mentions', ['tenant_id'], unique=False)
    op.create_index('ix_comment_mentions_user_id', 'comment_mentions', ['user_id'], unique=False)

    for table in TENANT_SCOPED_TABLES:
        _apply_rls(table)


def downgrade() -> None:
    for table in reversed(TENANT_SCOPED_TABLES):
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
    op.drop_table('comment_mentions')
    op.drop_table('comments')
