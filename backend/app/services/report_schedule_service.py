"""Pass 4 (ADR-065): recurring compliance-report email delivery.

Reuses Tier 1's existing DB-backed worker loop (app.worker) rather than
new scheduler infra -- the worker already runs a periodic sweep
(defect_service.sweep_sla_breaches) on its own cadence independent of job
claims; this adds a second sweep following that exact pattern.
"""

import smtplib
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import _load_role_and_permissions
from app.core.config import get_settings
from app.core.db import set_tenant_context
from app.core.errors import ConfigurationError, NotFoundError, UnauthorizedError
from app.core.pdf_report import render_compliance_report_pdf
from app.models.identity import User
from app.models.report_schedule import ReportSchedule
from app.models.tenant import Tenant
from app.schemas.report_schedule import ReportScheduleCreateRequest, ReportScheduleUpdateRequest
from app.services import reporting_service

_CADENCE_INTERVALS = {
    "daily": timedelta(days=1),
    "weekly": timedelta(weeks=1),
    "monthly": timedelta(days=30),
}


def list_schedules(db: Session, tenant_id: UUID) -> list[ReportSchedule]:
    set_tenant_context(db, str(tenant_id))
    return list(
        db.execute(
            select(ReportSchedule)
            .where(ReportSchedule.tenant_id == tenant_id)
            .order_by(ReportSchedule.created_at)
        ).scalars()
    )


def create_schedule(
    db: Session, tenant_id: UUID, created_by: UUID, req: ReportScheduleCreateRequest
) -> ReportSchedule:
    set_tenant_context(db, str(tenant_id))
    schedule = ReportSchedule(
        tenant_id=tenant_id,
        report_type="compliance",
        cadence=req.cadence,
        recipient_emails=[str(e) for e in req.recipient_emails],
        enabled=req.enabled,
        created_by=created_by,
    )
    db.add(schedule)
    db.commit()
    set_tenant_context(db, str(tenant_id))
    return schedule


def _get_or_404(db: Session, tenant_id: UUID, schedule_id: UUID) -> ReportSchedule:
    set_tenant_context(db, str(tenant_id))
    schedule = db.execute(
        select(ReportSchedule).where(
            ReportSchedule.id == schedule_id, ReportSchedule.tenant_id == tenant_id
        )
    ).scalar_one_or_none()
    if schedule is None:
        raise NotFoundError("Report schedule not found")
    return schedule


def update_schedule(
    db: Session, tenant_id: UUID, schedule_id: UUID, req: ReportScheduleUpdateRequest
) -> ReportSchedule:
    schedule = _get_or_404(db, tenant_id, schedule_id)
    if req.cadence is not None:
        schedule.cadence = req.cadence
    if req.recipient_emails is not None:
        schedule.recipient_emails = [str(e) for e in req.recipient_emails]
    if req.enabled is not None:
        schedule.enabled = req.enabled
    db.commit()
    set_tenant_context(db, str(tenant_id))
    return schedule


def delete_schedule(db: Session, tenant_id: UUID, schedule_id: UUID) -> None:
    schedule = _get_or_404(db, tenant_id, schedule_id)
    db.delete(schedule)
    db.commit()


def _send_report_email(recipients: list[str], pdf_bytes: bytes, tenant_name: str) -> None:
    """Sibling of notification_service._deliver_email with attachment
    support -- kept separate rather than extending the shared helper, so
    every other notify() call site's behavior is untouched by this
    change. Same simulated/real split, same fail-loud-if-misconfigured
    convention as every other email-sending feature in this codebase."""
    settings = get_settings()
    if settings.notification_email_delivery_mode != "real":
        return
    if not settings.smtp_host:
        raise ConfigurationError(
            "Scheduled report delivery mode is 'real' but SMTP is not configured "
            "(smtp_host is empty)"
        )

    message = EmailMessage()
    message["Subject"] = f"QTestHub Compliance Report — {tenant_name}"
    message["From"] = settings.smtp_from_email
    message["To"] = ", ".join(recipients)
    message.set_content("Your scheduled QTestHub compliance report is attached as a PDF.")
    message.add_attachment(
        pdf_bytes, maintype="application", subtype="pdf", filename="compliance_report.pdf"
    )

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as client:
        if settings.smtp_use_tls:
            client.starttls()
        if settings.smtp_username:
            client.login(settings.smtp_username, settings.smtp_password)
        client.send_message(message)


def run_due_schedules(db: Session) -> int:
    """Called periodically by app.worker, same pattern as
    defect_service.sweep_sla_breaches: iterate approved tenants, set
    tenant context per tenant before querying that tenant's rows (the
    transaction-local RLS GUC resets on every commit, so this must be
    re-asserted before each tenant's query, not just once up front).
    Returns the number of reports actually sent, for the worker's log."""
    sent = 0
    now = datetime.now(UTC)
    tenant_ids = db.execute(select(Tenant.id).where(Tenant.status == "approved")).scalars().all()
    for tenant_id in tenant_ids:
        set_tenant_context(db, str(tenant_id))
        tenant = db.execute(select(Tenant).where(Tenant.id == tenant_id)).scalar_one()
        schedules = db.execute(
            select(ReportSchedule).where(
                ReportSchedule.tenant_id == tenant_id, ReportSchedule.enabled.is_(True)
            )
        ).scalars().all()
        for schedule in schedules:
            interval = _CADENCE_INTERVALS[schedule.cadence]
            if schedule.last_run_at is not None and now - schedule.last_run_at < interval:
                continue
            reporting_officer = db.execute(
                select(User).where(User.id == schedule.created_by)
            ).scalar_one_or_none()
            if reporting_officer is None:
                continue
            try:
                # Re-resolve the creator's *current* effective role rather
                # than assuming "admin" (true only at creation time, since
                # report.schedule_manage is admin-only) -- a role change
                # since then must not silently widen what this report
                # includes.
                role_code, _, _ = _load_role_and_permissions(db, tenant_id, schedule.created_by)
            except UnauthorizedError:
                continue
            report = reporting_service.get_compliance_report(
                db, tenant_id, reporting_officer, role_code, schedule.created_by
            )
            pdf_bytes = render_compliance_report_pdf(report)
            _send_report_email(schedule.recipient_emails, pdf_bytes, tenant.name)
            schedule.last_run_at = now
            db.commit()
            set_tenant_context(db, str(tenant_id))
            sent += 1
    return sent
