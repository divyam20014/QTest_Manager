"""add testrun.finish permission for manager and admin (ADR-022)

Revision ID: 371d11097f58
Revises: 567fa7545de9
Create Date: 2026-11-09 15:37:06.035017

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '371d11097f58'
down_revision: Union[str, None] = '567fa7545de9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PERMISSION_CODE = "testrun.finish"
PERMISSION_DESCRIPTION = "Finish a test run, locking its final verdicts"
GRANTED_TO_ROLES = ["admin", "manager"]


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
