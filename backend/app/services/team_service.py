"""ADR-141: teams, and adding a team's members to a project."""

from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.errors import ConflictError, NotFoundError, ProjectArchivedError
from app.models.identity import User
from app.models.project import ProjectMember
from app.models.team import Team, TeamMember
from app.schemas.team import (
    TeamAddToProjectOut,
    TeamCreateRequest,
    TeamMemberOut,
    TeamOut,
    TeamUpdateRequest,
)
from app.services import project_service

_NAME_TAKEN = "A team with this name already exists"


def _get_team_or_404(db: Session, tenant_id: UUID, team_id: UUID, *, lock: bool = False) -> Team:
    query = select(Team).where(Team.tenant_id == tenant_id, Team.id == team_id)
    if lock:
        query = query.with_for_update()
    team = db.execute(query).scalar_one_or_none()
    if team is None:
        raise NotFoundError("Team not found")
    return team


def _check_users(db: Session, tenant_id: UUID, user_ids: set[UUID]) -> None:
    if not user_ids:
        return
    found = db.execute(
        select(func.count(User.id)).where(User.tenant_id == tenant_id, User.id.in_(user_ids))
    ).scalar_one()
    if found != len(user_ids):
        raise NotFoundError("User not found")


def _check_name_free(db: Session, tenant_id: UUID, name: str, team_id: UUID | None) -> None:
    query = select(Team.id).where(
        Team.tenant_id == tenant_id, func.lower(Team.name) == name.lower()
    )
    if team_id is not None:
        query = query.where(Team.id != team_id)
    if db.execute(query).first() is not None:
        raise ConflictError(_NAME_TAKEN)


def _flush(db: Session) -> None:
    try:
        db.flush()
    except IntegrityError as exc:  # two requests took the same name at once
        db.rollback()
        raise ConflictError(_NAME_TAKEN) from exc


def to_out_many(db: Session, teams: list[Team]) -> list[TeamOut]:
    members: dict[UUID, list[TeamMemberOut]] = {t.id: [] for t in teams}
    if teams:
        rows = db.execute(
            select(TeamMember.team_id, User.id, User.name, User.is_active)
            .join(User, User.id == TeamMember.user_id)
            .where(TeamMember.team_id.in_(members))
            .order_by(User.name, User.id)
        )
        for team_id, user_id, name, is_active in rows:
            members[team_id].append(TeamMemberOut(user_id=user_id, name=name, is_active=is_active))
    lead_ids = {t.lead_user_id for t in teams if t.lead_user_id}
    leads: dict[UUID, str] = {}
    if lead_ids:
        leads = dict(
            db.execute(select(User.id, User.name).where(User.id.in_(lead_ids))).tuples().all()
        )
    return [
        TeamOut(
            id=t.id,
            name=t.name,
            lead_user_id=t.lead_user_id,
            lead_name=leads.get(t.lead_user_id) if t.lead_user_id else None,
            members=members[t.id],
        )
        for t in teams
    ]


def list_teams(db: Session, tenant_id: UUID) -> list[TeamOut]:
    teams = db.execute(
        select(Team).where(Team.tenant_id == tenant_id).order_by(func.lower(Team.name))
    ).scalars()
    return to_out_many(db, list(teams))


def _add_members(db: Session, tenant_id: UUID, team_id: UUID, user_ids: set[UUID]) -> None:
    db.add_all(
        TeamMember(tenant_id=tenant_id, team_id=team_id, user_id=user_id) for user_id in user_ids
    )


def create_team(
    db: Session, tenant_id: UUID, actor_user_id: UUID, req: TeamCreateRequest
) -> TeamOut:
    members = set(req.member_ids)
    _check_users(db, tenant_id, members | ({req.lead_user_id} if req.lead_user_id else set()))
    _check_name_free(db, tenant_id, req.name, None)
    team = Team(tenant_id=tenant_id, name=req.name, lead_user_id=req.lead_user_id)
    db.add(team)
    _flush(db)
    _add_members(db, tenant_id, team.id, members)
    db.flush()
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="team.created",
        entity_type="team",
        entity_id=team.id,
        metadata={"name": team.name, "member_count": len(members)},
    )
    out = to_out_many(db, [team])[0]
    db.commit()
    return out


