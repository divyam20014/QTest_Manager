"""add Defect Intelligence root cause categorization (Phase 6)

AI/SaaS vision roadmap Phase 6 (PV-6.4, GAP-77): adds a nullable
`root_cause` column to `defects`, constrained to a simple fixed taxonomy.
Aging/SLA-breach tracking (PV-6.2) and defect trend analytics (PV-6.5) are
computed, not stored -- no schema change needed for those. No new
permission: setting the root cause reuses the existing project-access
check used by other defect mutations (update_status/add_link).

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-11-10 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('defects', sa.Column('root_cause', sa.String(), nullable=True))
    op.create_check_constraint(
        'ck_defects_root_cause',
        'defects',
        "root_cause is null or root_cause in ("
        "'requirements_gap','code_defect','design_flaw','test_data_issue',"
        "'environment_issue','third_party_integration','other')",
    )


def downgrade() -> None:
    op.drop_constraint('ck_defects_root_cause', 'defects', type_='check')
    op.drop_column('defects', 'root_cause')
