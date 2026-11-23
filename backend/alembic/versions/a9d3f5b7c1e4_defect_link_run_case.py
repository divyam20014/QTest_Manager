"""ADR-118: defect links may point at a test run case; new defect notification types

Revision ID: a9d3f5b7c1e4
Revises: f7a3d9c1e5b2
Create Date: 2026-11-28 09:00:00.000000

``defect_links.linkable_type`` gains ``test_run_case``: the link between a defect and
the run case (one execution of a test case) it was raised from, was re-tested in, or
was linked to by hand. Existing rows are untouched.

``notifications.type`` gains ``defect_assigned``, ``defect_reopened`` and
``defect_retest`` (assignee changed, defect came back, a retest is waiting).

Downgrade removes any ``test_run_case`` link rows and the notifications of the new
types first (the older CHECKs cannot hold them) and restores both CHECKs.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "a9d3f5b7c1e4"
down_revision: str | None = "f7a3d9c1e5b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NAME = "ck_defect_links_linkable_type"
_OLD_TYPES = (
    "'mention','test_case_assigned','defect_closed','review_requested','review_decided',"
    "'run_case_assigned','test_run_completed','defect_sla_breach'"
)
_NEW_TYPES = _OLD_TYPES + ",'defect_assigned','defect_reopened','defect_retest'"


def _set_notification_types(types: str) -> None:
    op.execute("ALTER TABLE notifications DROP CONSTRAINT IF EXISTS ck_notifications_type")
    op.execute(
        f"ALTER TABLE notifications ADD CONSTRAINT ck_notifications_type CHECK (type in ({types}))"
    )


def upgrade() -> None:
    op.execute(f"ALTER TABLE defect_links DROP CONSTRAINT IF EXISTS {_NAME}")
    op.execute(
        f"ALTER TABLE defect_links ADD CONSTRAINT {_NAME} CHECK "
        "(linkable_type in ('execution_step','test_case','defect','test_run_case'))"
    )
    _set_notification_types(_NEW_TYPES)


def downgrade() -> None:
    op.execute(
        "DELETE FROM notifications WHERE type IN "
        "('defect_assigned','defect_reopened','defect_retest')"
    )
    _set_notification_types(_OLD_TYPES)
    op.execute("DELETE FROM defect_links WHERE linkable_type = 'test_run_case'")
    op.execute(f"ALTER TABLE defect_links DROP CONSTRAINT IF EXISTS {_NAME}")
    op.execute(
        f"ALTER TABLE defect_links ADD CONSTRAINT {_NAME} CHECK "
        "(linkable_type in ('execution_step','test_case','defect'))"
    )
