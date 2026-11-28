"""Every table is protected by row-level security, or is a listed exception.

Reads the migrated database, so a new table fails here until it is protected or
someone adds it below with a reason.
"""

from sqlalchemy import text

# Tables that hold a tenant_id and have no row-level security. Each is read before a
# tenant is known (or by the worker across tenants), so the code must filter. Adding
# to this list is a security decision.
TENANT_TABLES_WITHOUT_RLS = {
    "sessions": "looked up by session id to find out which tenant is signed in",
    "mfa_challenges": "belongs to the sign-in in progress; read by that session's user",
    "user_invites": "an invitation is accepted before sign-in; its secret is checked first",
    "background_jobs": "the worker claims queued jobs of every tenant; reads filter by tenant",
}

# Tables with no tenant_id.
TABLES_WITHOUT_TENANT_ID = {
    "alembic_version": "migration bookkeeping",
    "tenants": "the tenant list itself",
    "permissions": "the product's permission list",
    "role_permissions": "grants of a role; limited through roles",
    "project_members": "limited through projects and users; has no tenant_id yet",
    "plans": "price plans",
    "marketing_leads": "the provider's sales enquiries",
    "audit_chain_checkpoints": "seals kept by the provider",
    "platform_admins": "the provider's administrators",
    "platform_admin_recovery_codes": "the provider's credentials",
    "platform_sessions": "the provider's sessions",
    "platform_audit_events": "the provider's audit log",
}

_TABLES = text(
    """
    select c.relname as name, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
           exists (select 1 from information_schema.columns col
                   where col.table_schema = 'public' and col.table_name = c.relname
                     and col.column_name = 'tenant_id') as has_tenant_id
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    """
)


def _tables(owner_engine) -> dict:
    with owner_engine.connect() as conn:
        return {row.name: row for row in conn.execute(_TABLES)}


def test_every_tenant_table_has_forced_row_level_security(owner_engine) -> None:
    tables = _tables(owner_engine)
    unprotected = {
        name
        for name, row in tables.items()
        if row.has_tenant_id and not (row.enabled and row.forced)
    }
    assert unprotected == set(TENANT_TABLES_WITHOUT_RLS)


def test_every_table_without_a_tenant_id_is_listed(owner_engine) -> None:
    tables = _tables(owner_engine)
    without = {name for name, row in tables.items() if not row.has_tenant_id}
    assert without == set(TABLES_WITHOUT_TENANT_ID)


def test_every_protected_table_has_policies_that_check_the_tenant(owner_engine) -> None:
    protected = {name for name, row in _tables(owner_engine).items() if row.enabled}
    with owner_engine.connect() as conn:
        policies = conn.execute(
            text(
                "select tablename, policyname, cmd, qual, with_check "
                "from pg_policies where schemaname = 'public'"
            )
        ).all()

    assert protected - {p.tablename for p in policies} == set(), "RLS on, but no policy"
    for policy in policies:
        where = f"{policy.tablename}.{policy.policyname}"
        # FOR ALL with both clauses: reading and writing are both limited. Policies
        # are permissive, so any one of them that skips the tenant would open the table.
        assert policy.cmd == "ALL", where
        for clause in (policy.qual, policy.with_check):
            assert clause and "app.current_tenant" in clause and "tenant_id" in clause, where


def test_the_application_role_cannot_bypass_row_level_security(owner_engine) -> None:
    with owner_engine.connect() as conn:
        role = conn.execute(
            text("select rolsuper, rolbypassrls from pg_roles where rolname = 'qtesthub_app'")
        ).one()
        owned = conn.execute(
            text(
                "select count(*) from pg_tables "
                "where schemaname = 'public' and tableowner = 'qtesthub_app'"
            )
        ).scalar_one()
    assert (role.rolsuper, role.rolbypassrls, owned) == (False, False, 0)


# Tables with a project_id whose rows are not work on the project, so an archived
# project does not lock them (ADR-140).
PROJECT_TABLES_NOT_LOCKED_BY_ARCHIVE = {
    "access_rules": "organization-managed rules that may name a project",
    "dashboards": "how people view a project, not its records",
    "import_sessions": "short-lived uploads; committing one writes locked tables",
}


def test_every_project_table_is_locked_when_the_project_is_archived(owner_engine) -> None:
    """A new table of a project's records must get the archive guard triggers."""
    with owner_engine.connect() as conn:
        with_project = set(
            conn.execute(
                text(
                    "select table_name from information_schema.columns "
                    "where table_schema = 'public' and column_name = 'project_id'"
                )
            ).scalars()
        )
        guards = conn.execute(
            text(
                "select c.relname, count(*) from pg_trigger t "
                "join pg_class c on c.oid = t.tgrelid "
                "where t.tgname like 'archived_guard%' group by c.relname"
            )
        ).all()
    locked = {name for name, _ in guards}

    assert with_project - locked == set(PROJECT_TABLES_NOT_LOCKED_BY_ARCHIVE)
    assert {name for name, count in guards if count != 3} == set(), "insert, update and delete"
