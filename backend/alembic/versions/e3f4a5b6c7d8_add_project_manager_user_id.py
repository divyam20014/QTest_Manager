"""add projects.manager_user_id (optional FK alongside manager_name)

manager_name has always been a free-text display field with no relational
identity. Adds an optional manager_user_id FK to users so a project's
manager can be linked to an actual tenant user account where one exists,
without breaking existing rows/CSV import/forms that only supply a name.

Revision ID: e3f4a5b6c7d8
Revises: d2e3f4a5b6c7
Create Date: 2026-11-10 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'e3f4a5b6c7d8'
down_revision: Union[str, None] = 'd2e3f4a5b6c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'projects',
        sa.Column('manager_user_id', postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        'fk_projects_manager_user_id_users',
        'projects',
        'users',
        ['manager_user_id'],
        ['id'],
    )


def downgrade() -> None:
    op.drop_constraint('fk_projects_manager_user_id_users', 'projects', type_='foreignkey')
    op.drop_column('projects', 'manager_user_id')
