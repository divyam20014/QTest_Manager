"""requirement ids, type, status, priority, owner and kept history (ADR-148)

Revision ID: e2a4c6d8f0b1
Revises: d9f1b3c5e7a8
Create Date: 2026-11-28

"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "e2a4c6d8f0b1"
down_revision = "d9f1b3c5e7a8"
branch_labels = None
depends_on = None

_KEYS_BEFORE = (
    "defect_severity",
    "test_case_priority",
    "defect_priority",
    "test_type",
    "test_case_severity",
    "task_priority",
    "task_type",
)
_OPTIONS = {
    "requirement_type": ("Functional", "Non-functional", "Business rule"),
    "requirement_priority": ("Critical", "High", "Medium", "Low"),
}


def _check_keys(keys: tuple[str, ...]) -> None:
    allowed = ",".join(f"'{key}'" for key in keys)
    op.execute("ALTER TABLE field_options DROP CONSTRAINT ck_field_options_field_key")
    op.execute(
        "ALTER TABLE field_options ADD CONSTRAINT ck_field_options_field_key "
        f"CHECK (field_key in ({allowed}))"
    )


def _check_counter_kinds(kinds: str) -> None:
    op.execute("ALTER TABLE entity_counters DROP CONSTRAINT ck_entity_counters_kind")
    op.execute(
        "ALTER TABLE entity_counters ADD CONSTRAINT ck_entity_counters_kind "
        f"CHECK (kind in ({kinds}))"
    )


def upgrade() -> None:
    op.add_column("requirements", sa.Column("display_seq", sa.Integer(), nullable=True))
    op.add_column("requirements", sa.Column("display_id", sa.Text(), nullable=True))
    for name, default in (
        ("requirement_type", "Functional"),
        ("status", "draft"),
        ("priority", "Medium"),
    ):
        op.add_column(
            "requirements", sa.Column(name, sa.String(64), nullable=False, server_default=default)
        )
    op.create_check_constraint(
        "ck_requirements_status", "requirements", "status in ('draft','approved','retired')"
    )
    op.add_column(
        "requirements", sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.create_foreign_key("fk_requirements_owner", "requirements", "users", ["owner_id"], ["id"])
    op.create_index("ix_requirements_owner", "requirements", ["owner_id"])
    op.add_column(
        "requirements",
        sa.Column("row_version", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column("requirements", sa.Column("deleted_at", sa.DateTime(timezone=True)))

    _check_counter_kinds("'test_case','defect','task','requirement'")
    # Existing requirements are numbered in the order they were created. Giving an archived
    # project's requirements an id is not a change to them (ADR-140).
    op.execute("select set_config('app.allow_archived_write', 'on', true)")
    op.execute(
        "update requirements set display_seq = n.seq, "
        "display_id = 'REQ_' || lpad(n.seq::text, greatest(6, length(n.seq::text)), '0') "
        "from (select id, row_number() over (partition by tenant_id order by created_at, id) "
        "             as seq from requirements) n "
        "where n.id = requirements.id"
    )
    op.execute("select set_config('app.allow_archived_write', 'off', true)")
    op.execute(
        "insert into entity_counters (tenant_id, kind, next_value) "
        "select tenant_id, 'requirement', max(display_seq) + 1 from requirements "
        "group by tenant_id"
    )
    op.create_index(
        "uq_requirements_tenant_display_id",
        "requirements",
        ["tenant_id", "display_id"],
        unique=True,
        postgresql_where=sa.text("display_id is not null"),
    )
    op.execute(
        "CREATE TRIGGER trg_requirements_display_id_immutable "
        "BEFORE UPDATE OF display_id, display_seq ON requirements "
        "FOR EACH ROW EXECUTE FUNCTION enforce_display_id_immutable()"
    )

    _check_keys(_KEYS_BEFORE + tuple(_OPTIONS))
    for field_key, codes in _OPTIONS.items():
        for order, code in enumerate(codes):
            op.execute(
                sa.text(
                    "insert into field_options (tenant_id, field_key, code, label, sort_order) "
                    "select id, :field_key, :code, :code, :sort_order from tenants"
                ).bindparams(field_key=field_key, code=code, sort_order=order)
            )


def downgrade() -> None:
    # Without deleted_at a deleted requirement would come back, so refuse while there are any.
    if (
        op.get_bind()
        .execute(sa.text("select 1 from requirements where deleted_at is not null limit 1"))
        .first()
    ):
        raise RuntimeError(
            "There are deleted requirements, which this downgrade would bring back. "
            "Restore or remove them first."
        )
    # Ids, types, statuses, priorities and owners are lost.
    op.execute(
        "delete from field_options where field_key in ('requirement_type',"
        "'requirement_priority')"
    )
    _check_keys(_KEYS_BEFORE)
    op.execute("DROP TRIGGER trg_requirements_display_id_immutable ON requirements")
    op.drop_index("uq_requirements_tenant_display_id", table_name="requirements")
    op.execute("delete from entity_counters where kind = 'requirement'")
    _check_counter_kinds("'test_case','defect','task'")
    op.drop_index("ix_requirements_owner", table_name="requirements")
    op.drop_constraint("fk_requirements_owner", "requirements", type_="foreignkey")
    op.drop_constraint("ck_requirements_status", "requirements", type_="check")
    for column in (
        "deleted_at",
        "row_version",
        "owner_id",
        "priority",
        "status",
        "requirement_type",
        "display_id",
        "display_seq",
    ):
        op.drop_column("requirements", column)
