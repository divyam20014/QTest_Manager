"""ADR-141: teams. Managing them needs the permission that manages users."""

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, require_any_permission, require_permission
from app.core.db import get_db
from app.core.responses import envelope
from app.schemas.team import TeamCreateRequest, TeamUpdateRequest
from app.services import team_service

router = APIRouter(tags=["teams"])


@router.get("/teams")
def list_teams(
    ctx: SessionContext = Depends(require_any_permission("user.manage", "project.members.manage")),
    db: Session = Depends(get_db),
) -> dict:
    teams = team_service.list_teams(db, ctx.tenant_id)
    return envelope([t.model_dump(mode="json") for t in teams])


@router.post("/teams")
def create_team(
    req: TeamCreateRequest,
    ctx: SessionContext = Depends(require_permission("user.manage")),
    db: Session = Depends(get_db),
) -> dict:
    team = team_service.create_team(db, ctx.tenant_id, ctx.user_id, req)
    return envelope(team.model_dump(mode="json"))


@router.patch("/teams/{team_id}")
def update_team(
    team_id: UUID,
    req: TeamUpdateRequest,
    ctx: SessionContext = Depends(require_permission("user.manage")),
    db: Session = Depends(get_db),
) -> dict:
    team = team_service.update_team(db, ctx.tenant_id, ctx.user_id, team_id, req)
    return envelope(team.model_dump(mode="json"))


@router.delete("/teams/{team_id}")
def delete_team(
    team_id: UUID,
    ctx: SessionContext = Depends(require_permission("user.manage")),
    db: Session = Depends(get_db),
) -> dict:
    team_service.delete_team(db, ctx.tenant_id, ctx.user_id, team_id)
    return envelope({"deleted": True})


@router.post("/projects/{project_id}/teams/{team_id}")
def add_team_to_project(
    project_id: UUID,
    team_id: UUID,
    ctx: SessionContext = Depends(require_permission("project.members.manage")),
    db: Session = Depends(get_db),
) -> dict:
    result = team_service.add_to_project(
        db, ctx.tenant_id, ctx.user_id, ctx.role_code, project_id, team_id
    )
    return envelope(result.model_dump(mode="json"))
