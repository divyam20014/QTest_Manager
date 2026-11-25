"""ADR-127 phase 1: the Task / sub-task data model and its hierarchy rules.

Exercised straight against PostgreSQL (owner connection) so the database itself, not just a
service, is shown to enforce the rules: same-project parent, depth = parent + 1 with a cap,
no self-parenting, no cycles, same-project requirement/defect links, immutable display id,
RLS isolation, and the seeded tenant defaults.
"""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.core.field_standards import MAX_TASK_DEPTH
from tests.test_display_ids import _bootstrap, _login, _project


def _tenant(client, platform_admin, name, email):
    data = _bootstrap(client, platform_admin, name, email)
    tenant_id = data["tenant"]["id"]
    _login(client, tenant_id, email)
    return tenant_id, _project(client, name=f"{name} project")


def _status_id(conn, tenant_id, code="todo"):
    return conn.execute(
        text("select id from task_statuses where tenant_id = :t and code = :c"),
        {"t": tenant_id, "c": code},
    ).scalar_one()


def _user_id(conn, tenant_id):
    return conn.execute(
        text("select id from users where tenant_id = :t limit 1"), {"t": tenant_id}
    ).scalar_one()


def _insert_task(conn, tenant_id, project_id, *, parent=None, depth=0, title="A task", **extra):
    task_id = uuid.uuid4()
    conn.execute(
        text(
            "insert into tasks (id, tenant_id, project_id, parent_task_id, depth, title, "
            "status_id, created_by) values (:id, :t, :p, :parent, :d, :title, :s, :u)"
        ),
        {
            "id": task_id,
            "t": tenant_id,
            "p": project_id,
            "parent": parent,
            "d": depth,
            "title": title,
            "s": _status_id(conn, tenant_id),
            "u": _user_id(conn, tenant_id),
        },
    )
    return task_id


def test_new_tenant_is_seeded_with_task_statuses_and_priorities(
    client, platform_admin, owner_engine
) -> None:
    tenant_id, _ = _tenant(client, platform_admin, "Seeded", "admin@seeded.com")
    with owner_engine.begin() as conn:
        rows = conn.execute(
            text(
                "select code, category, is_default from task_statuses "
                "where tenant_id = :t order by sort_order"
            ),
            {"t": tenant_id},
        ).all()
        priorities = (
            conn.execute(
                text(
                    "select code from field_options where tenant_id = :t "
                    "and field_key = 'task_priority' order by sort_order"
                ),
                {"t": tenant_id},
            )
            .scalars()
            .all()
        )
    assert [(r.code, r.category, r.is_default) for r in rows] == [
        ("todo", "todo", True),
        ("in_progress", "in_progress", False),
        ("done", "done", False),
    ]
    assert priorities == ["High", "Medium", "Low"]


def test_sub_task_hierarchy_rules(client, platform_admin, owner_engine) -> None:
    tenant_id, project = _tenant(client, platform_admin, "Hier", "admin@hier.com")
    other_project = _project(client, name="Hier second project")
    with owner_engine.begin() as conn:
        root = _insert_task(conn, tenant_id, project["id"], title="Root task")
        child = _insert_task(conn, tenant_id, project["id"], parent=root, depth=1, title="Child")
        assert child is not None

    # A sub-task must live in its parent's project.
    with pytest.raises(IntegrityError), owner_engine.begin() as conn:
        _insert_task(conn, tenant_id, other_project["id"], parent=root, depth=1)

    # depth must be exactly parent.depth + 1 (trigger) and root depth must be 0 (check).
    with pytest.raises((IntegrityError, DBAPIError)), owner_engine.begin() as conn:
        _insert_task(conn, tenant_id, project["id"], parent=root, depth=2)
    with pytest.raises(IntegrityError), owner_engine.begin() as conn:
        _insert_task(conn, tenant_id, project["id"], depth=1)

    # A task cannot be its own parent.
    with pytest.raises(IntegrityError), owner_engine.begin() as conn:
        conn.execute(
            text("update tasks set parent_task_id = id, depth = 1 where id = :id"), {"id": root}
        )


