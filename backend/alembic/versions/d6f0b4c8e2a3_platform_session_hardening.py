"""ADR-083: Platform Admin session hardening columns

platform_sessions gains ua_hash (SHA-256 of the sign-in User-Agent, for session
binding) and step_up_at (last TOTP / recovery-code verification, for sensitive
actions). Idempotent and reversible. Existing sessions keep NULL ua_hash, which
skips the binding check for them until they expire.

Revision ID: d6f0b4c8e2a3
Revises: c5e9a3b7d1f2
Create Date: 2026-11-20 18:00:00.000000
"""

from alembic import op

revision = "d6f0b4c8e2a3"
down_revision = "c5e9a3b7d1f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE platform_sessions ADD COLUMN IF NOT EXISTS ua_hash VARCHAR")
    op.execute(
        "ALTER TABLE platform_sessions ADD COLUMN IF NOT EXISTS step_up_at TIMESTAMP WITH TIME ZONE"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE platform_sessions DROP COLUMN IF EXISTS step_up_at")
    op.execute("ALTER TABLE platform_sessions DROP COLUMN IF EXISTS ua_hash")
