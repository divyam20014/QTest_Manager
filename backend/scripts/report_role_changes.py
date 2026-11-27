"""Who is affected by the project role rules (ADR-143). Run before upgrading.

    python -m scripts.report_role_changes

Reads only, in a read-only transaction. It connects with MIGRATION_DATABASE_URL so that
it sees every organization. The output names people: treat it as personal data.
"""

import sys

from sqlalchemy import create_engine, text

from app.core.config import get_settings

_OVERRIDES = """
    select t.name as organization, p.name as project, u.name as person,
           o.name as organization_role, o.code as organization_code, r.name as project_role,
           r.code as project_code
    from project_members m
    join projects p on p.id = m.project_id
    join tenants t on t.id = p.tenant_id
    join users u on u.id = m.user_id
    join roles o on o.id = u.role_id
    join roles r on r.id = m.role_id
    order by 1, 2, 3
"""

# Custom roles that lose something under the two extra requirements.
_CUSTOM = """
    with held as (
        select r.id, array_agg(p.code) as codes
        from roles r
        join role_permissions rp on rp.role_id = r.id
        join permissions p on p.id = rp.permission_id
        where r.tenant_id is not null
        group by r.id
    )
    select t.name as organization, r.name as role,
           (select count(*) from users u where u.role_id = r.id and u.is_active) as people,
           t.ai_enabled as ai_enabled,
           not ('testcase.create' = any(h.codes)) as loses_ai_generation,
           ('defect.change_status' = any(h.codes)
            and not ('testcase.execute' = any(h.codes))) as loses_retest_result
    from roles r
    join tenants t on t.id = r.tenant_id
    join held h on h.id = r.id
    order by 1, 2
"""


# ADR-143 adds system roles with these names; an organization's own role of the same
# name would appear beside it in every list.
_SAME_NAME = """
    select t.name as organization, r.name as role
    from roles r join tenants t on t.id = r.tenant_id
    where lower(r.name) in ('qa lead', 'developer', 'viewer')
    order by 1, 2
"""


def main() -> int:
    engine = create_engine(get_settings().migration_database_url)
    with engine.connect() as conn:
        conn.execute(text("set transaction read only"))
        overrides = conn.execute(text(_OVERRIDES)).mappings().all()
        custom = conn.execute(text(_CUSTOM)).mappings().all()
        same_name = conn.execute(text(_SAME_NAME)).mappings().all()

    print(f"Project roles in use: {len(overrides)}")
    for row in overrides:
        note = ""
        if row["organization_code"] == "admin":
            note = "  -> no effect: an Admin is never restricted"
        elif row["project_code"] == "admin":
            note = "  -> counts as the Manager tier; Admin can no longer be assigned"
        print(
            f"  {row['organization']} / {row['project']}: {row['person']} "
            f"({row['organization_role']} -> {row['project_role']}){note}"
        )
    if overrides:
        print("  Each of these now applies to every action on that project. Check them.")

    affected = [r for r in custom if r["loses_ai_generation"] or r["loses_retest_result"]]
    print(f"Custom roles: {len(custom)}, of which affected: {len(affected)}")
    for row in affected:
        lost = []
        if row["loses_ai_generation"]:
            state = "on" if row["ai_enabled"] else "off"
            lost.append(f"AI test case generation (AI is {state} for this organization)")
        if row["loses_retest_result"]:
            lost.append("recording a retest result and marking a defect Verified")
        print(
            f"  {row['organization']} / {row['role']} ({row['people']} active): "
            f"loses {'; '.join(lost)}"
        )
    print(f"Custom roles named like a new system role: {len(same_name)}")
    for row in same_name:
        print(f"  {row['organization']} / {row['role']}: rename it to avoid two with one name")
    return 0


if __name__ == "__main__":
    sys.exit(main())
