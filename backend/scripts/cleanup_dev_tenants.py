"""Delete throwaway test tenants (and test platform admins) from a DEV database.

The e2e suite and the screenshot scripts provision a fresh tenant per run, and
the platform API deliberately has no tenant delete, so a dev database slowly
fills with hundreds of them. This script removes only tenants that look like
test fixtures:

  * a name ending in `` <13-digit epoch ms>-<n>`` (what e2e/fixtures.ts creates), or
  * ``Shots`` / ``Shots4`` / ``Shots4b`` / ``Probe`` followed by a number
    (the ad-hoc screenshot/probe tenants),

and never any name in PROTECTED_NAMES, whatever its name looks like. It also
removes test platform admins that the e2e fixtures create (``mfa-e2e-*``,
``mfa-shot-*``, ``pw-e2e-*``, ``audit-e2e-*``, ``sess-e2e-*`` at ``@example.com``,
never ``owner@qtesthub.local``). An admin that a tenant ``audit_logs`` row still
points at (a real FK) is KEPT, and ``platform_audit_events`` is never touched: it is
append-only and its actor/target ids carry no FK.

Dry-run by default. Pass --apply to delete, in ONE transaction (all or
nothing). Deletion bypasses foreign-key triggers (``session_replication_role =
replica``), which needs a superuser/owner connection, so it uses
MIGRATION_DATABASE_URL. It refuses to run when ENVIRONMENT=production. Take a
``pg_dump`` first.

Usage (from the api container):
    python -m scripts.cleanup_dev_tenants            # list what would go
    python -m scripts.cleanup_dev_tenants --apply
"""

import argparse
import sys

from sqlalchemy import create_engine, text

from app.core.config import get_settings

PROTECTED_NAMES = ("Quantique", "Indicosmic", "Meridian Auto Insurance")
FIXTURE_NAME_REGEX = r" [0-9]{13}-[0-9]+$"
AD_HOC_NAME_REGEX = r"^(Shots|Shots4|Shots4b|Probe) [0-9]+$"
# Fixture emails are `<prefix>[-word...]-<epoch ms>[-<random>]@example.com`.
TEST_ADMIN_EMAIL_REGEX = (
    r"^(mfa-e2e|mfa-shot|pw-e2e|audit-e2e|sess-e2e)(-[a-z]+)*-[0-9]+(-[0-9]+)?@example\.com$"
)
# Tables that reference a tenant-scoped parent but carry no tenant_id column.
CHILD_TABLES = {
    "project_members": "project_id in (select id from projects where tenant_id = any(:ids))",
    "role_permissions": "role_id in (select id from roles where tenant_id = any(:ids))",
}

SELECT_TENANTS = text(
    "select id, name from tenants "
    "where (name ~ :fixture or name ~ :adhoc) and not (name = any(:protected)) "
    "order by created_at"
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--apply", action="store_true", help="delete (default is a dry run)")
    args = parser.parse_args()

    settings = get_settings()
    if settings.environment == "production":
        print("Refusing to run with ENVIRONMENT=production.", file=sys.stderr)
        return 1

    engine = create_engine(settings.migration_database_url or settings.database_url)
    params = {
        "fixture": FIXTURE_NAME_REGEX,
        "adhoc": AD_HOC_NAME_REGEX,
        "protected": list(PROTECTED_NAMES),
    }
    with engine.begin() as conn:
        tenants = conn.execute(SELECT_TENANTS, params).all()
        ids = [row.id for row in tenants]
        admins = conn.execute(
            text(
                "select id, email from platform_admins "
                "where email ~ :rx and email <> 'owner@qtesthub.local' "
                "and id not in (select platform_admin_id from audit_logs "
                "where platform_admin_id is not null)"
            ),
            {"rx": TEST_ADMIN_EMAIL_REGEX},
        ).all()
        referenced = conn.execute(
            text(
                "select count(*) from platform_admins "
                "where email ~ :rx and email <> 'owner@qtesthub.local' "
                "and id in (select platform_admin_id from audit_logs "
                "where platform_admin_id is not null)"
            ),
            {"rx": TEST_ADMIN_EMAIL_REGEX},
        ).scalar_one()
        kept = conn.execute(
            text("select count(*) from tenants where not (id = any(:ids))"), {"ids": ids}
        ).scalar_one()
        tables = [
            row[0]
            for row in conn.execute(
                text(
                    "select table_name from information_schema.columns "
                    "where table_schema = 'public' and column_name = 'tenant_id' "
                    "and table_name <> 'tenants' order by 1"
                )
            )
        ]
        print(f"Throwaway tenants to delete: {len(ids)}")
        print(f"Tenants kept: {kept} (protected: {', '.join(PROTECTED_NAMES)})")
        print(f"Test platform admins to delete: {len(admins)}")
        print(f"Test platform admins kept (referenced by audit_logs): {referenced}")
        if not args.apply:
            print("Dry run - nothing changed. Re-run with --apply to delete.")
            return 0
        if not ids and not admins:
            print("Nothing to delete.")
            return 0

        conn.execute(text("set local session_replication_role = replica"))
        deleted_rows = 0
        for table, condition in CHILD_TABLES.items():
            result = conn.execute(text(f"delete from {table} where {condition}"), {"ids": ids})
            deleted_rows += result.rowcount
        for table in tables:
            result = conn.execute(
                text(f"delete from {table} where tenant_id = any(:ids)"), {"ids": ids}
            )
            deleted_rows += result.rowcount
        conn.execute(text("delete from tenants where id = any(:ids)"), {"ids": ids})
        admin_ids = [row.id for row in admins]
        for table in ("platform_admin_recovery_codes", "platform_sessions"):
            conn.execute(
                text(f"delete from {table} where admin_id = any(:ids)"), {"ids": admin_ids}
            )
        conn.execute(text("delete from platform_admins where id = any(:ids)"), {"ids": admin_ids})
        print(
            f"Deleted {len(ids)} tenant(s), {deleted_rows} child row(s), "
            f"{len(admin_ids)} platform admin(s)."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
