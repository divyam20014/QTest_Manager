"""ADR-099: custom dashboards. Widget settings are validated per type by a
strict (extra=forbid) Pydantic model; the catalogue is fixed."""

import json
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

MAX_DASHBOARDS_PER_USER = 10
MAX_WIDGETS_PER_DASHBOARD = 12
MAX_SETTINGS_BYTES = 1024

Size = Literal["S", "M", "L"]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]


class _Settings(BaseModel):
    model_config = ConfigDict(extra="forbid")


class KpiSummarySettings(_Settings):
    project_id: UUID | None = None


class ExecutionTrendSettings(_Settings):
    days: Literal[7, 14, 30, 90] = 30
    project_id: UUID | None = None


class StatusDistributionSettings(_Settings):
    project_id: UUID | None = None


class DefectAgingSettings(_Settings):
    project_id: UUID | None = None


class OpenDefectsBySeveritySettings(_Settings):
    project_id: UUID | None = None


class ReleaseReadinessSettings(_Settings):
    project_id: UUID  # the existing endpoint is per project
    release_id: UUID | None = None


class DefectLeakageSettings(_Settings):
    project_id: UUID | None = None


class FlakyTestsSettings(_Settings):
    project_id: UUID  # the existing endpoint is per project
    top_n: int = Field(default=10, ge=1, le=50)


class RecentActivitySettings(_Settings):
    project_id: UUID | None = None


class SavedReportSettings(_Settings):
    report_id: UUID


class MyAssignedCasesSettings(_Settings):
    project_id: UUID | None = None


SETTINGS_MODELS: dict[str, type[_Settings]] = {
    "kpi_summary": KpiSummarySettings,
    "execution_trend": ExecutionTrendSettings,
    "status_distribution": StatusDistributionSettings,
    "defect_aging": DefectAgingSettings,
    "open_defects_by_severity": OpenDefectsBySeveritySettings,
    "release_readiness": ReleaseReadinessSettings,
    "defect_leakage": DefectLeakageSettings,
    "flaky_tests": FlakyTestsSettings,
    "recent_activity": RecentActivitySettings,
    "saved_report": SavedReportSettings,
    "my_assigned_cases": MyAssignedCasesSettings,
}

WidgetType = Literal[
    "kpi_summary",
    "execution_trend",
    "status_distribution",
    "defect_aging",
    "open_defects_by_severity",
    "release_readiness",
    "defect_leakage",
    "flaky_tests",
    "recent_activity",
    "saved_report",
    "my_assigned_cases",
]


class WidgetIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    widget_type: WidgetType
    size: Size = "M"
    settings: dict[str, Any] = Field(default_factory=dict)


class WidgetsReplaceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    widgets: list[WidgetIn] = Field(max_length=MAX_WIDGETS_PER_DASHBOARD)


class DashboardCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name


class DashboardUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name


class TeamDefaultIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = True


def settings_size_ok(settings: dict[str, Any]) -> bool:
    return len(json.dumps(settings, separators=(",", ":"))) <= MAX_SETTINGS_BYTES


# --- ADR-123: project dashboards ----------------------------------------------------------
# A project dashboard layout is an ordered list of catalogue widgets (visible ones only: a
# hidden widget is simply absent) with a fixed S / M / L size. The widgets read their data from
# the existing report endpoints with the viewer's own session and the page's project, so the
# catalogue carries no per-widget settings.

MAX_WIDGETS_PER_PROJECT_DASHBOARD = 20
PROJECT_DASHBOARD_NAME = "Project dashboard"

# (widget_type, default size) in the built-in order.
PROJECT_WIDGET_CATALOGUE: tuple[tuple[str, str], ...] = (
    ("kpi_strip", "L"),
    ("test_status", "S"),
    ("execution_trend", "M"),
    ("defect_severity", "S"),
    ("module_coverage", "M"),
    ("requirement_traceability", "S"),
    ("task_progress", "M"),
    ("tester_performance", "M"),
    ("tester_workload", "M"),
    ("upcoming_milestones", "S"),
    ("release_readiness", "M"),
    ("my_pending", "S"),
    ("overdue_cases", "M"),
    ("recent_activity", "S"),
    ("recent_defects", "L"),
)
PROJECT_WIDGET_TYPES = tuple(key for key, _ in PROJECT_WIDGET_CATALOGUE)

ProjectWidgetType = Literal[
    "kpi_strip",
    "test_status",
    "execution_trend",
    "defect_severity",
    "module_coverage",
    "requirement_traceability",
    "task_progress",
    "tester_performance",
    "tester_workload",
    "release_readiness",
    "upcoming_milestones",
    "overdue_cases",
    "recent_defects",
    "my_pending",
    "recent_activity",
]


class ProjectWidgetIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    widget_type: ProjectWidgetType
    size: Size = "M"


class ProjectLayoutIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    widgets: list[ProjectWidgetIn] = Field(max_length=MAX_WIDGETS_PER_PROJECT_DASHBOARD)
