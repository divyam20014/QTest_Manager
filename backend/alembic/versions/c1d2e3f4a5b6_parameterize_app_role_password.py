"""parameterize qtesthub_app role password via APP_DB_PASSWORD env var

The app role password was previously hardcoded to 'qtesthub_app' in the
baseline/RLS migration (fine for local dev, not acceptable as a checked-in
secret for any shared/production environment). This migration re-applies
the password from the APP_DB_PASSWORD environment variable, defaulting to
the original value so existing dev/test setups (which still connect with
qtesthub_app:qtesthub_app) are unaffected.

Operators deploying to a shared environment should set APP_DB_PASSWORD
before running migrations, and must keep the api service's DATABASE_URL
in sync with the same value.

Revision ID: c1d2e3f4a5b6
Revises: a3c9e1f2b4d7
Create Date: 2026-11-09 16:00:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c1d2e3f4a5b6'
down_revision: Union[str, None] = 'a3c9e1f2b4d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

APP_ROLE = "qtesthub_app"


def _set_password(password: str) -> None:
    # ALTER ROLE ... PASSWORD takes a string literal in the grammar, not a
    # bind parameter -- escape and inline it. The value comes from a
    # trusted operator-set env var, never request input.
    escaped = password.replace("'", "''")
    op.execute(f"ALTER ROLE {APP_ROLE} WITH PASSWORD '{escaped}'")


def upgrade() -> None:
    _set_password(os.environ.get("APP_DB_PASSWORD", "qtesthub_app"))


def downgrade() -> None:
    _set_password("qtesthub_app")
