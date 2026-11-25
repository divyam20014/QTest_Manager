"""ADR-128: every requirement belongs to a task

The project-level Requirements section is folded into the tasks: requirements are created and
managed on their task. A requirement that has no task yet is filed under a per-project
"Unassigned requirements" task (``tasks.is_requirements_home``) and ``requirements.task_id`` becomes
NOT NULL.

Revision ID: e2f5b7c9d1a3
Revises: d1f4a6c8e0b3
Create Date: 2026-11-26 09:00:00.000000
"""

import sqlalchemy as sa

from alembic import op

revision = "e2f5b7c9d1a3"
down_revision = "d1f4a6c8e0b3"
branch_labels = None
depends_on = None

HOME_TITLE = "Unassigned requirements"
HOME_DESCRIPTION = (
    "Requirements that are not part of a task yet. Open each one and move it to the task it "
    "belongs to."
)


def upgrade() -> None:
    op.add_column(
        "tasks",
        sa.Column(
            "is_requirements_home", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
    )
    # At most one live home task per project.
    op.create_index(
        "uq_tasks_requirements_home",
        "tasks",
        ["project_id"],
        unique=True,
        postgresql_where=sa.text("is_requirements_home and deleted_at is null"),
    )

    # One home task per project that has requirements without a task. TASK_ numbers continue the
    # tenant's counter, in project order, so they never collide with existing tasks.
    op.execute(
        sa.text(
            """
            WITH needy AS (
                SELECT r.tenant_id, r.project_id, (array_agg(r.created_by))[1] AS created_by
                FROM requirements r
                WHERE r.task_id IS NULL
                GROUP BY r.tenant_id, r.project_id
            ), numbered AS (
                SELECT n.*,
                       row_number() OVER (PARTITION BY n.tenant_id ORDER BY n.project_id) AS rn,
                       COALESCE((SELECT c.next_value FROM entity_counters c
                                 WHERE c.tenant_id = n.tenant_id AND c.kind = 'task'), 1) AS base
                FROM needy n
            ), created AS (
                INSERT INTO tasks (tenant_id, project_id, depth, display_seq, display_id, title,
                                   description, status_id, priority, created_by,
                                   is_requirements_home)
                SELECT n.tenant_id, n.project_id, 0,
                       (n.base + n.rn - 1)::int,
                       'TASK_' || lpad((n.base + n.rn - 1)::text,
                                       greatest(6, length((n.base + n.rn - 1)::text)), '0'),
                       :title, :description,
                       (SELECT s.id FROM task_statuses s
                        WHERE s.tenant_id = n.tenant_id AND s.is_default),
                       'Medium', n.created_by, true
                FROM numbered n
                RETURNING id, tenant_id, project_id
            )
            UPDATE requirements r SET task_id = created.id
            FROM created
            WHERE r.task_id IS NULL
              AND r.project_id = created.project_id AND r.tenant_id = created.tenant_id
            """
        ).bindparams(title=HOME_TITLE, description=HOME_DESCRIPTION)
    )
    op.execute(
        """
        INSERT INTO entity_counters (tenant_id, kind, next_value)
        SELECT tenant_id, 'task', max(display_seq) + 1 FROM tasks
        WHERE display_seq IS NOT NULL GROUP BY tenant_id
        ON CONFLICT (tenant_id, kind) DO UPDATE
        SET next_value = GREATEST(entity_counters.next_value, EXCLUDED.next_value)
        """
    )
    op.alter_column("requirements", "task_id", nullable=False)


def downgrade() -> None:
    op.alter_column("requirements", "task_id", nullable=True)
    op.drop_index("uq_tasks_requirements_home", table_name="tasks")
    op.drop_column("tasks", "is_requirements_home")