def test_depth_is_capped_and_cycles_are_impossible(client, platform_admin, owner_engine) -> None:
    tenant_id, project = _tenant(client, platform_admin, "Deep", "admin@deep.com")
    with owner_engine.begin() as conn:
        chain = [_insert_task(conn, tenant_id, project["id"], title="Level 0")]
        for level in range(1, MAX_TASK_DEPTH + 1):
            chain.append(
                _insert_task(
                    conn,
                    tenant_id,
                    project["id"],
                    parent=chain[-1],
                    depth=level,
                    title=f"Level {level}",
                )
            )
    # One level past the cap is refused.
    with pytest.raises(IntegrityError), owner_engine.begin() as conn:
        _insert_task(
            conn,
            tenant_id,
            project["id"],
            parent=chain[-1],
            depth=MAX_TASK_DEPTH + 1,
            title="Too deep",
        )
    # Making the root a child of its own descendant cannot satisfy depth = parent + 1.
    with pytest.raises((IntegrityError, DBAPIError)), owner_engine.begin() as conn:
        conn.execute(
            text("update tasks set parent_task_id = :leaf, depth = 5 where id = :root"),
            {"leaf": chain[-1], "root": chain[0]},
        )
    with pytest.raises((IntegrityError, DBAPIError)), owner_engine.begin() as conn:
        conn.execute(
            text("update tasks set parent_task_id = :child, depth = 2 where id = :root"),
            {"child": chain[1], "root": chain[0]},
        )


def test_requirement_and_defect_task_must_share_the_project(
    client, platform_admin, owner_engine
) -> None:
    tenant_id, project = _tenant(client, platform_admin, "Links", "admin@links.com")
    other_project = _project(client, name="Links second project")
    with owner_engine.begin() as conn:
        task = _insert_task(conn, tenant_id, project["id"], title="Linked task")
        user = _user_id(conn, tenant_id)

    requirement = client.post(
        f"/api/v1/projects/{project['id']}/requirements",
        json={"title": "A requirement title", "description": "text"},
    )
    assert requirement.status_code == 200, requirement.text
    requirement_id = requirement.json()["data"]["id"]
    foreign_requirement = client.post(
        f"/api/v1/projects/{other_project['id']}/requirements",
        json={"title": "Another requirement", "description": "text"},
    )
    assert foreign_requirement.status_code == 200, foreign_requirement.text
    foreign_id = foreign_requirement.json()["data"]["id"]

    with owner_engine.begin() as conn:
        conn.execute(
            text("update requirements set task_id = :t where id = :r"),
            {"t": task, "r": requirement_id},
        )
    # Same project: accepted. Other project: refused by the composite FK.
    with pytest.raises(IntegrityError), owner_engine.begin() as conn:
        conn.execute(
            text("update requirements set task_id = :t where id = :r"),
            {"t": task, "r": foreign_id},
        )
    assert user is not None

    defect = client.post(
        "/api/v1/defects",
        json={"project_id": other_project["id"], "title": "Cross project", "severity": "High"},
    )
    assert defect.status_code == 200, defect.text
    with pytest.raises(IntegrityError), owner_engine.begin() as conn:
        conn.execute(
            text("update defects set task_id = :t where id = :d"),
            {"t": task, "d": defect.json()["data"]["id"]},
        )


def test_task_display_id_is_immutable_and_unique(client, platform_admin, owner_engine) -> None:
    tenant_id, project = _tenant(client, platform_admin, "Disp", "admin@disp.com")
    with owner_engine.begin() as conn:
        first = _insert_task(conn, tenant_id, project["id"], title="First task")
        second = _insert_task(conn, tenant_id, project["id"], title="Second task")
        conn.execute(
            text("update tasks set display_seq = 1, display_id = 'TASK_000001' where id = :id"),
            {"id": first},
        )
    with pytest.raises((IntegrityError, DBAPIError)), owner_engine.begin() as conn:
        conn.execute(
            text("update tasks set display_id = 'TASK_000009' where id = :id"), {"id": first}
        )
    with pytest.raises(IntegrityError), owner_engine.begin() as conn:
        conn.execute(
            text("update tasks set display_seq = 1, display_id = 'TASK_000001' where id = :id"),
            {"id": second},
        )


def test_task_tables_are_isolated_per_tenant(client, platform_admin, owner_engine) -> None:
    from app.core.db import SessionLocal

    tenant_a, project_a = _tenant(client, platform_admin, "Iso A", "admin@isoa.com")
    tenant_b, _ = _tenant(client, platform_admin, "Iso B", "admin@isob.com")
    with owner_engine.begin() as conn:
        _insert_task(conn, tenant_a, project_a["id"], title="Tenant A task")

    session = SessionLocal()
    try:
        for tenant, expected in ((tenant_a, 1), (tenant_b, 0)):
            session.execute(
                text("select set_config('app.current_tenant', :t, true)"), {"t": tenant}
            )
            assert session.execute(text("select count(*) from tasks")).scalar_one() == expected
            assert session.execute(text("select count(*) from task_statuses")).scalar_one() == 3
            session.rollback()
    finally:
        session.close()


def test_one_default_status_per_tenant(client, platform_admin, owner_engine) -> None:
    tenant_id, _ = _tenant(client, platform_admin, "Dflt", "admin@dflt.com")
    with pytest.raises(IntegrityError), owner_engine.begin() as conn:
        conn.execute(
            text("update task_statuses set is_default = true where tenant_id = :t"),
            {"t": tenant_id},
        )
