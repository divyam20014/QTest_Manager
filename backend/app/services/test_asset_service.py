from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.errors import ConflictError, NotFoundError
from app.models.project import Project
from app.models.test_asset import Build, Environment, Release
from app.schemas.test_asset import (
    BuildCreateRequest,
    BuildOut,
    EnvironmentCreateRequest,
    EnvironmentOut,
    EnvironmentUpdateRequest,
    ReleaseCreateRequest,
    ReleaseOut,
)


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


def delete_release(db: Session, tenant_id: UUID, actor_user_id: UUID, release_id: UUID) -> None:
    release = db.execute(
        select(Release).where(Release.tenant_id == tenant_id, Release.id == release_id)
    ).scalar_one_or_none()
    if release is None:
        raise NotFoundError("Release not found")
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
