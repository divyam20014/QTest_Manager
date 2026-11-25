from datetime import date
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.errors import ConflictError, NotFoundError
from app.models.project import Project
from app.models.task import Task
from app.models.test_asset import Build, Environment, Release
from app.schemas.test_asset import (
    BuildBulkCreateRequest,
    BuildCreateRequest,
    BuildOut,
    EnvironmentCreateRequest,
    EnvironmentOut,
    EnvironmentUpdateRequest,
    ReleaseBulkCreateRequest,
    ReleaseCreateRequest,
    ReleaseOut,
    ReleaseUpdateRequest,
)
from app.services import project_service


def _env_to_out(env: Environment) -> EnvironmentOut:
    return EnvironmentOut(
        id=env.id, name=env.name, description=env.description, created_at=env.created_at
    )


def list_environments(db: Session, tenant_id: UUID) -> list[EnvironmentOut]:
    rows = db.execute(
        select(Environment).where(Environment.tenant_id == tenant_id).order_by(Environment.name)
    ).scalars()
    return [_env_to_out(e) for e in rows]


def create_environment(
    db: Session, tenant_id: UUID, actor_user_id: UUID, req: EnvironmentCreateRequest
) -> EnvironmentOut:
    existing = db.execute(
        select(Environment).where(
            Environment.tenant_id == tenant_id, Environment.name.ilike(req.name)
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise ConflictError(f"Environment '{req.name}' already exists")

    env = Environment(tenant_id=tenant_id, name=req.name, description=req.description)
    db.add(env)
    db.flush()
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="environment.created",
        entity_type="environment",
        entity_id=env.id,
        metadata={"name": req.name},
    )
    db.commit()
    return _env_to_out(env)


def update_environment(
    db: Session,
    tenant_id: UUID,
    actor_user_id: UUID,
    environment_id: UUID,
    req: EnvironmentUpdateRequest,
) -> EnvironmentOut:
    env = db.execute(
        select(Environment).where(
            Environment.tenant_id == tenant_id, Environment.id == environment_id
        )
    ).scalar_one_or_none()
    if env is None:
        raise NotFoundError("Environment not found")

    if req.name is not None:
        env.name = req.name
    if req.description is not None:
        env.description = req.description

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="environment.updated",
        entity_type="environment",
        entity_id=env.id,
        metadata={},
    )
    db.commit()
    return _env_to_out(env)


def delete_environment(
    db: Session, tenant_id: UUID, actor_user_id: UUID, environment_id: UUID
) -> None:
    env = db.execute(
        select(Environment).where(
            Environment.tenant_id == tenant_id, Environment.id == environment_id
        )
    ).scalar_one_or_none()
    if env is None:
        raise NotFoundError("Environment not found")

    db.delete(env)
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="environment.deleted",
        entity_type="environment",
        entity_id=environment_id,
        metadata={"name": env.name},
    )
    db.commit()


def _get_project_or_404(db: Session, tenant_id: UUID, project_id: UUID) -> Project:
    project = db.execute(
        select(Project).where(Project.tenant_id == tenant_id, Project.id == project_id)
    ).scalar_one_or_none()
    if project is None:
        raise NotFoundError("Project not found")
    return project


def _build_to_out(build: Build) -> BuildOut:
    return BuildOut(
        id=build.id,
        project_id=build.project_id,
        name=build.name,
        built_at=build.built_at,
        notes=build.notes,
        created_at=build.created_at,
    )


def list_builds(db: Session, tenant_id: UUID, project_id: UUID) -> list[BuildOut]:
    _get_project_or_404(db, tenant_id, project_id)
    rows = db.execute(
        select(Build)
        .where(Build.tenant_id == tenant_id, Build.project_id == project_id)
        .order_by(Build.created_at.desc())
    ).scalars()
    return [_build_to_out(b) for b in rows]


def create_build(
    db: Session, tenant_id: UUID, actor_user_id: UUID, project_id: UUID, req: BuildCreateRequest
) -> BuildOut:
    _get_project_or_404(db, tenant_id, project_id)
    build = Build(
        tenant_id=tenant_id,
        project_id=project_id,
        name=req.name,
        built_at=req.built_at,
        notes=req.notes,
    )
    db.add(build)
    db.flush()
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="build.created",
        entity_type="build",
        entity_id=build.id,
        metadata={"name": req.name, "project_id": str(project_id)},
    )
    db.commit()
    return _build_to_out(build)


def bulk_create_builds(
    db: Session, tenant_id: UUID, actor_user_id: UUID, project_id: UUID, req: BuildBulkCreateRequest
) -> list[BuildOut]:
    """Gap-closure pass (ADR-057): one request, one audit event per row,
    one commit -- not N separate create_build calls, so a bulk import
    can't partially commit on a mid-batch error."""
    _get_project_or_404(db, tenant_id, project_id)
    created: list[Build] = []
    for row in req.builds:
        build = Build(
            tenant_id=tenant_id, project_id=project_id, name=row.name, built_at=row.built_at,
            notes=row.notes,
        )
        db.add(build)
        created.append(build)
    db.flush()
    for build in created:
        record_audit_event(
            db,
            tenant_id=tenant_id,
            user_id=actor_user_id,
            action="build.created",
            entity_type="build",
            entity_id=build.id,
            metadata={"name": build.name, "project_id": str(project_id), "bulk": True},
        )
    db.commit()
    return [_build_to_out(b) for b in created]


