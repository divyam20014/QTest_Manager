"""ADR-082: platform-level hash-chained audit trail

platform_audit_events records Platform Admin auth/admin events that were only
structured log lines before. Platform-level like platform_admins: no tenant, no
RLS. Insert-only for the app role (SELECT + INSERT; no UPDATE/DELETE), the same
posture as audit_logs. No FK to platform_admins so the trail outlives admin
changes. Idempotent and reversible.

Revision ID: c5e9a3b7d1f2
Revises: b4d8f2a6c1e9
Create Date: 2026-11-20 15:00:00.000000
"""

from alembic import op

revision = "c5e9a3b7d1f2"
down_revision = "b4d8f2a6c1e9"
branch_labels = None
depends_on = None

APP_ROLE = "qtesthub_app"


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS platform_audit_events (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            event_type VARCHAR NOT NULL,
            actor_admin_id UUID,
            actor_email VARCHAR,
            target_admin_id UUID,
            ip VARCHAR,
            outcome VARCHAR NOT NULL,
            details JSONB,
            prev_hash VARCHAR NOT NULL,
            record_hash VARCHAR NOT NULL,
            CONSTRAINT ck_platform_audit_events_outcome CHECK (outcome IN ('success','failure'))
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_platform_audit_events_created_at "
        "ON platform_audit_events (created_at, id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_platform_audit_events_event_type "
        "ON platform_audit_events (event_type)"
    )
    # Default privileges give the app role everything on a new table: make it insert-only.
    op.execute(f"GRANT SELECT, INSERT ON platform_audit_events TO {APP_ROLE}")
    op.execute(f"REVOKE UPDATE, DELETE, TRUNCATE ON platform_audit_events FROM {APP_ROLE}")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS platform_audit_events")
