from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, get_current_context, require_permission
from app.core.db import get_db
from app.core.responses import envelope
from app.schemas.test_asset import (
    BuildCreateRequest,
    EnvironmentCreateRequest,
    EnvironmentUpdateRequest,
    ReleaseCreateRequest,
)
from app.services import test_asset_service

router = APIRouter(tags=["test-assets"])


@router.get("/environments")
def list_environments(
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    envs = test_asset_service.list_environments(db, ctx.tenant_id)
    return envelope([e.model_dump(mode="json") for e in envs])


@router.post("/environments")
def create_environment(
    req: EnvironmentCreateRequest,
    ctx: SessionContext = Depends(require_permission("environment.manage")),
    db: Session = Depends(get_db),
) -> dict:
    env = test_asset_service.create_environment(db, ctx.tenant_id, ctx.user_id, req)
    return envelope(env.model_dump(mode="json"))


@router.patch("/environments/{environment_id}")
def update_environment(
    environment_id: UUID,
    req: EnvironmentUpdateRequest,
    ctx: SessionContext = Depends(require_permission("environment.manage")),
    db: Session = Depends(get_db),
) -> dict:
    env = test_asset_service.update_environment(db, ctx.tenant_id, ctx.user_id, environment_id, req)
    return envelope(env.model_dump(mode="json"))


@router.delete("/environments/{environment_id}")
def delete_environment(
    environment_id: UUID,
    ctx: SessionContext = Depends(require_permission("environment.manage")),
    db: Session = Depends(get_db),
) -> dict:
    test_asset_service.delete_environment(db, ctx.tenant_id, ctx.user_id, environment_id)
    return envelope({"deleted": True})


@router.get("/projects/{project_id}/builds")
def list_builds(
    project_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    builds = test_asset_service.list_builds(db, ctx.tenant_id, project_id)
    return envelope([b.model_dump(mode="json") for b in builds])


@router.post("/projects/{project_id}/builds")
def create_build(
    project_id: UUID,
    req: BuildCreateRequest,
    ctx: SessionContext = Depends(require_permission("environment.manage")),
    db: Session = Depends(get_db),
) -> dict:
    build = test_asset_service.create_build(db, ctx.tenant_id, ctx.user_id, project_id, req)
    return envelope(build.model_dump(mode="json"))


@router.delete("/builds/{build_id}")
def delete_build(
    build_id: UUID,
    ctx: SessionContext = Depends(require_permission("environment.manage")),
    db: Session = Depends(get_db),
) -> dict:
    test_asset_service.delete_build(db, ctx.tenant_id, ctx.user_id, build_id)
    return envelope({"deleted": True})


@router.get("/projects/{project_id}/releases")
def list_releases(
    project_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    releases = test_asset_service.list_releases(db, ctx.tenant_id, project_id)
    return envelope([r.model_dump(mode="json") for r in releases])


@router.post("/projects/{project_id}/releases")
def create_release(
    project_id: UUID,
    req: ReleaseCreateRequest,
    ctx: SessionContext = Depends(require_permission("environment.manage")),
    db: Session = Depends(get_db),
) -> dict:
    release = test_asset_service.create_release(db, ctx.tenant_id, ctx.user_id, project_id, req)
    return envelope(release.model_dump(mode="json"))


@router.delete("/releases/{release_id}")
def delete_release(
    release_id: UUID,
    ctx: SessionContext = Depends(require_permission("environment.manage")),
    db: Session = Depends(get_db),
) -> dict:
    test_asset_service.delete_release(db, ctx.tenant_id, ctx.user_id, release_id)
    return envelope({"deleted": True})
