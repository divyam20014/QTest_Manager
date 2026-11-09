from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

Metric = Literal["run_status", "priority", "defect_severity", "defect_status"]
GroupBy = Literal["project", "domain", "assignee"]


class ProjectStatusBreakdown(BaseModel):
    total: int
    by_status: dict[str, int]


class TestCaseSummary(BaseModel):
    total: int
    approved_ratio: float


class TestRunSummary(BaseModel):
    active: int
    step_pass_percentage: float


class DefectBacklogSummary(BaseModel):
    open_by_severity: dict[str, int]


class DashboardSummary(BaseModel):
    projects: ProjectStatusBreakdown
    test_cases: TestCaseSummary
    test_runs: TestRunSummary
    defects: DefectBacklogSummary


class DomainDistributionEntry(BaseModel):
    domain: str
    project_count: int
    test_case_count: int
    approved_percentage: float
    open_defect_count: int


class ActivityEntry(BaseModel):
    user_name: str | None
    action: str
    entity_type: str
    entity_id: UUID
    created_at: datetime


class AggregateRow(BaseModel):
    group_key: str | None
    group_label: str
    value: str
    count: int


class AggregateReport(BaseModel):
    metric: Metric
    group_by: GroupBy
    rows: list[AggregateRow]
