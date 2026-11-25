"""ADR-127: task.manage, task.transition and task_status.manage permissions

task.manage         Admin, Manager   create / edit / move / delete tasks, link test cases
task.transition     Admin, Manager,  change the status of a task (a Tester only when they are
                    Tester           its assignee)
task_status.manage  Admin            configure the tenant's task statuses

Revision ID: c8e2a4b6d0f1
Revises: b7d1f3a5c9e2
Create Date: 2026-11-25 11:00:00.000000
"""

import sqlalchemy as sa

from alembic import op

revision = "c8e2a4b6d0f1"
down_revision = "b7d1f3a5c9e2"
branch_labels = None
depends_on = None

PERMISSIONS = (
    ("task.manage", "Create, edit, move, delete tasks and sub-tasks", "admin", "manager"),
    ("task.transition", "Change the status of a task", "admin", "manager", "tester"),
    ("task_status.manage", "Configure the tenant's task statuses", "admin"),
)


def upgrade() -> None:
    conn = op.get_bind()
    for code, description, *roles in PERMISSIONS:
        permission_id = conn.execute(
            sa.text(
                "INSERT INTO permissions (code, description) VALUES (:code, :description) "
                "ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description "
                "RETURNING id"
            ),
            {"code": code, "description": description},
        ).scalar_one()
        for role_code in roles:
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
    for code, *_ in PERMISSIONS:
        conn.execute(
            sa.text(
                "DELETE FROM role_permissions WHERE permission_id = "
                "(SELECT id FROM permissions WHERE code = :code)"
            ),
            {"code": code},
        )
        conn.execute(sa.text("DELETE FROM permissions WHERE code = :code"), {"code": code})
