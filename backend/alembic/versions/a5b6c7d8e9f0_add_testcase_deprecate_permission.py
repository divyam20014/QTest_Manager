"""add testcase.deprecate permission for admin and manager

Revision ID: a5b6c7d8e9f0
Revises: f4a5b6c7d8e9
Create Date: 2026-11-10 09:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a5b6c7d8e9f0'
down_revision: Union[str, None] = 'f4a5b6c7d8e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PERMISSION_CODE = "testcase.deprecate"
PERMISSION_DESCRIPTION = "Deprecate a test case, removing it from active authoring use"
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
