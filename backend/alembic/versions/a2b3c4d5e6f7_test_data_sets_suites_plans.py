"""add test_data_sets/rows, test_suites, test_plans (Pass 5 items 2/3)

Item 2 (parameterized execution): test_data_sets/test_data_set_rows hold
named parameter rows per test case; test_run_cases gains a nullable
test_data_row_id and its (test_run_id, test_case_id) unique constraint is
widened to include it -- Postgres treats NULL as distinct in a unique
constraint, so an un-parameterized case still can't be bundled twice,
preserving the original invariant exactly, while a parameterized case can
have one TestRunCase per selected data row.

Item 3 (test suites/plans): test_suites/test_suite_cases are a reusable
flat cross-module selection of test cases (distinct from TestModule's
hierarchical organization); test_plans/test_plan_runs group TestRuns under
a planning umbrella, optionally linked to a Release for traceability.

Revision ID: a2b3c4d5e6f7
Revises: 9f1e2d3c4b5a
Create Date: 2026-11-12 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'a2b3c4d5e6f7'
down_revision: Union[str, None] = '9f1e2d3c4b5a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

APP_ROLE = "qtesthub_app"


def _rls(table: str) -> None:
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
        'test_data_sets',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('test_case_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id']),
        sa.ForeignKeyConstraint(['test_case_id'], ['test_cases.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_test_data_sets_tenant_id'), 'test_data_sets', ['tenant_id'])
    op.create_index(op.f('ix_test_data_sets_test_case_id'), 'test_data_sets', ['test_case_id'])
    _rls('test_data_sets')

    op.create_table(
        'test_data_set_rows',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('test_data_set_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('data', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id']),
        sa.ForeignKeyConstraint(['test_data_set_id'], ['test_data_sets.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_test_data_set_rows_tenant_id'), 'test_data_set_rows', ['tenant_id'])
    op.create_index(op.f('ix_test_data_set_rows_test_data_set_id'), 'test_data_set_rows', ['test_data_set_id'])
    _rls('test_data_set_rows')

    op.add_column('test_run_cases', sa.Column('test_data_row_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        'fk_test_run_cases_test_data_row_id', 'test_run_cases', 'test_data_set_rows',
        ['test_data_row_id'], ['id'],
    )
    op.drop_constraint('uq_test_run_cases_run_case', 'test_run_cases', type_='unique')
    op.create_unique_constraint(
        'uq_test_run_cases_run_case_row', 'test_run_cases',
        ['test_run_id', 'test_case_id', 'test_data_row_id'],
    )

    op.create_table(
        'test_suites',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id']),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_test_suites_tenant_id'), 'test_suites', ['tenant_id'])
    op.create_index(op.f('ix_test_suites_project_id'), 'test_suites', ['project_id'])
    _rls('test_suites')

    op.create_table(
        'test_suite_cases',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('test_suite_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('test_case_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id']),
        sa.ForeignKeyConstraint(['test_suite_id'], ['test_suites.id']),
        sa.ForeignKeyConstraint(['test_case_id'], ['test_cases.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('test_suite_id', 'test_case_id', name='uq_test_suite_cases_suite_case'),
    )
    op.create_index(op.f('ix_test_suite_cases_tenant_id'), 'test_suite_cases', ['tenant_id'])
    _rls('test_suite_cases')

    op.create_table(
        'test_plans',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('release_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id']),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id']),
        sa.ForeignKeyConstraint(['release_id'], ['releases.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_test_plans_tenant_id'), 'test_plans', ['tenant_id'])
    op.create_index(op.f('ix_test_plans_project_id'), 'test_plans', ['project_id'])
    _rls('test_plans')

    op.create_table(
        'test_plan_runs',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('test_plan_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('test_run_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id']),
        sa.ForeignKeyConstraint(['test_plan_id'], ['test_plans.id']),
        sa.ForeignKeyConstraint(['test_run_id'], ['test_runs.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('test_plan_id', 'test_run_id', name='uq_test_plan_runs_plan_run'),
    )
    op.create_index(op.f('ix_test_plan_runs_tenant_id'), 'test_plan_runs', ['tenant_id'])
    _rls('test_plan_runs')


def downgrade() -> None:
    for t in ('test_plan_runs', 'test_plans', 'test_suite_cases', 'test_suites'):
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {t}")
        op.drop_table(t)

    op.drop_constraint('uq_test_run_cases_run_case_row', 'test_run_cases', type_='unique')
    op.create_unique_constraint(
        'uq_test_run_cases_run_case', 'test_run_cases', ['test_run_id', 'test_case_id'],
    )
    op.drop_constraint('fk_test_run_cases_test_data_row_id', 'test_run_cases', type_='foreignkey')
    op.drop_column('test_run_cases', 'test_data_row_id')

    for t in ('test_data_set_rows', 'test_data_sets'):
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {t}")
        op.drop_table(t)
