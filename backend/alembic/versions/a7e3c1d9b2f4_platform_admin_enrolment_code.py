"""ADR-080: one-time enrolment code for first-time Platform Admin MFA enrolment

platform_admins gains enrolment_code_hash (SHA-256 of the normalised code,
never the plaintext) and enrolment_code_expires_at. Existing un-enrolled
admins get NO code (they cannot enrol until another admin or the operator CLI
issues one). platform_admins already carries the app role's table grant, so no
grant changes. Idempotent and reversible.

Revision ID: a7e3c1d9b2f4
Revises: 2665e09ed7e5
Create Date: 2026-11-20 09:00:00.000000
"""

from alembic import op

revision = "a7e3c1d9b2f4"
down_revision = "2665e09ed7e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE platform_admins ADD COLUMN IF NOT EXISTS enrolment_code_hash VARCHAR")
    op.execute(
        "ALTER TABLE platform_admins "
        "ADD COLUMN IF NOT EXISTS enrolment_code_expires_at TIMESTAMP WITH TIME ZONE"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE platform_admins DROP COLUMN IF EXISTS enrolment_code_expires_at")
    op.execute("ALTER TABLE platform_admins DROP COLUMN IF EXISTS enrolment_code_hash")
