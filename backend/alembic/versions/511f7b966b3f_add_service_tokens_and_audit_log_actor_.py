"""add service_tokens table, audit_logs.service_token_id, integration.manage permission (ADR-059)

Machine-to-machine auth plane (PV-5, GAP-73): per-tenant bearer tokens for
CI/CD result ingestion, separate from the human session-cookie plane
(ADR-007) and the platform-admin HTTP-Basic plane (ADR-008). Mirrors
scim_tokens (ADR-054) exactly -- hashed at rest, RLS-protected like any
ordinary tenant-owned table since tenant_id is always already known (a
path parameter on every CI webhook route) before this table is queried.

audit_logs.service_token_id mirrors platform_admin_id (ADR-052): a third,
distinct actor plane needing its own individual attribution in the audit
trail, same reasoning, same "exactly one of the three, never more than
one" invariant.

Revision ID: 511f7b966b3f
Revises: e6f7a8b9c0d1
Create Date: 2026-11-11 04:27:30.832225

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '511f7b966b3f'
down_revision: Union[str, None] = 'e6f7a8b9c0d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

APP_ROLE = "qtesthub_app"
PERMISSION_CODE = "integration.manage"
PERMISSION_DESCRIPTION = "Create, view, and revoke service tokens for CI/CD integrations"
GRANTED_TO_ROLES = ["admin"]


def upgrade() -> None:
    op.create_table(
        'service_tokens',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('token_hash', sa.String(), nullable=False),
        sa.Column('scope', sa.String(), server_default='ci_results', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_service_tokens_tenant_id'), 'service_tokens', ['tenant_id'], unique=False)
    op.execute("ALTER TABLE service_tokens ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE service_tokens FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON service_tokens
        USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid)
        """
    )
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON service_tokens TO {APP_ROLE}")

    op.add_column(
        'audit_logs',
        sa.Column('service_token_id', postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        'fk_audit_logs_service_token_id',
        'audit_logs',
        'service_tokens',
        ['service_token_id'],
        ['id'],
    )

    conn = op.get_bind()
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

    op.drop_constraint('fk_audit_logs_service_token_id', 'audit_logs', type_='foreignkey')
    op.drop_column('audit_logs', 'service_token_id')

    op.execute("DROP POLICY IF EXISTS tenant_isolation ON service_tokens")
    op.drop_table('service_tokens')
