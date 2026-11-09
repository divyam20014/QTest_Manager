from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

Metric = Literal[
    "run_status", "priority", "test_case_status", "defect_severity", "defect_status"
]
GroupBy = Literal["project", "domain", "assignee"]


class ProjectStatusBreakdown(BaseModel):
    total: int
    active: int
    by_status: dict[str, int]


class TestCaseSummary(BaseModel):
    total: int
    approved_count: int
    approved_ratio: float


class TestRunSummary(BaseModel):
    active: int
    step_pass_percentage: float


class DefectBacklogSummary(BaseModel):
    open_by_severity: dict[str, int]
    critical_count: int


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
    pass_percentage: float


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


class ExecutionTrendPoint(BaseModel):
    date: str
    pass_count: int
    fail_count: int
    ignore_count: int


class ExecutionTrendReport(BaseModel):
    points: list[ExecutionTrendPoint]


class ComplianceTestCaseRow(BaseModel):
    id: UUID
    title: str
    status: str
    priority: str


class ComplianceDefectRow(BaseModel):
    id: UUID
    title: str
    severity: str
    status: str


class ComplianceProjectSection(BaseModel):
    project_id: UUID
    name: str
    domain: str
    total_test_cases: int
    approved_test_cases: int
    draft_test_cases: int
    ready_for_review_test_cases: int
    open_defects: int
    critical_defects: int
    test_cases: list[ComplianceTestCaseRow]
    defects: list[ComplianceDefectRow]


class ComplianceReport(BaseModel):
    tenant_name: str
    generated_at: datetime
    reporting_officer_name: str
    reporting_officer_email: str
    period_from: datetime | None
    period_to: datetime | None
    projects: list[ComplianceProjectSection]
