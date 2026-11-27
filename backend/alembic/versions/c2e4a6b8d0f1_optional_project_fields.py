"""optional project fields and the tenant's own project domains (ADR-139)

Revision ID: c2e4a6b8d0f1
Revises: b1d3f5a7c9e2
Create Date: 2026-11-27

"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "c2e4a6b8d0f1"
down_revision = "b1d3f5a7c9e2"
branch_labels = None
depends_on = None

_OPTIONAL = {
    "domain": sa.String(),
    "manager_name": sa.String(),
    "start_date": sa.Date(),
    "end_date": sa.Date(),
    "budget": sa.Numeric(14, 2),
    "region": sa.String(),
}
_BUILT_IN = "('Motor','Health','Travel','Life','Property')"


def upgrade() -> None:
    # The date-order and budget checks stay: a CHECK passes when a value is NULL.
    op.drop_constraint("ck_projects_domain", "projects", type_="check")
    for column, kind in _OPTIONAL.items():
        op.alter_column("projects", column, existing_type=kind, nullable=True)
    # NULL = the built-in list, so existing organizations see no change.
    op.add_column("tenants", sa.Column("project_domains", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    # Going back needs every project to have all six values and a built-in domain. Filling
    # them in would invent data, so refuse and say what has to be decided first.
    missing = " or ".join(f"{column} is null" for column in _OPTIONAL)
    blocked = (
        op.get_bind()
        .execute(
            sa.text(f"select count(*) from projects where {missing} or domain not in {_BUILT_IN}")
        )
        .scalar_one()
    )
    if blocked:
        raise RuntimeError(
            f"{blocked} project(s) have an empty field or their own domain. Fill them in "
            "(with a built-in domain) before downgrading."
        )
    op.drop_column("tenants", "project_domains")
    for column, kind in _OPTIONAL.items():
        op.alter_column("projects", column, existing_type=kind, nullable=False)
    op.create_check_constraint("ck_projects_domain", "projects", f"domain in {_BUILT_IN}")
