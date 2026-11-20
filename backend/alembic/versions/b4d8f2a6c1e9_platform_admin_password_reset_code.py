"""ADR-081: one-time password-reset code for Platform Admins

platform_admins gains password_reset_code_hash (SHA-256 of the normalised code,
never the plaintext) and password_reset_code_expires_at. Existing admins get NO
code. platform_admins already carries the app role's table grant, so no grant
changes. Idempotent and reversible.

Revision ID: b4d8f2a6c1e9
Revises: a7e3c1d9b2f4
Create Date: 2026-11-20 12:00:00.000000
"""

from alembic import op

revision = "b4d8f2a6c1e9"
down_revision = "a7e3c1d9b2f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE platform_admins ADD COLUMN IF NOT EXISTS password_reset_code_hash VARCHAR"
    )
    op.execute(
        "ALTER TABLE platform_admins "
        "ADD COLUMN IF NOT EXISTS password_reset_code_expires_at TIMESTAMP WITH TIME ZONE"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE platform_admins DROP COLUMN IF EXISTS password_reset_code_expires_at")
    op.execute("ALTER TABLE platform_admins DROP COLUMN IF EXISTS password_reset_code_hash")
