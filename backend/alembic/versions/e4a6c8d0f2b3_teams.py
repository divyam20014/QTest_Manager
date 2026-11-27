"""teams (ADR-141)

Revision ID: e4a6c8d0f2b3
Revises: d3f5b7a9c1e2
Create Date: 2026-11-27

"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "e4a6c8d0f2b3"
down_revision = "d3f5b7a9c1e2"
branch_labels = None
depends_on = None

_APP_ROLE = "qtesthub_app"
_CURRENT = "NULLIF(current_setting('app.current_tenant', true), '')::uuid"


def _protect(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY tenant_isolation ON {table} "
        f"USING (tenant_id = {_CURRENT}) WITH CHECK (tenant_id = {_CURRENT})"
    )
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO {_APP_ROLE}")


def _uuid_column(name: str, *args, **kwargs) -> sa.Column:
    return sa.Column(name, postgresql.UUID(as_uuid=True), *args, **kwargs)


def _identity() -> list[sa.Column]:
    return [
        _uuid_column("id", primary_key=True, server_default=sa.text("gen_random_uuid()")),
        _uuid_column("tenant_id", sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    ]


def upgrade() -> None:
    # Lets other tables require "a user of the same organization" in a foreign key.
    op.create_unique_constraint("uq_users_id_tenant", "users", ["id", "tenant_id"])

    op.create_table(
        "teams",
        *_identity(),
        sa.Column("name", sa.String(80), nullable=False),
        _uuid_column("lead_user_id", nullable=True),
        sa.UniqueConstraint("id", "tenant_id", name="uq_teams_id_tenant"),
        sa.ForeignKeyConstraint(
            ["lead_user_id", "tenant_id"],
            ["users.id", "users.tenant_id"],
            name="fk_teams_lead_same_tenant",
        ),
        sa.CheckConstraint("char_length(name) >= 2", name="ck_teams_name_len"),
    )
    op.create_index(
        "uq_teams_tenant_name_ci", "teams", ["tenant_id", sa.text("lower(name)")], unique=True
    )

    op.create_table(
        "team_members",
        *_identity(),
        _uuid_column("team_id", nullable=False),
        _uuid_column("user_id", nullable=False),
        sa.UniqueConstraint("team_id", "user_id", name="uq_team_members_team_user"),
        sa.ForeignKeyConstraint(
            ["team_id", "tenant_id"],
            ["teams.id", "teams.tenant_id"],
            name="fk_team_members_team_same_tenant",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id", "tenant_id"],
            ["users.id", "users.tenant_id"],
            name="fk_team_members_user_same_tenant",
        ),
    )
    op.create_index("ix_team_members_user_id", "team_members", ["user_id"])
    op.create_index("ix_team_members_tenant_id", "team_members", ["tenant_id"])

    for table in ("teams", "team_members"):
        _protect(table)


def downgrade() -> None:
    # Team definitions are lost. Project memberships made from them stay.
    op.drop_table("team_members")
    op.drop_table("teams")
    op.drop_constraint("uq_users_id_tenant", "users", type_="unique")
