"""requirements can be imported (ADR-151)

Revision ID: b5d7f9a1c3e4
Revises: a4c6e8f0b2d3
Create Date: 2026-11-28

"""

from alembic import op

revision = "b5d7f9a1c3e4"
down_revision = "a4c6e8f0b2d3"
branch_labels = None
depends_on = None


def _check_kinds(kinds: str) -> None:
    op.execute("ALTER TABLE import_sessions DROP CONSTRAINT ck_import_sessions_kind")
    op.execute(
        "ALTER TABLE import_sessions ADD CONSTRAINT ck_import_sessions_kind "
        f"CHECK (kind in ({kinds}))"
    )


def upgrade() -> None:
    _check_kinds("'test_case','defect','requirement'")


def downgrade() -> None:
    # Previews only, kept for minutes; no imported record is touched.
    op.execute("delete from import_sessions where kind = 'requirement'")
    _check_kinds("'test_case','defect'")
