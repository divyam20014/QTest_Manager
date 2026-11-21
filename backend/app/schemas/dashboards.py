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