def delete_build(db: Session, tenant_id: UUID, actor_user_id: UUID, build_id: UUID) -> None:
    build = db.execute(
        select(Build).where(Build.tenant_id == tenant_id, Build.id == build_id)
    ).scalar_one_or_none()
    if build is None:
        raise NotFoundError("Build not found")
    db.delete(build)
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="build.deleted",
        entity_type="build",
        entity_id=build_id,
        metadata={"name": build.name},
    )
    db.commit()


def _release_to_out(release: Release) -> ReleaseOut:
    return ReleaseOut(
        id=release.id,
        project_id=release.project_id,
        name=release.name,
        release_date=release.release_date,
        notes=release.notes,
        status=release.status,  # type: ignore[arg-type]  # validated on write
        created_at=release.created_at,
    )


def list_releases(db: Session, tenant_id: UUID, project_id: UUID) -> list[ReleaseOut]:
    _get_project_or_404(db, tenant_id, project_id)
    rows = db.execute(
        select(Release)
        .where(Release.tenant_id == tenant_id, Release.project_id == project_id)
        .order_by(Release.created_at.desc())
    ).scalars()
    return [_release_to_out(r) for r in rows]


def create_release(
    db: Session, tenant_id: UUID, actor_user_id: UUID, project_id: UUID, req: ReleaseCreateRequest
) -> ReleaseOut:
    _get_project_or_404(db, tenant_id, project_id)
    release = Release(
        tenant_id=tenant_id,
        project_id=project_id,
        name=req.name,
        release_date=req.release_date,
        notes=req.notes,
        status=req.status,
    )
    db.add(release)
    db.flush()
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="release.created",
        entity_type="release",
        entity_id=release.id,
        metadata={"name": req.name, "project_id": str(project_id)},
    )
    db.commit()
    return _release_to_out(release)


def bulk_create_releases(
    db: Session,
    tenant_id: UUID,
    actor_user_id: UUID,
    project_id: UUID,
    req: ReleaseBulkCreateRequest,
) -> list[ReleaseOut]:
    _get_project_or_404(db, tenant_id, project_id)
    created: list[Release] = []
    for row in req.releases:
        release = Release(
            tenant_id=tenant_id, project_id=project_id, name=row.name,
            release_date=row.release_date, notes=row.notes, status=row.status,
        )
        db.add(release)
        created.append(release)
    db.flush()
    for release in created:
        record_audit_event(
            db,
            tenant_id=tenant_id,
            user_id=actor_user_id,
            action="release.created",
            entity_type="release",
            entity_id=release.id,
            metadata={"name": release.name, "project_id": str(project_id), "bulk": True},
        )
    db.commit()
    return [_release_to_out(r) for r in created]


def update_release(
    db: Session,
    tenant_id: UUID,
    actor_user_id: UUID,
    role_code: str,
    release_id: UUID,
    req: ReleaseUpdateRequest,
) -> ReleaseOut:
    """ADR-122: edit a release. Project visibility follows get_project (a Tester outside the
    project sees 404); the permission gate is the one the other release writes use."""
    release = db.execute(
        select(Release).where(Release.tenant_id == tenant_id, Release.id == release_id)
    ).scalar_one_or_none()
    if release is None:
        raise NotFoundError("Release not found")
    project_service.get_project(db, tenant_id, role_code, actor_user_id, release.project_id)
    changes = req.model_dump(exclude_unset=True)
    before = {field: getattr(release, field) for field in changes}
    for field, value in changes.items():
        setattr(release, field, value)
    db.flush()
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="release.updated",
        entity_type="release",
        entity_id=release.id,
        metadata={
            "project_id": str(release.project_id),
            "changes": {
                field: {"from": _jsonable(before[field]), "to": _jsonable(value)}
                for field, value in changes.items()
            },
        },
    )
    db.commit()
    return _release_to_out(release)


def _jsonable(value: object) -> object:
    return value.isoformat() if isinstance(value, date) else value


def delete_release(db: Session, tenant_id: UUID, actor_user_id: UUID, release_id: UUID) -> None:
    release = db.execute(
        select(Release).where(Release.tenant_id == tenant_id, Release.id == release_id)
    ).scalar_one_or_none()
    if release is None:
        raise NotFoundError("Release not found")
    # ADR-127: tasks planned for the release stay, without a release.
    db.execute(
        update(Task)
        .where(Task.tenant_id == tenant_id, Task.release_id == release_id)
        .values(release_id=None)
    )
    db.delete(release)
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="release.deleted",
        entity_type="release",
        entity_id=release_id,
        metadata={"name": release.name},
    )
    db.commit()
