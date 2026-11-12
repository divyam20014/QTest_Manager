from typing import cast
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, require_permission
from app.core.db import get_db
from app.core.responses import envelope
from app.models.report_schedule import ReportSchedule
from app.schemas.report_schedule import (
    ReportCadence,
    ReportScheduleCreateRequest,
    ReportScheduleOut,
    ReportScheduleUpdateRequest,
)
from app.services import report_schedule_service

router = APIRouter(prefix="/report-schedules", tags=["report-schedules"])


@router.get("")
def list_schedules(
    ctx: SessionContext = Depends(require_permission("report.schedule_manage")),
    db: Session = Depends(get_db),
) -> dict:
    schedules = report_schedule_service.list_schedules(db, ctx.tenant_id)
    return envelope([_to_out(s).model_dump(mode="json") for s in schedules])


@router.post("")
def create_schedule(
    req: ReportScheduleCreateRequest,
    ctx: SessionContext = Depends(require_permission("report.schedule_manage")),
    db: Session = Depends(get_db),
) -> dict:
    schedule = report_schedule_service.create_schedule(db, ctx.tenant_id, ctx.user_id, req)
    return envelope(_to_out(schedule).model_dump(mode="json"))


@router.patch("/{schedule_id}")
def update_schedule(
    schedule_id: UUID,
    req: ReportScheduleUpdateRequest,
    ctx: SessionContext = Depends(require_permission("report.schedule_manage")),
    db: Session = Depends(get_db),
) -> dict:
    schedule = report_schedule_service.update_schedule(db, ctx.tenant_id, schedule_id, req)
    return envelope(_to_out(schedule).model_dump(mode="json"))


@router.delete("/{schedule_id}")
def delete_schedule(
    schedule_id: UUID,
    ctx: SessionContext = Depends(require_permission("report.schedule_manage")),
    db: Session = Depends(get_db),
) -> dict:
    report_schedule_service.delete_schedule(db, ctx.tenant_id, schedule_id)
    return envelope({"deleted": True})


def _to_out(schedule: ReportSchedule) -> ReportScheduleOut:
    return ReportScheduleOut(
        id=schedule.id,
        report_type=schedule.report_type,
        cadence=cast(ReportCadence, schedule.cadence),
        recipient_emails=schedule.recipient_emails,
        enabled=schedule.enabled,
        last_run_at=schedule.last_run_at,
        created_at=schedule.created_at,
    )
