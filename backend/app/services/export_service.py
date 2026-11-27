"""Tier 4 / ADR-054: tenant-wide data export (PV-11.5).

Distinct from the existing per-user GDPR-erase action -- this is a genuine
bulk export of everything a tenant owns. Reuses Tier 1's DB-backed job
queue (SR-6.10) rather than a synchronous blocking endpoint, and Tier 1's
storage abstraction for the resulting archive rather than a raw
filesystem path.

Scope decision (documented, not hidden): this exports each entity's own
*columns* as flat JSON, not the richly joined/computed read-model each
API list endpoint returns (e.g. DefectOut's `project_name`,
`reviewer_name`, etc.) -- those are derived, re-creatable from the raw
rows this export does include, and reusing them all here would require
duplicating every service's per-project permission-scoped listing logic
for a job that is intentionally tenant-wide, not per-project. Attachment
*bytes* are listed by reference/metadata only, not inlined, to keep the
archive a bounded size regardless of how much binary content a tenant has
accumulated -- a future phase could add an opt-in "include attachment
bytes" mode if a real need for that surfaces.

ADR-138: every table is either exported or listed in `EXCLUDED_TABLES` with
the reason. A test compares both lists with the database, so a new table
cannot be left out by accident.
"""

import io
import json
import zipfile
from datetime import date, datetime, time
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import DeclarativeBase, Session

from app.core.db import set_tenant_context
from app.core.errors import ForbiddenError, NotFoundError, ValidationAppError
from app.core.storage import get_storage_backend
from app.models.access_rule import AccessRule
from app.models.ai_usage import AIUsageLog
from app.models.audit import AuditLog
from app.models.background_job import BackgroundJob
from app.models.comment import Comment, CommentMention
from app.models.dashboard import Dashboard, DashboardWidget
from app.models.defect import Defect, DefectLink
from app.models.execution import ExecutionStep, TestRun, TestRunCase
from app.models.field_customization import (
    CustomFieldDefinition,
    CustomFieldValue,
    FieldOption,
    StatusLabel,
)
from app.models.identity import Permission, Role, RolePermission, User
from app.models.notification import Notification
from app.models.project import Project, ProjectMember
from app.models.report_schedule import ReportSchedule
from app.models.requirement import Requirement, RequirementTestCaseLink, RequirementVersion
from app.models.saved_report import SavedReport
from app.models.saved_view import SavedView
from app.models.shared_step import SharedStep
from app.models.sso_config import SsoConfig
from app.models.subscription import Subscription
from app.models.task import Task, TaskStatus, TaskTestCaseLink
from app.models.team import Team, TeamMember
from app.models.tenant import Tenant
from app.models.test_asset import Build, Environment, Release
from app.models.test_case import Attachment, TestCase, TestCaseVersion, TestCaseVersionStep
from app.models.test_data_set import TestDataSet, TestDataSetRow
from app.models.test_module import TestModule
from app.models.test_plan import TestPlan, TestPlanRun
from app.models.test_suite import TestSuite, TestSuiteCase
from app.services import job_service

TENANT_EXPORT_JOB_TYPE = "tenant_export"

# Columns that must never leave the system, even in an admin-triggered
# export -- the same credentials every other part of this codebase treats
# as write-only/never-serialized.
_EXCLUDED_COLUMNS = {
    "password_hash",
    "token_hash",
    "code_hash",
    "client_secret_encrypted",
    "ai_api_key_encrypted",
}

