"""Add marketing_leads for public demo/contact enquiries.

Platform-wide table (no tenant, no RLS), same category as `plans`.

Revision ID: e7f8a9b0c1d2
Revises: d6e7f8a9b0c1
Create Date: 2026-11-15
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "e7f8a9b0c1d2"
down_revision = "d6e7f8a9b0c1"
branch_labels = None
depends_on = None

APP_ROLE = "qtesthub_app"


def upgrade() -> None:
    op.create_table(
        "marketing_leads",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("full_name", sa.String(), nullable=False),
        sa.Column("business_email", sa.String(), nullable=False),
        sa.Column("company", sa.String(), nullable=False),
        sa.Column("job_role", sa.String(), nullable=True),
        sa.Column("team_size", sa.String(), nullable=True),
        sa.Column("primary_requirement", sa.String(), nullable=True),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("source_page", sa.String(), nullable=True),
        sa.Column("status", sa.String(), server_default="new", nullable=False),
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
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "kind in ('demo', 'contact', 'pricing', 'enterprise')", name="ck_marketing_leads_kind"
        ),
        sa.CheckConstraint(
            "status in ('new', 'contacted', 'closed')", name="ck_marketing_leads_status"
        ),
    )
    op.create_index("ix_marketing_leads_created_at", "marketing_leads", ["created_at"])
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON marketing_leads TO {APP_ROLE}")


def downgrade() -> None:
    op.drop_index("ix_marketing_leads_created_at", table_name="marketing_leads")
    op.drop_table("marketing_leads")
