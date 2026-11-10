"""add test_modules (PV-7.3) and test case review workflow (Tier 3)

Adds `test_modules` (module/folder-level grouping, self-referential for
nesting, RLS-protected) plus `test_cases.module_id`, and
`test_cases.reviewer_id` for the new reviewer-assignment half of the
review-request/approval workflow (the draft/ready_for_review/approved
status machine itself already existed -- this only adds who the review
is addressed to).

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-11-10 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'b8c9d0e1f2a3'
down_revision: Union[str, None] = 'a7b8c9d0e1f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

APP_ROLE = "qtesthub_app"


def upgrade() -> None:
    op.create_table(
        'test_modules',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('parent_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id']),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id']),
        sa.ForeignKeyConstraint(['parent_id'], ['test_modules.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('project_id', 'parent_id', 'name', name='uq_test_modules_sibling_name'),
    )
    op.create_index(op.f('ix_test_modules_tenant_id'), 'test_modules', ['tenant_id'], unique=False)
    op.execute("ALTER TABLE test_modules ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE test_modules FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON test_modules
        USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid)
        """
    )
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON test_modules TO {APP_ROLE}")

    op.add_column('test_cases', sa.Column('module_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key('fk_test_cases_module_id', 'test_cases', 'test_modules', ['module_id'], ['id'])

    op.add_column('test_cases', sa.Column('reviewer_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key('fk_test_cases_reviewer_id', 'test_cases', 'users', ['reviewer_id'], ['id'])

    # Extend notifications.type for the new review_requested/review_decided
    # trigger types (still a bounded, named list -- not a generic rules
    # engine, per ADR-051).
    op.drop_constraint('ck_notifications_type', 'notifications', type_='check')
    op.create_check_constraint(
        'ck_notifications_type',
        'notifications',
        "type in ('mention','test_case_assigned','defect_closed',"
        "'review_requested','review_decided')",
    )


def downgrade() -> None:
    op.drop_constraint('ck_notifications_type', 'notifications', type_='check')
    op.create_check_constraint(
        'ck_notifications_type',
        'notifications',
        "type in ('mention','test_case_assigned','defect_closed')",
    )

    op.drop_constraint('fk_test_cases_reviewer_id', 'test_cases', type_='foreignkey')
    op.drop_column('test_cases', 'reviewer_id')

    op.drop_constraint('fk_test_cases_module_id', 'test_cases', type_='foreignkey')
    op.drop_column('test_cases', 'module_id')

    op.execute("DROP POLICY IF EXISTS tenant_isolation ON test_modules")
    op.drop_table('test_modules')