# ADR-138: tables that are deliberately not in a tenant's export.
EXCLUDED_TABLES: dict[str, str] = {
    "sessions": "sign-in sessions (credentials)",
    "mfa_challenges": "one-time sign-in codes (credentials)",
    "user_invites": "invitation tokens (credentials)",
    "scim_tokens": "provisioning tokens (credentials)",
    "service_tokens": "integration tokens (credentials)",
    "background_jobs": "internal job queue, with internal file references",
    "idempotency_keys": "short-lived request de-duplication",
    "import_sessions": "uploads waiting to be committed",
    "entity_counters": "counters behind display IDs; the IDs are on the records",
    "permissions": "the product's permission list; codes appear in role_permissions",
    "plans": "the product's price plans",
    "marketing_leads": "the provider's sales enquiries",
    "audit_chain_checkpoints": "seals over the audit chains, kept by the provider",
    "platform_admins": "the provider's administrators",
    "platform_admin_recovery_codes": "the provider's credentials",
    "platform_sessions": "the provider's sessions",
    "platform_audit_events": "the provider's own audit log",
}

# Exported, but not selected by their own `tenant_id` column alone.
_SPECIAL_TABLES = ("tenants", "roles", "project_members", "role_permissions")

_EXPORT_MODELS: list[tuple[str, type[DeclarativeBase]]] = [
    ("users", User),
    ("projects", Project),
    ("test_modules", TestModule),
    ("test_cases", TestCase),
    ("test_case_versions", TestCaseVersion),
    ("test_case_version_steps", TestCaseVersionStep),
    ("attachments", Attachment),
    ("requirements", Requirement),
    ("requirement_versions", RequirementVersion),
    ("requirement_test_case_links", RequirementTestCaseLink),
    ("test_runs", TestRun),
    ("test_run_cases", TestRunCase),
    ("execution_steps", ExecutionStep),
    ("defects", Defect),
    ("defect_links", DefectLink),
    ("comments", Comment),
    ("comment_mentions", CommentMention),
    ("environments", Environment),
    ("builds", Build),
    ("releases", Release),
    # ADR-127: tasks, their tenant statuses and the task <-> test case links.
    ("task_statuses", TaskStatus),
    ("tasks", Task),
    ("task_test_case_links", TaskTestCaseLink),
    # ADR-138: previously left out.
    ("test_suites", TestSuite),
    ("test_suite_cases", TestSuiteCase),
    ("test_plans", TestPlan),
    ("test_plan_runs", TestPlanRun),
    ("shared_steps", SharedStep),
    ("test_data_sets", TestDataSet),
    ("test_data_set_rows", TestDataSetRow),
    ("custom_field_definitions", CustomFieldDefinition),
    ("custom_field_values", CustomFieldValue),
    ("field_options", FieldOption),
    ("status_labels", StatusLabel),
    ("saved_views", SavedView),
    ("saved_reports", SavedReport),
    ("report_schedules", ReportSchedule),
    ("dashboards", Dashboard),
    ("dashboard_widgets", DashboardWidget),
    ("notifications", Notification),
    ("access_rules", AccessRule),
    ("sso_configs", SsoConfig),
    ("subscriptions", Subscription),
    ("ai_usage_logs", AIUsageLog),
    ("audit_logs", AuditLog),
    # ADR-141
    ("teams", Team),
    ("team_members", TeamMember),
]


def exported_tables() -> list[str]:
    return [name for name, _ in _EXPORT_MODELS] + list(_SPECIAL_TABLES)


def _special_rows(db: Session, tenant_id: UUID) -> dict[str, list[dict[str, Any]]]:
    # The organization's own record.
    tenant = db.execute(select(Tenant).where(Tenant.id == tenant_id)).scalars().all()
    # Its custom roles, plus the shared system roles its users refer to.
    own_or_system = or_(Role.tenant_id == tenant_id, Role.tenant_id.is_(None))
    roles = db.execute(select(Role).where(own_or_system)).scalars().all()
    # These two have no tenant column, so each is limited through its parent.
    members = (
        db.execute(
            select(ProjectMember)
            .join(Project, Project.id == ProjectMember.project_id)
            .where(Project.tenant_id == tenant_id)
        )
        .scalars()
        .all()
    )
    grants = db.execute(
        select(RolePermission.role_id, Permission.code)
        .join(Permission, Permission.id == RolePermission.permission_id)
        .join(Role, Role.id == RolePermission.role_id)
        .where(own_or_system)
        .order_by(RolePermission.role_id, Permission.code)
    ).all()
    return {
        "tenants": [_row_to_dict(row) for row in tenant],
        "roles": [_row_to_dict(row) for row in roles],
        "project_members": [_row_to_dict(row) for row in members],
        "role_permissions": [
            {"role_id": role_id, "permission_code": code} for role_id, code in grants
        ],
    }


