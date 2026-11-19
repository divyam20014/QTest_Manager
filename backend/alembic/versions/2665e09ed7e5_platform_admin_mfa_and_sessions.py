"""ADR-074: Platform Admin TOTP MFA + server-side sessions

Replaces the HTTP Basic plane (ADR-052 deferral) with a real session and
TOTP MFA.

* platform_admins gains mfa_secret_encrypted (Fernet ciphertext, never the
  plaintext), mfa_enabled_at (NULL = not enrolled / pending), mfa_last_used_step
  (TOTP replay protection) and mfa_failed_count.
* platform_sessions: hashed-token sessions with an absolute expiry, last-seen
  time (idle timeout) and a stage ('password_ok' grants nothing,
  'mfa_verified' grants API access).
* platform_admin_recovery_codes: single-use, hashed recovery codes.

Platform tables are RLS-exempt like platform_admins; the app role gets the
same plain table-level grant and nothing more. Idempotent and reversible.

Revision ID: 2665e09ed7e5
Revises: c9d0e1f2a3b4
Create Date: 2026-11-18 09:00:00.000000
"""

from alembic import op

revision = "2665e09ed7e5"
down_revision = "c9d0e1f2a3b4"
branch_labels = None
depends_on = None

APP_ROLE = "qtesthub_app"


def upgrade() -> None:
    op.execute(
        "ALTER TABLE platform_admins ADD COLUMN IF NOT EXISTS mfa_secret_encrypted VARCHAR"
    )
    op.execute(
        "ALTER TABLE platform_admins "
        "ADD COLUMN IF NOT EXISTS mfa_enabled_at TIMESTAMP WITH TIME ZONE"
    )
    op.execute("ALTER TABLE platform_admins ADD COLUMN IF NOT EXISTS mfa_last_used_step BIGINT")
    op.execute(
        "ALTER TABLE platform_admins ADD COLUMN IF NOT EXISTS mfa_failed_count SMALLINT "
        "NOT NULL DEFAULT 0"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS platform_sessions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            admin_id UUID NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE,
            token_hash VARCHAR NOT NULL UNIQUE,
            stage VARCHAR NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
            last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            mfa_verified_at TIMESTAMP WITH TIME ZONE,
            revoked_at TIMESTAMP WITH TIME ZONE,
            ip_address VARCHAR,
            user_agent VARCHAR,
            CONSTRAINT ck_platform_sessions_stage CHECK (stage IN ('password_ok','mfa_verified'))
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_platform_sessions_admin_id ON platform_sessions (admin_id)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS platform_admin_recovery_codes (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            admin_id UUID NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE,
            code_hash VARCHAR NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            used_at TIMESTAMP WITH TIME ZONE
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_platform_admin_recovery_codes_admin_id "
        "ON platform_admin_recovery_codes (admin_id)"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_admin_recovery_codes_admin_hash "
        "ON platform_admin_recovery_codes (admin_id, code_hash)"
    )

    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON platform_sessions TO {APP_ROLE}")
    op.execute(
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON platform_admin_recovery_codes TO {APP_ROLE}"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS platform_admin_recovery_codes")
    op.execute("DROP TABLE IF EXISTS platform_sessions")
    op.execute("ALTER TABLE platform_admins DROP COLUMN IF EXISTS mfa_failed_count")
    op.execute("ALTER TABLE platform_admins DROP COLUMN IF EXISTS mfa_last_used_step")
    op.execute("ALTER TABLE platform_admins DROP COLUMN IF EXISTS mfa_enabled_at")
    op.execute("ALTER TABLE platform_admins DROP COLUMN IF EXISTS mfa_secret_encrypted")
