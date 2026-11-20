"""ADR-085: signed audit-chain checkpoints (GAP-01)

audit_chain_checkpoints anchors the head of a hash chain (a tenant's audit_logs,
or the platform_audit_events chain) at a point in time and signs the anchor with
an HMAC key that lives outside the database. A whole-chain rewrite by someone
with database-owner rights then no longer verifies. Holds only hashes, counts
and ids (no audit content), so it has no RLS; tenant isolation is enforced in
the API by scope. No FK to tenants so a checkpoint outlives its tenant.
Insert-only for the app role (SELECT + INSERT; no UPDATE/DELETE/TRUNCATE), the
same posture as audit_logs and platform_audit_events. Idempotent and reversible.

Revision ID: e7a1c5d9b3f4
Revises: d6f0b4c8e2a3
Create Date: 2026-11-20 20:00:00.000000
"""

from alembic import op

revision = "e7a1c5d9b3f4"
down_revision = "d6f0b4c8e2a3"
branch_labels = None
depends_on = None

APP_ROLE = "qtesthub_app"


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS audit_chain_checkpoints (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            scope VARCHAR NOT NULL,
            last_record_id UUID NOT NULL,
            last_created_at TIMESTAMP WITH TIME ZONE NOT NULL,
            record_count INTEGER NOT NULL,
            head_hash VARCHAR NOT NULL,
            prev_checkpoint_hash VARCHAR NOT NULL,
            checkpoint_hash VARCHAR NOT NULL,
            signature VARCHAR NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT ck_audit_chain_checkpoints_scope
                CHECK (scope = 'platform' OR scope LIKE 'tenant:%')
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_audit_chain_checkpoints_scope_created "
        "ON audit_chain_checkpoints (scope, created_at, id)"
    )
    op.execute(f"GRANT SELECT, INSERT ON audit_chain_checkpoints TO {APP_ROLE}")
    op.execute(f"REVOKE UPDATE, DELETE, TRUNCATE ON audit_chain_checkpoints FROM {APP_ROLE}")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS audit_chain_checkpoints")
