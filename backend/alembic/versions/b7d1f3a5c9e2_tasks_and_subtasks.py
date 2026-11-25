"""ADR-127: tasks, sub-tasks, tenant task statuses, requirement/defect task links

Revision ID: b7d1f3a5c9e2
Revises: a6c8e0b2d4f7
Create Date: 2026-11-25 10:00:00.000000
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "b7d1f3a5c9e2"
down_revision = "a6c8e0b2d4f7"
branch_labels = None
depends_on = None

APP_ROLE = "qtesthub_app"
MAX_DEPTH = 4
_POLICY = """
CREATE POLICY tenant_isolation ON {t}
USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
"""
STATUS_DEFAULTS = (
    ("todo", "To Do", "todo", "#64748b", 0, True),
    ("in_progress", "In Progress", "in_progress", "#2563eb", 1, False),
    ("done", "Done", "done", "#16a34a", 2, False),
)
OLD_FIELD_KEYS = (
    "defect_severity",
    "test_case_priority",
    "defect_priority",
    "test_type",
    "test_case_severity",
)


def _pk() -> sa.Column:
    return sa.Column(
        "id",
        postgresql.UUID(as_uuid=True),
        server_default=sa.text("gen_random_uuid()"),
        nullable=False,
    )


def _in_list(values: tuple[str, ...]) -> str:
    return ",".join(f"'{v}'" for v in values)


def _rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(_POLICY.format(t=table))
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO {APP_ROLE}")


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)

    # --- tenant-configurable statuses ------------------------------------------
    op.create_table(
        "task_statuses",
        _pk(),
        sa.Column("tenant_id", uuid, nullable=False),
        sa.Column("code", sa.String(), nullable=False),
        sa.Column("label", sa.String(), nullable=False),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("color", sa.String(), nullable=True),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("is_default", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "category in ('todo','in_progress','done')", name="ck_task_statuses_category"
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "code", name="uq_task_statuses_tenant_code"),
    )
    op.create_index(op.f("ix_task_statuses_tenant_id"), "task_statuses", ["tenant_id"])
    op.create_index(
        "uq_task_statuses_one_default",
        "task_statuses",
        ["tenant_id"],
        unique=True,
        postgresql_where=sa.text("is_default"),
    )
    _rls("task_statuses")

    # --- tasks ------------------------------------------------------------------
    op.create_table(
        "tasks",
        _pk(),
        sa.Column("tenant_id", uuid, nullable=False),
        sa.Column("project_id", uuid, nullable=False),
        sa.Column("parent_task_id", uuid, nullable=True),
        sa.Column("depth", sa.Integer(), server_default="0", nullable=False),
        sa.Column("display_seq", sa.Integer(), nullable=True),
        sa.Column("display_id", sa.Text(), nullable=True),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status_id", uuid, nullable=False),
        sa.Column("priority", sa.String(), server_default="Medium", nullable=False),
        sa.Column("assignee_id", uuid, nullable=True),
        sa.Column("release_id", uuid, nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", uuid, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("char_length(title) between 3 and 255", name="ck_tasks_title_len"),
        sa.CheckConstraint(f"depth between 0 and {MAX_DEPTH}", name="ck_tasks_depth"),
        sa.CheckConstraint(
            "(parent_task_id is null and depth = 0) or (parent_task_id is not null and depth > 0)",
            name="ck_tasks_parent_vs_depth",
        ),
        sa.CheckConstraint("parent_task_id is distinct from id", name="ck_tasks_not_own_parent"),
        sa.CheckConstraint(
            "start_date is null or due_date is null or start_date <= due_date",
            name="ck_tasks_date_order",
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.ForeignKeyConstraint(["status_id"], ["task_statuses.id"]),
        sa.ForeignKeyConstraint(["assignee_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["release_id"], ["releases.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("id", "project_id", name="uq_tasks_id_project"),
    )
    op.create_foreign_key(
        "fk_tasks_parent_same_project",
        "tasks",
        "tasks",
        ["parent_task_id", "project_id"],
        ["id", "project_id"],
    )
    op.create_index(op.f("ix_tasks_tenant_id"), "tasks", ["tenant_id"])
    op.create_index(
        "ix_tasks_project_parent",
        "tasks",
        ["project_id", "parent_task_id"],
        postgresql_where=sa.text("deleted_at is null"),
    )
    op.create_index("ix_tasks_status", "tasks", ["status_id"])
    op.create_index(
        "ix_tasks_assignee",
        "tasks",
        ["assignee_id"],
        postgresql_where=sa.text("deleted_at is null"),
    )
    op.create_index(
        "uq_tasks_tenant_display_id",
        "tasks",
        ["tenant_id", "display_id"],
        unique=True,
        postgresql_where=sa.text("display_id is not null"),
    )
    _rls("tasks")

    # depth must be exactly parent.depth + 1 (rules out cycles and keeps the cap honest)
    op.execute(
        """
        CREATE OR REPLACE FUNCTION enforce_task_depth() RETURNS trigger AS $$
        DECLARE parent_depth integer;
        BEGIN
            -- Re-parenting must never place a task under itself or one of its descendants:
            -- walk the new parent's ancestor chain and refuse if this task appears in it.
            IF TG_OP = 'UPDATE' AND NEW.parent_task_id IS NOT NULL THEN
                IF EXISTS (
                    WITH RECURSIVE ancestors(id, parent_task_id) AS (
                        SELECT id, parent_task_id FROM tasks WHERE id = NEW.parent_task_id
                        UNION
                        SELECT t.id, t.parent_task_id
                        FROM tasks t JOIN ancestors a ON t.id = a.parent_task_id
                    )
                    SELECT 1 FROM ancestors WHERE id = NEW.id
                ) THEN
                    RAISE EXCEPTION 'a task cannot be moved under itself or its own sub-task'
                        USING ERRCODE = 'integrity_constraint_violation';
                END IF;
            END IF;
            IF NEW.parent_task_id IS NULL THEN
                IF NEW.depth <> 0 THEN
                    RAISE EXCEPTION 'root task depth must be 0'
                        USING ERRCODE = 'integrity_constraint_violation';
                END IF;
            ELSE
                SELECT depth INTO parent_depth FROM tasks WHERE id = NEW.parent_task_id;
                IF parent_depth IS NULL OR NEW.depth <> parent_depth + 1 THEN
                    RAISE EXCEPTION 'task depth must be parent depth + 1'
                        USING ERRCODE = 'integrity_constraint_violation';
                END IF;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_tasks_depth
        BEFORE INSERT OR UPDATE OF parent_task_id, depth ON tasks
        FOR EACH ROW EXECUTE FUNCTION enforce_task_depth()
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_tasks_display_id_immutable
        BEFORE UPDATE OF display_id, display_seq ON tasks
        FOR EACH ROW EXECUTE FUNCTION enforce_display_id_immutable()
        """
    )

    # --- task <-> test case ------------------------------------------------------
    op.create_table(
        "task_test_case_links",
        _pk(),
        sa.Column("tenant_id", uuid, nullable=False),
        sa.Column("task_id", uuid, nullable=False),
        sa.Column("test_case_id", uuid, nullable=False),
        sa.Column("linked_by", uuid, nullable=False),
        sa.Column(
            "linked_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"]),
        sa.ForeignKeyConstraint(["test_case_id"], ["test_cases.id"]),
        sa.ForeignKeyConstraint(["linked_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("task_id", "test_case_id", name="uq_task_test_case_links"),
    )
    op.create_index(
        op.f("ix_task_test_case_links_tenant_id"), "task_test_case_links", ["tenant_id"]
    )
    op.create_index("ix_task_test_case_links_case", "task_test_case_links", ["test_case_id"])
    _rls("task_test_case_links")

    # --- requirement / defect -> task (nullable, same project) ---------------------
    for table in ("requirements", "defects"):
        op.add_column(table, sa.Column("task_id", uuid, nullable=True))
        op.create_foreign_key(
            f"fk_{table}_task_same_project",
            table,
            "tasks",
            ["task_id", "project_id"],
            ["id", "project_id"],
        )
        op.create_index(
            f"ix_{table}_task",
            table,
            ["task_id"],
            postgresql_where=sa.text("task_id is not null"),
        )

    # --- widened checks ----------------------------------------------------------
    op.execute("ALTER TABLE entity_counters DROP CONSTRAINT ck_entity_counters_kind")
    op.execute(
        "ALTER TABLE entity_counters ADD CONSTRAINT ck_entity_counters_kind "
        "CHECK (kind in ('test_case','defect','task'))"
    )
    op.execute("ALTER TABLE field_options DROP CONSTRAINT ck_field_options_field_key")
    op.execute(
        "ALTER TABLE field_options ADD CONSTRAINT ck_field_options_field_key "
        f"CHECK (field_key in ({_in_list(OLD_FIELD_KEYS + ('task_priority',))}))"
    )

    # --- defaults for existing tenants (additive) --------------------------------
    for code, label, category, color, order, is_default in STATUS_DEFAULTS:
        op.execute(
            sa.text(
                "INSERT INTO task_statuses "
                "(tenant_id, code, label, category, color, sort_order, is_default) "
                "SELECT id, :code, :label, :category, :color, :sort_order, :is_default "
                "FROM tenants"
            ).bindparams(
                code=code,
                label=label,
                category=category,
                color=color,
                sort_order=order,
                is_default=is_default,
            )
        )
    for order, code in enumerate(("High", "Medium", "Low")):
        op.execute(
            sa.text(
                "INSERT INTO field_options (tenant_id, field_key, code, label, sort_order) "
                "SELECT id, 'task_priority', :code, :code, :sort_order FROM tenants"
            ).bindparams(code=code, sort_order=order)
        )


def downgrade() -> None:
    op.execute("DELETE FROM field_options WHERE field_key = 'task_priority'")
    op.execute("DELETE FROM entity_counters WHERE kind = 'task'")
    op.execute("ALTER TABLE field_options DROP CONSTRAINT ck_field_options_field_key")
    op.execute(
        "ALTER TABLE field_options ADD CONSTRAINT ck_field_options_field_key "
        f"CHECK (field_key in ({_in_list(OLD_FIELD_KEYS)}))"
    )
    op.execute("ALTER TABLE entity_counters DROP CONSTRAINT ck_entity_counters_kind")
    op.execute(
        "ALTER TABLE entity_counters ADD CONSTRAINT ck_entity_counters_kind "
        "CHECK (kind in ('test_case','defect'))"
    )
    for table in ("defects", "requirements"):
        op.drop_index(f"ix_{table}_task", table_name=table)
        op.drop_constraint(f"fk_{table}_task_same_project", table, type_="foreignkey")
        op.drop_column(table, "task_id")
    op.drop_table("task_test_case_links")
    op.execute("DROP TRIGGER IF EXISTS trg_tasks_display_id_immutable ON tasks")
    op.execute("DROP TRIGGER IF EXISTS trg_tasks_depth ON tasks")
    op.drop_table("tasks")
    op.execute("DROP FUNCTION IF EXISTS enforce_task_depth()")
    op.drop_table("task_statuses")