def update_team(
    db: Session, tenant_id: UUID, actor_user_id: UUID, team_id: UUID, req: TeamUpdateRequest
) -> TeamOut:
    team = _get_team_or_404(db, tenant_id, team_id, lock=True)
    sent = req.model_fields_set
    changes: dict[str, object] = {}
    if req.name is not None and req.name != team.name:
        _check_name_free(db, tenant_id, req.name, team.id)
        changes["name"] = {"from": team.name, "to": req.name}
        team.name = req.name
    if "lead_user_id" in sent and req.lead_user_id != team.lead_user_id:
        if req.lead_user_id is not None:
            _check_users(db, tenant_id, {req.lead_user_id})
        changes["lead_user_id"] = str(req.lead_user_id) if req.lead_user_id else None
        team.lead_user_id = req.lead_user_id
    if req.member_ids is not None:
        wanted = set(req.member_ids)
        current = set(
            db.execute(select(TeamMember.user_id).where(TeamMember.team_id == team.id)).scalars()
        )
        _check_users(db, tenant_id, wanted - current)
        removed, added = current - wanted, wanted - current
        if removed:
            db.execute(
                delete(TeamMember).where(
                    TeamMember.team_id == team.id, TeamMember.user_id.in_(removed)
                )
            )
        _add_members(db, tenant_id, team.id, added)
        if added or removed:
            changes["members_added"] = sorted(str(u) for u in added)
            changes["members_removed"] = sorted(str(u) for u in removed)
    _flush(db)
    if changes:
        record_audit_event(
            db,
            tenant_id=tenant_id,
            user_id=actor_user_id,
            action="team.updated",
            entity_type="team",
            entity_id=team.id,
            metadata=changes,
        )
    out = to_out_many(db, [team])[0]
    db.commit()
    return out


def delete_team(db: Session, tenant_id: UUID, actor_user_id: UUID, team_id: UUID) -> None:
    team = _get_team_or_404(db, tenant_id, team_id, lock=True)
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="team.deleted",
        entity_type="team",
        entity_id=team.id,
        metadata={"name": team.name},
    )
    db.delete(team)  # memberships of the team go with it; project memberships stay
    db.commit()


def add_to_project(
    db: Session,
    tenant_id: UUID,
    actor_user_id: UUID,
    role_code: str,
    project_id: UUID,
    team_id: UUID,
) -> TeamAddToProjectOut:
    """Adds the team's active members who are not yet on the project, each with their own
    organization role. The same people who may add one member may do this."""
    project = project_service.get_project_for_member_change(
        db, tenant_id, actor_user_id, role_code, project_id
    )
    if project.archived_at is not None:
        raise ProjectArchivedError()
    team = _get_team_or_404(db, tenant_id, team_id)
    people = db.execute(
        select(User.id, User.is_active)
        .join(TeamMember, TeamMember.user_id == User.id)
        .where(TeamMember.team_id == team.id, User.tenant_id == tenant_id)
    ).all()
    on_project = set(
        db.execute(
            select(ProjectMember.user_id).where(ProjectMember.project_id == project.id)
        ).scalars()
    )
    new = [p.id for p in people if p.is_active and p.id not in on_project]
    result = TeamAddToProjectOut(
        added=len(new),
        already_members=sum(1 for p in people if p.id in on_project),
        skipped_inactive=sum(1 for p in people if not p.is_active and p.id not in on_project),
    )
    if new:
        db.add_all(ProjectMember(project_id=project.id, user_id=user_id) for user_id in new)
        record_audit_event(
            db,
            tenant_id=tenant_id,
            user_id=actor_user_id,
            action="project.team_added",
            entity_type="project",
            entity_id=project.id,
            metadata={"team_id": str(team.id), "user_ids": sorted(str(u) for u in new)},
        )
        db.commit()
    return result
