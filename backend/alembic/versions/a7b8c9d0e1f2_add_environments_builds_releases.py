"""add Environment/Build/Release entities (Tier 2, PV-8.1/8.2)

Promotes Defect.environment from free text to a real, reusable
`environments` entity (tenant-wide), and introduces `builds`/`releases`
for simple build/release tracking against defects. The free-text
`defects.environment` column is kept, nullable, as a transition aid --
not hard-dropped -- while `environment_id` becomes the forward path.
Existing distinct free-text values are backfilled into `environments`
rows per tenant, non-destructively.

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-11-10 17:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'a7b8c9d0e1f2'
down_revision: Union[str, None] = 'f6a7b8c9d0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

APP_ROLE = "qtesthub_app"
PERMISSION_CODE = "environment.manage"
PERMISSION_DESCRIPTION = "Create/update/delete Environments, Builds, and Releases"
GRANTED_TO_ROLES = ["admin", "manager"]


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
        'environments',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_environments_tenant_id'), 'environments', ['tenant_id'], unique=False)
    op.create_index(
        'uq_environments_tenant_name_ci', 'environments', ['tenant_id', sa.text('lower(name)')], unique=True
    )
    _rls('environments')

    op.create_table(
        'builds',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('built_at', sa.Date(), nullable=True),
        sa.Column('notes', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id']),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_builds_tenant_id'), 'builds', ['tenant_id'], unique=False)
    _rls('builds')

    op.create_table(
        'releases',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('release_date', sa.Date(), nullable=True),
        sa.Column('notes', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id']),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_releases_tenant_id'), 'releases', ['tenant_id'], unique=False)
    _rls('releases')

    op.add_column('defects', sa.Column('environment_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('defects', sa.Column('found_in_build_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('defects', sa.Column('fixed_in_release_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key('fk_defects_environment_id', 'defects', 'environments', ['environment_id'], ['id'])
    op.create_foreign_key('fk_defects_found_in_build_id', 'defects', 'builds', ['found_in_build_id'], ['id'])
    op.create_foreign_key(
        'fk_defects_fixed_in_release_id', 'defects', 'releases', ['fixed_in_release_id'], ['id']
    )

    # Backfill: one Environment row per tenant per distinct non-blank
    # free-text value, then point existing defects at it.
    conn = op.get_bind()
    conn.execute(
        sa.text(
            """
            INSERT INTO environments (tenant_id, name)
            SELECT DISTINCT tenant_id, environment
            FROM defects
            WHERE environment IS NOT NULL AND btrim(environment) <> ''
            ON CONFLICT DO NOTHING
            """
        )
    )
    conn.execute(
        sa.text(
            """
            UPDATE defects d
            SET environment_id = e.id
            FROM environments e
            WHERE e.tenant_id = d.tenant_id
              AND lower(e.name) = lower(d.environment)
              AND d.environment IS NOT NULL
              AND btrim(d.environment) <> ''
            """
        )
    )

    # New permission for CRUD on these entities.
    permission_id = conn.execute(
        sa.text(
            "INSERT INTO permissions (code, description) VALUES (:code, :description) "
            "ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description "
            "RETURNING id"
        ),
        {"code": PERMISSION_CODE, "description": PERMISSION_DESCRIPTION},
    ).scalar_one()
    for role_code in GRANTED_TO_ROLES:
        role_id = conn.execute(
            sa.text("SELECT id FROM roles WHERE code = :code"), {"code": role_code}
        ).scalar_one()
        conn.execute(
            sa.text(
                "INSERT INTO role_permissions (role_id, permission_id) "
                "VALUES (:role_id, :permission_id) ON CONFLICT DO NOTHING"
            ),
            {"role_id": role_id, "permission_id": permission_id},
        )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "DELETE FROM role_permissions WHERE permission_id = "
            "(SELECT id FROM permissions WHERE code = :code)"
        ),
        {"code": PERMISSION_CODE},
    )
    conn.execute(sa.text("DELETE FROM permissions WHERE code = :code"), {"code": PERMISSION_CODE})

    op.drop_constraint('fk_defects_fixed_in_release_id', 'defects', type_='foreignkey')
    op.drop_constraint('fk_defects_found_in_build_id', 'defects', type_='foreignkey')
    op.drop_constraint('fk_defects_environment_id', 'defects', type_='foreignkey')
    op.drop_column('defects', 'fixed_in_release_id')
    op.drop_column('defects', 'found_in_build_id')
    op.drop_column('defects', 'environment_id')

    op.execute("DROP POLICY IF EXISTS tenant_isolation ON releases")
    op.drop_table('releases')
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON builds")
    op.drop_table('builds')
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON environments")
    op.drop_table('environments')
