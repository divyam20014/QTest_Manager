"""record.contribute and the QA Lead, Developer and Viewer roles (ADR-143)

Revision ID: f5b7d9e1a3c4
Revises: e4a6c8d0f2b3
Create Date: 2026-11-27

"""

import sqlalchemy as sa

from alembic import op

revision = "f5b7d9e1a3c4"
down_revision = "e4a6c8d0f2b3"
branch_labels = None
depends_on = None

_CONTRIBUTE = "record.contribute"

_DEVELOPER = [
    "task.transition",
    "defect.create",
    "defect.edit",
    "defect.change_status",
    "defect.export",
    "report.view",
    _CONTRIBUTE,
]

_NEW_ROLES: dict[str, tuple[str, list[str]]] = {
    "qa_lead": (
        "QA Lead",
        _DEVELOPER
        + [
            "project.view.all",
            "task.manage",
            "requirement.manage",
            "testcase.create",
            "testcase.edit",
            "testcase.approve",
            "testcase.deprecate",
            "testcase.delete",
            "testcase.execute",
            "executionstep.record",
            "testcase.export",
            "testcase.bulk_import_export",
            "testrun.create",
            "testrun.finish",
            "testrun.delete",
            "defect.assign",
            "defect.close",
            "defect.delete",
            "defect.import",
            "report.compliance_export",
            "environment.manage",
        ],
    ),
    "developer": ("Developer", _DEVELOPER),
    "viewer": ("Viewer", ["report.view"]),
}


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "insert into permissions (id, code, description) "
            "values (gen_random_uuid(), :code, :description)"
        ),
        {
            "code": _CONTRIBUTE,
            "description": "Comment, attach files, set custom values and use AI on records",
        },
    )
    # Every role that exists now keeps what it could already do.
    bind.execute(
        sa.text(
            "insert into role_permissions (role_id, permission_id) "
            "select r.id, p.id from roles r cross join permissions p where p.code = :code"
        ),
        {"code": _CONTRIBUTE},
    )
    for code, (name, permissions) in _NEW_ROLES.items():
        role_id = bind.execute(
            sa.text(
                "insert into roles (id, code, name, tenant_id, is_system) "
                "values (gen_random_uuid(), :code, :name, null, true) returning id"
            ),
            {"code": code, "name": name},
        ).scalar_one()
        granted = bind.execute(
            sa.text(
                "insert into role_permissions (role_id, permission_id) "
                "select :role_id, id from permissions where code = any(:codes)"
            ),
            {"role_id": role_id, "codes": permissions},
        ).rowcount
        assert granted == len(permissions), (code, granted, len(permissions))


def downgrade() -> None:
    bind = op.get_bind()
    codes = list(_NEW_ROLES)
    in_use = bind.execute(
        sa.text(
            "select (select count(*) from users u join roles r on r.id = u.role_id "
            "        where r.code = any(:codes)) "
            "     + (select count(*) from project_members m join roles r on r.id = m.role_id "
            "        where r.code = any(:codes)) "
            "     + (select count(*) from user_invites i join roles r on r.id = i.role_id "
            "        where r.code = any(:codes))"
        ),
        {"codes": codes},
    ).scalar_one()
    if in_use:
        raise RuntimeError(
            f"{in_use} user(s), invitation(s) or project member(s) have a QA Lead, Developer "
            "or Viewer role. Give them another role before downgrading."
        )
    bind.execute(
        sa.text(
            "delete from role_permissions where role_id in "
            "(select id from roles where code = any(:codes)) "
            "or permission_id in (select id from permissions where code = :contribute)"
        ),
        {"codes": codes, "contribute": _CONTRIBUTE},
    )
    bind.execute(sa.text("delete from roles where code = any(:codes)"), {"codes": codes})
    bind.execute(sa.text("delete from permissions where code = :code"), {"code": _CONTRIBUTE})
