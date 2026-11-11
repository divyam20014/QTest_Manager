"""add custom roles (ADR-059)

Revision ID: 053233f28383
Revises: 511f7b966b3f
Create Date: 2026-11-11 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "053233f28383"
down_revision: Union[str, None] = "511f7b966b3f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # A custom role has no fixed code (only the 3 system roles do) -- the
    # baseline schema made this NOT NULL when only system roles existed.
    op.alter_column("roles", "code", existing_type=sa.String(), nullable=True)
    op.add_column(
        "roles", sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.add_column(
        "roles",
        sa.Column("is_system", sa.Boolean(), server_default="false", nullable=False),
    )
    op.add_column(
        "roles", sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False)
    )
    # Deliberately NOT a hard foreign key to tenants: `roles` mixes
    # permanent global seed rows (tenant_id IS NULL, never touched again
    # after migration) with per-tenant custom rows in the same table. A
    # real FK would mean `TRUNCATE tenants CASCADE` (this project's test
    # suite's own per-test cleanup, and conceivably any future tenant-
    # deletion tooling) wipes the ENTIRE `roles` table -- every row, not
    # just the ones belonging to that tenant, since TRUNCATE CASCADE
    # truncates whole referencing tables, not matching rows -- destroying
    # the system Admin/Manager/Tester rows every other tenant also depends
    # on. tenant_id stays indexed and is validated service-side
    # (role_service._get_role_or_404 / resolve_role_id) against the
    # session's own tenant_id instead.
    op.create_index(op.f("ix_roles_tenant_id"), "roles", ["tenant_id"], unique=False)
    op.execute("UPDATE roles SET is_system = true WHERE code IN ('admin', 'manager', 'tester')")

    # Custom-role names are unique per tenant; system roles (tenant_id IS
    # NULL) are already protected by the existing unique `code`.
    op.create_index(
        "uq_roles_tenant_name",
        "roles",
        ["tenant_id", sa.text("lower(name)")],
        unique=True,
        postgresql_where=sa.text("tenant_id IS NOT NULL"),
    )

    # RLS (ADR-007 pattern, adapted): a tenant sees its own custom roles
    # plus every system role (tenant_id IS NULL matches unconditionally,
    # independent of whether app.current_tenant is even set yet -- needed
    # since system-role lookups happen before any tenant context exists,
    # e.g. at tenant provisioning).
    op.execute("ALTER TABLE roles ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE roles FORCE ROW LEVEL SECURITY")
    # NULLIF(...,'') guard (567fa7545de9): an unset app.current_tenant GUC
    # reads back as '' (Postgres's placeholder default for an unrecognized
    # custom parameter), not NULL -- casting '' straight to ::uuid raises,
    # instead of just failing the predicate. Missed on first pass of this
    # migration; same bug, same fix, as every other RLS policy here.
    op.execute(
        """
        CREATE POLICY tenant_isolation ON roles
        USING (
            tenant_id IS NULL
            OR tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
        )
        WITH CHECK (
            tenant_id IS NULL
            OR tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
        )
        """
    )

    # New permission (ADR-059): composes with every existing hardcoded
    # admin/manager-vs-tester project-visibility check, replacing fixed
    # role-code comparisons so custom roles can be granted (or withheld)
    # the same tenant-wide access Admin/Manager had baked in before.
    conn = op.get_bind()
    perm_id = conn.execute(
        sa.text(
            "INSERT INTO permissions (code, description) VALUES "
            "('project.view.all', 'See every project tenant-wide, not just assigned ones') "
            "ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description "
            "RETURNING id"
        )
    ).scalar_one()
    for role_code in ("admin", "manager"):
        role_id = conn.execute(
            sa.text("SELECT id FROM roles WHERE code = :code"), {"code": role_code}
        ).scalar_one()
        conn.execute(
            sa.text(
                "INSERT INTO role_permissions (role_id, permission_id) VALUES "
                "(:role_id, :permission_id) ON CONFLICT DO NOTHING"
            ),
            {"role_id": role_id, "permission_id": perm_id},
        )


def downgrade() -> None:
    op.execute("DELETE FROM role_permissions WHERE permission_id = "
               "(SELECT id FROM permissions WHERE code = 'project.view.all')")
    op.execute("DELETE FROM permissions WHERE code = 'project.view.all'")
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON roles")
    op.execute("ALTER TABLE roles DISABLE ROW LEVEL SECURITY")
    op.drop_index("uq_roles_tenant_name", table_name="roles")
    op.drop_index(op.f("ix_roles_tenant_id"), table_name="roles")
    op.drop_column("roles", "is_active")
    op.drop_column("roles", "is_system")
    op.drop_column("roles", "tenant_id")
    op.alter_column("roles", "code", existing_type=sa.String(), nullable=False)