def _json_default(value: Any) -> Any:
    if isinstance(value, UUID | datetime | date | time):
        return str(value)
    if isinstance(value, Decimal):
        return float(value)
    raise TypeError(f"Object of type {type(value)} is not JSON serializable")


def _row_to_dict(row: Any) -> dict[str, Any]:
    # Read through the mapped attribute: a column's name can differ from it. audit_logs
    # has a "metadata" column, and `row.metadata` is SQLAlchemy's own.
    return {
        attr.columns[0].name: getattr(row, attr.key)
        for attr in row.__mapper__.column_attrs
        if attr.columns[0].name not in _EXCLUDED_COLUMNS
    }


def _write_table(
    archive: zipfile.ZipFile, manifest: dict[str, int], name: str, rows: list[dict[str, Any]]
) -> None:
    manifest[name] = len(rows)
    archive.writestr(f"{name}.json", json.dumps(rows, default=_json_default, indent=2))


def request_export(db: Session, tenant_id: UUID, actor_user_id: UUID) -> BackgroundJob:
    return job_service.enqueue(db, tenant_id, actor_user_id, TENANT_EXPORT_JOB_TYPE, {})


def run_export(db: Session, tenant_id: UUID) -> dict:
    """Called by the worker (job_service.run_job) with tenant context
    already set. Returns the job `result` payload."""
    manifest: dict[str, int] = {}
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, model in _EXPORT_MODELS:
            # include_deleted: a tenant data export must be complete, including
            # soft-deleted runs/defects (ADR-070); the rows carry deleted_at.
            rows = (
                db.execute(
                    select(model)
                    .where(model.tenant_id == tenant_id)  # type: ignore[attr-defined]
                    .execution_options(include_deleted=True)
                )
                .scalars()
                .all()
            )
            _write_table(archive, manifest, name, [_row_to_dict(row) for row in rows])
        for name, payload in _special_rows(db, tenant_id).items():
            _write_table(archive, manifest, name, payload)
        manifest_payload = {
            "tenant_id": str(tenant_id),
            "generated_at": datetime.utcnow().isoformat(),
            "counts": manifest,
        }
        archive.writestr("manifest.json", json.dumps(manifest_payload, indent=2))

    storage = get_storage_backend()
    key = f"tenants/{tenant_id}/exports/{datetime.utcnow().timestamp()}.zip"
    reference = storage.save(key, buffer.getvalue())
    return {"storage_ref": reference, "manifest": manifest, "size_bytes": buffer.tell()}


def get_export_download(db: Session, tenant_id: UUID, job_id: UUID) -> tuple[bytes, str]:
    job = db.execute(
        select(BackgroundJob).where(
            BackgroundJob.tenant_id == tenant_id, BackgroundJob.id == job_id
        )
    ).scalar_one_or_none()
    if job is None:
        raise NotFoundError("Export job not found")
    if job.job_type != TENANT_EXPORT_JOB_TYPE:
        raise ValidationAppError("That job is not a tenant export")
    if job.status != "succeeded" or job.result is None:
        raise ForbiddenError("Export is not ready yet")

    set_tenant_context(db, str(tenant_id))
    storage = get_storage_backend()
    contents = storage.read(job.result["storage_ref"])
    return contents, f"qtesthub-export-{job_id}.zip"


__all__ = ["request_export", "run_export", "get_export_download", "TENANT_EXPORT_JOB_TYPE"]
