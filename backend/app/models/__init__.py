from app.models.access_rule import AccessRule
from app.models.ai_usage import AIUsageLog
from app.models.audit import AuditChainCheckpoint, AuditLog
from app.models.background_job import BackgroundJob
from app.models.comment import Comment, CommentMention
from app.models.dashboard import Dashboard, DashboardWidget
from app.models.defect import Defect, DefectLink
from app.models.entity_counter import EntityCounter
from app.models.execution import ExecutionStep, TestRun, TestRunCase
from app.models.field_customization import (
    CustomFieldDefinition,
    CustomFieldValue,
    FieldOption,
    StatusLabel,
)
from app.models.idempotency import IdempotencyKey
from app.models.identity import (
    MfaChallenge,
    Permission,
    PlatformAdmin,
    PlatformAdminRecoveryCode,
    PlatformSession,
    Role,
    RolePermission,
    Session,
    User,
)
from app.models.import_session import ImportSession
from app.models.marketing import MarketingLead
from app.models.notification import Notification
from app.models.platform_audit import PlatformAuditEvent
from app.models.project import Project, ProjectMember
from app.models.report_schedule import ReportSchedule
from app.models.requirement import Requirement, RequirementTestCaseLink, RequirementVersion
from app.models.saved_report import SavedReport
from app.models.saved_view import SavedView
from app.models.scim_token import ScimToken
from app.models.service_token import ServiceToken
from app.models.shared_step import SharedStep
from app.models.sso_config import SsoConfig
from app.models.subscription import Plan, Subscription
from app.models.task import Task, TaskStatus, TaskTestCaseLink
from app.models.tenant import Tenant
from app.models.test_asset import Build, Environment, Release
from app.models.test_case import (
    Attachment,
    TestCase,
    TestCaseVersion,
    TestCaseVersionStep,
)
from app.models.test_data_set import TestDataSet, TestDataSetRow
from app.models.test_module import TestModule
from app.models.test_plan import TestPlan, TestPlanRun
from app.models.test_suite import TestSuite, TestSuiteCase
from app.models.user_invite import UserInvite

__all__ = [
    "Tenant",
    "PlatformAdmin",
    "PlatformAdminRecoveryCode",
    "PlatformAuditEvent",
    "PlatformSession",
    "Role",
    "Permission",
    "RolePermission",
    "User",
    "Session",
    "MfaChallenge",
    "Project",
    "ProjectMember",
    "TestCase",
    "TestCaseVersion",
    "TestCaseVersionStep",
    "Attachment",
    "TestRun",
    "TestRunCase",
    "ExecutionStep",
    "Defect",
    "DefectLink",
    "AuditChainCheckpoint",
    "AuditLog",
    "IdempotencyKey",
    "Requirement",
    "RequirementVersion",
    "RequirementTestCaseLink",
    "AIUsageLog",
    "Comment",
    "CommentMention",
    "MarketingLead",
    "Notification",
    "Plan",
    "Subscription",
    "UserInvite",
    "BackgroundJob",
    "Environment",
    "Build",
    "Release",
    "TestModule",
    "SharedStep",
    "SsoConfig",
    "ScimToken",
    "ServiceToken",
    "AccessRule",
    "FieldOption",
    "StatusLabel",
    "CustomFieldDefinition",
    "CustomFieldValue",
    "ReportSchedule",
    "SavedReport",
    "Dashboard",
    "DashboardWidget",
    "EntityCounter",
    "ImportSession",
    "SavedView",
    "TestDataSet",
    "TestDataSetRow",
    "TestSuite",
    "TestSuiteCase",
    "TestPlan",
    "TestPlanRun",
    "Task",
    "TaskStatus",
    "TaskTestCaseLink",
]

# ADR-070: registers the soft-delete SELECT filter (side-effect import).
from app.models import soft_delete as _soft_delete  # noqa: E402,F401
