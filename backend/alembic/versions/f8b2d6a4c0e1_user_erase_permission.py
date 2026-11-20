"""ADR-086: user.erase permission (GAP-03 personal-data erasure), Admin only

Seeds the `user.erase` permission and grants it to the system Admin role. No
schema change: the existing users.pseudonymized_at column is the erasure marker.
Idempotent and reversible.

Revision ID: f8b2d6a4c0e1
Revises: e7a1c5d9b3f4
Create Date: 2026-11-20 22:00:00.000000
"""

import sqlalchemy as sa

from alembic import op

revision = "f8b2d6a4c0e1"
down_revision = "e7a1c5d9b3f4"
branch_labels = None
depends_on = None

PERMISSION_CODE = "user.erase"
PERMISSION_DESCRIPTION = "Erase a user's personal data (irreversible anonymisation)"
GRANTED_TO_ROLES = ["admin"]


def upgrade() -> None:
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
