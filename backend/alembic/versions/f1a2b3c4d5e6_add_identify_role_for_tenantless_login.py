"""add qtesthub_identify role for tenant-less login identity resolution

Tenant-less login (POST /auth/identify, ADR-067): lets a user type only
their email on the login screen, resolving which tenant(s) it belongs to
before the password/tenant_id is known. The `users` table is RLS-scoped
with FORCE ROW LEVEL SECURITY (ADR-007) -- `qtesthub_app` cannot query it
without `app.current_tenant` already set, which is exactly the chicken-
and-egg problem this feature has to solve. No code path in this codebase
bypasses RLS today (service-token and platform-admin auth both already
have tenant_id in hand before querying, via a URL path parameter or a
separate non-tenant-scoped table) -- there is no existing bypass pattern
to reuse here.

Rather than weakening the `users` policy itself, this adds a second,
narrowly-scoped runtime role: LOGIN + BYPASSRLS, but granted SELECT only
on `users` and `tenants` (not INSERT/UPDATE/DELETE, not any other table).
It is used by a dedicated engine/session (app/core/db.py's
`identify_engine`/`get_identify_db`), reserved exclusively for the one
read-only lookup in app/services/identify_service.py -- never for
anything authenticated or state-changing. This mirrors
c1d2e3f4a5b6's password-parameterization pattern for qtesthub_app.

Revision ID: f1a2b3c4d5e6
Revises: a2b3c4d5e6f7
Create Date: 2026-11-12 10:00:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, None] = 'a2b3c4d5e6f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

IDENTIFY_ROLE = "qtesthub_identify"


def _escaped_password() -> str:
    # Same convention as c1d2e3f4a5b6: trusted operator-set env var, never
    # request input; ALTER ROLE's PASSWORD clause needs a string literal,
    # not a bind parameter.
    password = os.environ.get("IDENTIFY_DB_PASSWORD", "qtesthub_identify")
    return password.replace("'", "''")


def upgrade() -> None:
    op.execute(
        f"""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{IDENTIFY_ROLE}') THEN
                CREATE ROLE {IDENTIFY_ROLE} LOGIN BYPASSRLS PASSWORD '{_escaped_password()}';
            ELSE
                ALTER ROLE {IDENTIFY_ROLE} WITH LOGIN BYPASSRLS PASSWORD '{_escaped_password()}';
            END IF;
        END
        $$;
        """
    )
    op.execute(f"GRANT CONNECT ON DATABASE qtesthub TO {IDENTIFY_ROLE}")
    op.execute(f"GRANT USAGE ON SCHEMA public TO {IDENTIFY_ROLE}")
    # SELECT-only, and only on the two tables this lookup actually needs --
    # deliberately not ALL TABLES, unlike qtesthub_app's grant.
    op.execute(f"GRANT SELECT ON users TO {IDENTIFY_ROLE}")
    op.execute(f"GRANT SELECT ON tenants TO {IDENTIFY_ROLE}")


def downgrade() -> None:
    # Deliberately does not DROP ROLE, matching 7bca6b69ef88's own
    # downgrade() for qtesthub_app: a role is cluster-global, not
    # per-database, and this same cluster already runs more than one
    # database against it in dev/test (qtesthub, qtesthub_test) -- DROP
    # ROLE fails loudly (DependentObjectsStillExist) if any OTHER database
    # on the cluster still has live grants to it, which this migration has
    # no way to know about or safely tear down from here. Revoking this
    # database's own grants and removing LOGIN is sufficient to make the
    # role unusable for this feature without risking a cross-database
    # downgrade failure.
    op.execute(f"REVOKE SELECT ON tenants FROM {IDENTIFY_ROLE}")
    op.execute(f"REVOKE SELECT ON users FROM {IDENTIFY_ROLE}")
    op.execute(f"REVOKE USAGE ON SCHEMA public FROM {IDENTIFY_ROLE}")
    op.execute(f"REVOKE CONNECT ON DATABASE qtesthub FROM {IDENTIFY_ROLE}")
    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{IDENTIFY_ROLE}') THEN
                ALTER ROLE {IDENTIFY_ROLE} WITH NOLOGIN;
            END IF;
        END
        $$;
        """
    )
