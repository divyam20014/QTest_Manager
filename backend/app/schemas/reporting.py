from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

Metric = Literal[
    "run_status",
    "priority",
    "test_case_status",
    "defect_severity",
    "defect_status",
    "defect_root_cause",
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
    # Pass B UI/UX overhaul: lets the dashboard distinguish a genuinely
    # reliable pass-rate from one computed off a handful of steps (e.g.
    # "100%" off a single step), which looked misleadingly confident.
    step_sample_size: int


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


class DefectTrendPoint(BaseModel):
    date: str
    opened_count: int
    closed_count: int


class DefectTrendReport(BaseModel):
    points: list[DefectTrendPoint]


class DefectAgingSeverityBucket(BaseModel):
    severity: str
    open_count: int
    breached_count: int


class DefectAgingSummary(BaseModel):
    buckets: list[DefectAgingSeverityBucket]
    total_open: int
    total_breached: int


class MostReopenedDefect(BaseModel):
    defect_id: UUID
    title: str
    status: str
    reopened_count: int
    last_reopened_at: datetime


class ReopenSummary(BaseModel):
    """PV-6.3 reopen-rate analytics -- additive on top of ADR-026's
    unchanged forward-only status sequence (see defect_service.reopen_defect)."""

    total_defects: int
    reopened_defects: int
    reopen_rate: float
    total_reopen_events: int
    most_reopened: list[MostReopenedDefect]


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
    # Pass D: requirements coverage (reuses requirement_service's existing RTM
    # computation) and defect aging/SLA compliance (reuses Phase 6's existing
    # age_days/sla_breached computation) -- makes the compliance report answer
    # "are requirements adequately tested?" and "are we meeting our own SLA
    # budgets?", not just "what exists."
    requirement_total: int
    requirement_covered: int
    requirement_coverage_percentage: float
    defect_aging: DefectAgingSummary


class CompliancePeriodComparison(BaseModel):
    """A cheap this-period-vs-prior-period comparison (same-length prior
    window immediately before period_from) -- reuses data already being
    queried, not a new trend-computation engine."""

    test_cases_created_current: int
    test_cases_created_prior: int
    defects_opened_current: int
    defects_opened_prior: int
    defects_closed_current: int
    defects_closed_prior: int


class ComplianceReport(BaseModel):
    tenant_name: str
    generated_at: datetime
    reporting_officer_name: str
    reporting_officer_email: str
    period_from: datetime | None
    period_to: datetime | None
    projects: list[ComplianceProjectSection]
    trend: CompliancePeriodComparison | None


class ReleaseReadinessReport(BaseModel):
    """Tier 3 (PV-7.1): the underlying metrics, not one opaque score --
    presenting completion/pass/defect/coverage separately is more useful
    to a QA manager deciding go/no-go than a single blended number."""

    project_id: UUID
    release_id: UUID | None
    release_name: str | None
    total_test_cases: int
    execution_completion_percentage: float
    pass_percentage: float
    open_defects_by_severity: dict[str, int]
    requirement_coverage_percentage: float


class WorkloadEntry(BaseModel):
    user_id: UUID
    user_name: str | None
    assigned_test_cases: int
    assigned_test_run_cases_pending: int
    assigned_test_run_cases_in_progress: int
    defects_reported_open: int


class WorkloadSummary(BaseModel):
    project_id: UUID
    entries: list[WorkloadEntry]


class FlakyTestEntry(BaseModel):
    test_case_id: UUID
    test_case_title: str
    run_count: int
    flip_count: int
    flip_rate: float


class FlakyTestReport(BaseModel):
    project_id: UUID
    tests: list[FlakyTestEntry]


class TraceabilityMatrixEntry(BaseModel):
    """Per-row 'coverage' here means execution coverage -- the percentage of
    THIS requirement's linked test cases that have been executed at least
    once -- a different question from RequirementCoverageReport's binary
    "does this requirement have any linked test case at all." Both are
    reported (see TraceabilityMatrixReport.overall_requirement_coverage_percentage
    for the latter), since they answer different questions a QA manager asks."""

    requirement_id: UUID
    requirement_title: str
    linked_test_case_count: int
    passed_count: int
    failed_count: int
    blocked_count: int
    not_executed_count: int
    coverage_percentage: float


class TraceabilityMatrixReport(BaseModel):
    project_id: UUID
    total_requirements: int
    overall_requirement_coverage_percentage: float
    entries: list[TraceabilityMatrixEntry]
