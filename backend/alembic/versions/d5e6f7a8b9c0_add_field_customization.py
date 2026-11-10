"""add tenant-configurable severities/priorities, status labels, custom fields (Tier 5, PV-9.5/9.6)

- `field_options`: replaces the fixed CheckConstraint on Defect.severity /
  TestCase.priority with per-tenant, admin-configurable value sets. Every
  existing tenant is backfilled with the same four defaults
  (Low/Medium/High/Critical) that were previously hardcoded, so nothing
  changes for anyone until an admin acts. New tenants get the same seed via
  `field_option_service.seed_defaults_for_tenant`, called from
  `platform_service.create_tenant_with_admin`.
- `status_labels`: additive display-label overrides only -- the fixed
  status codes and their transition logic (ADR-026, Tier 2's reopen
  counter, Tier 3's review workflow) are untouched. See ADR-055.
- `custom_field_definitions` / `custom_field_values`: a genuine tenant
  custom-field system for test cases, defects, and requirements, using the
  existing owner_type/owner_id polymorphic pattern.

Revision ID: d5e6f7a8b9c0
Revises: c5d6e7f8a9b0
Create Date: 2026-11-11 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'd5e6f7a8b9c0'
down_revision: Union[str, None] = 'c5d6e7f8a9b0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

APP_ROLE = "qtesthub_app"
PERMISSION_CODE = "field_customization.manage"
PERMISSION_DESCRIPTION = (
    "Manage tenant severity/priority options, status display labels, and custom field definitions"
)
GRANTED_TO_ROLES = ["admin", "manager"]

DEFAULT_OPTIONS = ["Low", "Medium", "High", "Critical"]


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
        'field_options',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('field_key', sa.String(), nullable=False),
        sa.Column('code', sa.String(), nullable=False),
        sa.Column('label', sa.String(), nullable=False),
        sa.Column('color', sa.String(), nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("field_key in ('defect_severity','test_case_priority')", name='ck_field_options_field_key'),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tenant_id', 'field_key', 'code', name='uq_field_options_tenant_key_code'),
    )
    op.create_index(op.f('ix_field_options_tenant_id'), 'field_options', ['tenant_id'], unique=False)
    _rls('field_options')

    op.create_table(
        'status_labels',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('entity_type', sa.String(), nullable=False),
        sa.Column('status_code', sa.String(), nullable=False),
        sa.Column('label', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("entity_type in ('test_case','defect')", name='ck_status_labels_entity_type'),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tenant_id', 'entity_type', 'status_code', name='uq_status_labels_tenant_entity_code'),
    )
    op.create_index(op.f('ix_status_labels_tenant_id'), 'status_labels', ['tenant_id'], unique=False)
    _rls('status_labels')

    op.create_table(
        'custom_field_definitions',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('entity_type', sa.String(), nullable=False),
        sa.Column('field_key', sa.String(), nullable=False),
        sa.Column('label', sa.String(), nullable=False),
        sa.Column('field_type', sa.String(), nullable=False),
        sa.Column('options', sa.JSON(), nullable=True),
        sa.Column('required', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint(
            "entity_type in ('test_case','defect','requirement')",
            name='ck_custom_field_definitions_entity_type',
        ),
        sa.CheckConstraint(
            "field_type in ('text','number','boolean','date','select','multi_select')",
            name='ck_custom_field_definitions_field_type',
        ),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tenant_id', 'entity_type', 'field_key', name='uq_custom_field_definitions_tenant_key'),
    )
    op.create_index(
        op.f('ix_custom_field_definitions_tenant_id'), 'custom_field_definitions', ['tenant_id'], unique=False
    )
    _rls('custom_field_definitions')

    op.create_table(
        'custom_field_values',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('field_definition_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('owner_type', sa.String(), nullable=False),
        sa.Column('owner_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('value', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint(
            "owner_type in ('test_case','defect','requirement')", name='ck_custom_field_values_owner_type'
        ),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id']),
        sa.ForeignKeyConstraint(['field_definition_id'], ['custom_field_definitions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('field_definition_id', 'owner_id', name='uq_custom_field_values_def_owner'),
    )
    op.create_index(
        op.f('ix_custom_field_values_tenant_id'), 'custom_field_values', ['tenant_id'], unique=False
    )
    _rls('custom_field_values')

    # Drop the fixed CheckConstraints on severity/priority -- both are now
    # validated at the service layer against each tenant's `field_options`.
    op.drop_constraint('ck_defects_severity', 'defects', type_='check')
    op.drop_constraint('ck_test_cases_priority', 'test_cases', type_='check')

    conn = op.get_bind()

    # Seed every existing tenant with the same four defaults that used to
    # be hardcoded, for both value sets, preserving today's display order.
    for field_key in ("defect_severity", "test_case_priority"):
        for order, code in enumerate(DEFAULT_OPTIONS):
            conn.execute(
                sa.text(
                    """
                    INSERT INTO field_options (tenant_id, field_key, code, label, sort_order)
                    SELECT id, :field_key, :code, :code, :sort_order FROM tenants
                    ON CONFLICT DO NOTHING
                    """
                ),
                {"field_key": field_key, "code": code, "sort_order": order},
            )

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

    op.create_check_constraint(
        'ck_test_cases_priority', 'test_cases', "priority in ('Low','Medium','High','Critical')"
    )
    op.create_check_constraint(
        'ck_defects_severity', 'defects', "severity in ('Low','Medium','High','Critical')"
    )

    op.execute("DROP POLICY IF EXISTS tenant_isolation ON custom_field_values")
    op.drop_table('custom_field_values')
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON custom_field_definitions")
    op.drop_table('custom_field_definitions')
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON status_labels")
    op.drop_table('status_labels')
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON field_options")
    op.drop_table('field_options')
