"""ADR-116: Test Type value list (UI and End-to-End added, order fixed)

Revision ID: e4c8a1d7f3b9
Revises: d2b8f4a0c6e3
Create Date: 2026-11-27 09:00:00.000000

Data-only. Step 1 (ADR-115) seeded a different default Test Type list (with
Sanity and UAT, without UI and End-to-End). For every existing tenant this adds the
missing options and sets the display order to the standard list:

    Functional, UI, Smoke, Regression, Integration, System, End-to-End, Security,
    Performance, Compatibility, Usability, API

Sanity and UAT rows are NOT deleted (tenants may already have used them);
``field_options`` has no active flag, so they are moved after the standard twelve.
Options a tenant created itself are untouched. Re-running is harmless.

Downgrade restores the ADR-115 order for the ten shared codes and removes UI and
End-to-End unless a test case already uses them.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e4c8a1d7f3b9"
down_revision: str | None = "d2b8f4a0c6e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NEW_ORDER = (
    "Functional",
    "UI",
    "Smoke",
    "Regression",
    "Integration",
    "System",
    "End-to-End",
    "Security",
    "Performance",
    "Compatibility",
    "Usability",
    "API",
)
LEGACY_EXTRA = ("Sanity", "UAT")
OLD_ORDER = (
    "Functional",
    "Regression",
    "Smoke",
    "Sanity",
    "Integration",
    "System",
    "UAT",
    "Performance",
    "Security",
    "Usability",
    "Compatibility",
    "API",
)


def upgrade() -> None:
    for position, code in enumerate((*NEW_ORDER, *LEGACY_EXTRA)):
        op.execute(
            sa.text(
                """
                INSERT INTO field_options (tenant_id, field_key, code, label, sort_order)
                SELECT id, 'test_type', :code, :code, :pos FROM tenants
                ON CONFLICT (tenant_id, field_key, code) DO UPDATE SET sort_order = :pos
                """
            ).bindparams(code=code, pos=position)
        )
    # Tenants that already own options after the standard list keep them after it.


def downgrade() -> None:
    for position, code in enumerate(OLD_ORDER):
        op.execute(
            sa.text(
                "UPDATE field_options SET sort_order = :pos "
                "WHERE field_key = 'test_type' AND code = :code"
            ).bindparams(code=code, pos=position)
        )
    op.execute(
        sa.text(
            """
            DELETE FROM field_options fo
            WHERE fo.field_key = 'test_type' AND fo.code IN ('UI', 'End-to-End')
              AND NOT EXISTS (
                SELECT 1 FROM test_cases tc
                WHERE tc.tenant_id = fo.tenant_id AND tc.test_type = fo.code
              )
            """
        )
    )
