"""ADR-115: the fixed value lists and rule tables of the 22-field Test Case and
Defect standard, as pure data (no I/O, no database access).

Nothing here changes behaviour on its own: the lists are consumed by the tenant
bootstrap seed, by validators in later steps and by the reserved-key guard for
custom field definitions. Tenant-configurable sets (Test Type, severity,
priority) are only *defaults* that get seeded into ``field_options``; the
Automation Status, Defect Status and Resolution lists are fixed and validated in
code because transition/resolution logic depends on the exact values.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal

# --- display ids (TC_000001 / BUG_000001) ------------------------------------

DisplayKind = Literal["test_case", "defect"]
DISPLAY_ID_KINDS: Final[tuple[DisplayKind, ...]] = ("test_case", "defect")
DISPLAY_ID_PREFIX: Final[dict[str, str]] = {"test_case": "TC_", "defect": "BUG_"}
DISPLAY_ID_MIN_DIGITS: Final[int] = 6

# --- Test Case -----------------------------------------------------------------

# 'test_type' field_options defaults (tenant-configurable, seeded additively).
# ADR-116: the order below is the display order (sort_order 0..11).
TEST_TYPE_DEFAULTS: Final[tuple[str, ...]] = (
    "Functional",
    "UI",
    "Smoke",
    "Regression",
    "Integration",
    "System",
    "End-to-End",
    "Security",
    "Performance",
    "Compatibility",
    "Usability",
    "API",
)
# Seeded by the ADR-115 step-1 default list but not part of the ADR-116 list.
# They are never deleted (tenants may have used them); field_options has no
# active flag, so they simply sort after the standard types.
LEGACY_TEST_TYPES: Final[tuple[str, ...]] = ("Sanity", "UAT")

# Test case severity ('test_case_severity' field_options key).
TEST_CASE_SEVERITY_DEFAULTS: Final[tuple[str, ...]] = ("Critical", "Major", "Minor")

# Added to the existing defect_severity set (legacy Low/Medium/High/Critical stay
# valid; Critical is already present).
DEFECT_SEVERITY_ADDITIONS: Final[tuple[str, ...]] = ("Major", "Minor")

# Legacy defaults that every tenant already has for the priority sets; the
# requested High/Medium/Low are a subset of them, so nothing is added.
PRIORITY_DEFAULTS: Final[tuple[str, ...]] = ("High", "Medium", "Low")

# Fixed, code-validated.
AUTOMATION_STATUSES: Final[tuple[str, ...]] = ("Manual", "Automated", "Candidate for Automation")
DEFAULT_AUTOMATION_STATUS: Final[str] = "Manual"

# --- Defect --------------------------------------------------------------------

LEGACY_DEFECT_STATUSES: Final[tuple[str, ...]] = ("New", "Open", "Fixed", "Verified", "Closed")
DEFECT_STATUSES: Final[tuple[str, ...]] = (
    "New",
    "Assigned",
    "In Progress",
    "Fixed",
    "Retest",
    "Reopened",
    "Closed",
    "Rejected",
    "Deferred",
    # Legacy codes stay valid for existing rows; they are not offered as targets
    # for the new workflow but have outgoing transitions below.
    "Open",
    "Verified",
)
DEFAULT_DEFECT_STATUS: Final[str] = "New"

# Current status -> statuses it may move to (ADR-118: enforced by defect_service).
# Lifecycle: New -> Assigned -> In Progress -> Fixed -> Retest -> Closed, with
# Retest/Closed/Rejected -> Reopened, New/Assigned/In Progress -> Rejected/Deferred and
# Deferred -> Assigned/New. The legacy sequence New -> Open -> Fixed -> Verified ->
# Closed keeps working: Open behaves like Assigned / In Progress, Verified is "retest
# passed, not yet closed" (a Retest that passed without a close permission lands there).
ALLOWED_TRANSITIONS: Final[dict[str, frozenset[str]]] = {
    "New": frozenset({"Assigned", "In Progress", "Rejected", "Deferred", "Open"}),
    "Open": frozenset({"Assigned", "In Progress", "Fixed", "Rejected", "Deferred"}),
    "Assigned": frozenset({"In Progress", "Rejected", "Deferred"}),
    "In Progress": frozenset({"Fixed", "Deferred", "Assigned", "Rejected"}),
    "Fixed": frozenset({"Retest", "Reopened", "Verified"}),
    "Retest": frozenset({"Closed", "Reopened", "Verified"}),
    "Reopened": frozenset({"Assigned", "In Progress", "Fixed"}),
    "Verified": frozenset({"Closed", "Reopened"}),
    "Deferred": frozenset({"Assigned", "In Progress", "New", "Closed"}),
    "Rejected": frozenset({"Reopened", "Closed"}),
    "Closed": frozenset({"Reopened"}),
}

# Status groups used by reports, dashboards, SLA and the status tabs (ADR-118).
# * closed: finished for good (Rejected counts as closed).
# * open: active work, including a defect that came back (Reopened) or awaits its
#   retest. Fixed and the legacy Verified are "awaiting verification" and, as before,
#   are not part of the open-defect counts that gate a release; Deferred is parked.
CLOSED_DEFECT_STATUSES: Final[tuple[str, ...]] = ("Closed", "Rejected")
OPEN_DEFECT_STATUSES: Final[tuple[str, ...]] = (
    "New",
    "Open",
    "Assigned",
    "In Progress",
    "Reopened",
    "Retest",
)
AWAITING_VERIFICATION_STATUSES: Final[tuple[str, ...]] = ("Fixed", "Retest", "Verified")
PARKED_DEFECT_STATUSES: Final[tuple[str, ...]] = ("Deferred",)
# Statuses a defect may be CREATED with.
CREATE_DEFECT_STATUSES: Final[tuple[str, ...]] = ("New", "Assigned")


def transition_error(current: str, target: str) -> str | None:
    """Why `current` -> `target` is refused (listing the allowed next statuses), or None."""
    if target not in DEFECT_STATUSES:
        return f"Unknown status '{target}'"
    allowed = ALLOWED_TRANSITIONS.get(current, frozenset())
    if target in allowed:
        return None
    order = [s for s in DEFECT_STATUSES if s in allowed]
    nxt = ", ".join(order) if order else "none"
    return f"Cannot move a defect from '{current}' to '{target}'; allowed next statuses: {nxt}"


RESOLUTIONS: Final[tuple[str, ...]] = (
    "Fixed",
    "Duplicate",
    "Won't Fix",
    "Cannot Reproduce",
    "By Design",
    "Not Applicable",
)


@dataclass(frozen=True)
class ResolutionRule:
    """What a defect in a given status may/must carry as its resolution."""

    required: bool
    allowed: frozenset[str]  # empty => the resolution must be empty in this status


_NO_RESOLUTION = ResolutionRule(required=False, allowed=frozenset())

RESOLUTION_RULES: Final[dict[str, ResolutionRule]] = {
    "New": _NO_RESOLUTION,
    "Open": _NO_RESOLUTION,
    "Assigned": _NO_RESOLUTION,
    "In Progress": _NO_RESOLUTION,
    "Retest": _NO_RESOLUTION,
    "Reopened": _NO_RESOLUTION,
    "Fixed": ResolutionRule(required=True, allowed=frozenset({"Fixed"})),
    "Verified": ResolutionRule(required=False, allowed=frozenset({"Fixed"})),
    "Rejected": ResolutionRule(
        required=True,
        allowed=frozenset(
            {"Duplicate", "Won't Fix", "Cannot Reproduce", "By Design", "Not Applicable"}
        ),
    ),
    "Deferred": ResolutionRule(
        required=False, allowed=frozenset({"Won't Fix", "By Design", "Not Applicable"})
    ),
    "Closed": ResolutionRule(required=True, allowed=frozenset(RESOLUTIONS)),
}


def resolution_error(status: str, resolution: str | None) -> str | None:
    """Return why `resolution` is invalid for `status`, or None when it is valid."""
    rule = RESOLUTION_RULES.get(status)
    if rule is None:
        return f"Unknown defect status '{status}'"
    if resolution is None or resolution == "":
        return f"A resolution is required when status is '{status}'" if rule.required else None
    if resolution not in RESOLUTIONS:
        return f"'{resolution}' is not a valid resolution"
    if resolution not in rule.allowed:
        return f"Resolution '{resolution}' is not valid for status '{status}'"
    return None


# --- reserved custom-field keys -------------------------------------------------

# Keys of the fixed standard fields. A tenant custom field with one of these keys
# would show up twice in an "All Fields" view, so new definitions are refused.
_COMMON_RESERVED: Final[frozenset[str]] = frozenset(
    {
        "id",
        "display_id",
        "title",
        "description",
        "priority",
        "severity",
        "status",
        "environment",
        "module",
        "module_id",
        "labels",
        "tags",
        "attachments",
        "comments",
        "created_by",
        "created_at",
        "project",
        "project_id",
    }
)

RESERVED_CUSTOM_FIELD_KEYS: Final[dict[str, frozenset[str]]] = {
    "test_case": _COMMON_RESERVED
    | frozenset(
        {
            "requirement_id",
            "requirement_ref",
            "test_type",
            "automation_status",
            "preconditions",
            "prerequisite",
            "test_data",
            "steps",
            "expected_result",
            "postconditions",
            "actual_result",
            "defect_link",
            "defect_id",
            "executed_by",
            "execution_date",
            "executed_at",
        }
    ),
    "defect": _COMMON_RESERVED
    | frozenset(
        {
            "component",
            "preconditions",
            "steps_to_reproduce",
            "repro_steps",
            "expected_result",
            "actual_result",
            "build_found",
            "resolution",
            "root_cause",
            "root_cause_notes",
            "reporter",
            "reported_by",
            "assignee",
            "assigned_to",
            "date_reported",
            "fix_version",
            "linked_issues",
            "test_case_id",
            "test_run_case_id",
        }
    ),
    # Requirements are not part of the 22-field standard.
    "requirement": frozenset(),
}


def is_reserved_custom_field_key(entity_type: str, field_key: str) -> bool:
    return field_key in RESERVED_CUSTOM_FIELD_KEYS.get(entity_type, frozenset())


# --- Test Case field catalogue (ADR-116) -----------------------------------------

TEST_CASE_ID_MAX = 255
TITLE_MIN, TITLE_MAX = 5, 255
DESCRIPTION_MAX = 20_000
CONTENT_TEXT_MAX = 10_000  # preconditions, postconditions, expected result
TEST_DATA_MAX = 20_000
STEP_TEXT_MAX = 2_000
STEP_DATA_MAX = 5_000
MAX_STEPS = 200
SHORT_TEXT_MAX = 200  # environment, requirement_ref

# Execution status shown on a test case: derived from the latest executed
# test_run_case, never stored on the test case.
EXECUTION_STATUS_BY_RUN_CASE_STATUS: Final[dict[str, str]] = {
    "passed": "Pass",
    "failed": "Fail",
    "blocked": "Blocked",
    "ignored": "Skipped",
}
EXECUTION_STATUSES: Final[tuple[str, ...]] = ("Pass", "Fail", "Blocked", "Skipped", "Not Run")
NOT_RUN: Final[str] = "Not Run"


@dataclass(frozen=True)
class FieldSpec:
    key: str
    label: str
    type: str  # text | markdown | enum | json_text | steps | datetime | user | ref | list
    group: str  # identity | definition | classification | content | execution | links
    sortable: bool = False
    filterable: bool = False
    editable: bool = True
    mandatory_on_create: bool = False
    default_visible: bool = False


# The 22-field Test Case standard, in display order. `default_visible` marks the
# nine columns of the default list view (ADR-116).
TEST_CASE_FIELDS: Final[tuple[FieldSpec, ...]] = (
    FieldSpec("display_id", "Test Case ID", "text", "identity", True, False, False, False, True),
    FieldSpec("requirement_ref", "Requirement / User Story ID", "ref", "links", False, False),
    FieldSpec("module", "Module", "ref", "classification", False, True, True, True, True),
    FieldSpec("title", "Title", "text", "identity", True, False, True, True, True),
    FieldSpec("description", "Description", "markdown", "definition"),
    FieldSpec("test_type", "Test Type", "enum", "classification", True, True, True, False, True),
    FieldSpec("priority", "Priority", "enum", "classification", True, True, True, True, True),
    FieldSpec("severity", "Severity", "enum", "classification", True, True),
    FieldSpec(
        "automation_status",
        "Automation Status",
        "enum",
        "classification",
        True,
        True,
        True,
        False,
        True,
    ),
    FieldSpec("environment", "Environment", "text", "classification", False, True),
    FieldSpec("preconditions", "Preconditions", "markdown", "content", False, False, True, True),
    FieldSpec("test_data", "Test Data", "json_text", "content", False, False, True, True),
    FieldSpec("steps", "Test Steps", "steps", "content", False, False, True, True),
    FieldSpec(
        "expected_result", "Expected Result", "markdown", "content", False, False, True, True
    ),
    FieldSpec("postconditions", "Postconditions", "markdown", "content"),
    FieldSpec("actual_result", "Actual Result", "markdown", "execution", False, False, False),
    FieldSpec(
        "execution_status", "Execution Status", "enum", "execution", True, True, False, False, True
    ),
    FieldSpec("linked_defects", "Defect / Bug ID", "list", "links", False, False, False),
    FieldSpec("created_by", "Created By", "user", "identity", False, False, False),
    FieldSpec("executed_by", "Executed By", "user", "execution", False, True, False, False, True),
    FieldSpec(
        "last_executed_at",
        "Last Execution Date",
        "datetime",
        "execution",
        True,
        False,
        False,
        False,
        True,
    ),
    FieldSpec("attachments", "Comments / Attachments", "list", "links", False, False, False),
)
# Column order of the default list view.
DEFAULT_VISIBLE_TEST_CASE_FIELDS: Final[tuple[str, ...]] = (
    "display_id",
    "title",
    "module",
    "test_type",
    "priority",
    "automation_status",
    "execution_status",
    "executed_by",
    "last_executed_at",
)


# --- Defect field catalogue (ADR-118) -------------------------------------------------

BUILD_FOUND_MAX = 200
FIX_VERSION_MAX = 200
MAX_LABELS = 20
LABEL_MAX = 40
ROOT_CAUSE_NOTES_MAX = 10_000
# Severity values of the brief (the tenant's defect_severity options also keep the
# legacy Low / Medium / High / Critical) and their SLA budget in days.
SLA_DAYS_BY_SEVERITY: Final[dict[str, int]] = {
    "Critical": 2,
    "Major": 5,
    "High": 5,
    "Minor": 15,
    "Medium": 10,
    "Low": 20,
}

# The 22-field Defect standard, in display order.
DEFECT_FIELDS: Final[tuple[FieldSpec, ...]] = (
    FieldSpec("display_id", "Bug ID", "text", "identity", True, False, False, False, True),
    FieldSpec("title", "Title", "text", "identity", True, False, True, True, True),
    FieldSpec("description", "Description", "markdown", "definition", False, False, True, True),
    FieldSpec(
        "module", "Component / Module", "ref", "classification", True, True, True, False, True
    ),
    FieldSpec("preconditions", "Preconditions", "markdown", "content", False, False, True),
    FieldSpec("repro_steps", "Steps to Reproduce", "steps", "content", False, False, True, True),
    FieldSpec(
        "expected_result", "Expected Result", "markdown", "content", False, False, True, True
    ),
    FieldSpec("actual_result", "Actual Result", "markdown", "content", False, False, True, True),
    FieldSpec("attachments", "Attachments / Evidence", "list", "links", False, False, False),
    FieldSpec("environment", "Environment", "text", "classification", False, True, True, True),
    FieldSpec("build_found", "Build / Version Found", "text", "classification", False, False),
    FieldSpec("severity", "Severity", "enum", "classification", True, True, True, True, True),
    FieldSpec("priority", "Priority", "enum", "classification", True, True, True, True, True),
    FieldSpec("status", "Status", "enum", "workflow", True, True, True, True, True),
    FieldSpec("resolution", "Resolution", "enum", "workflow", False, True),
    FieldSpec("root_cause", "Root Cause", "enum", "workflow", False, False),
    FieldSpec("reporter", "Reporter", "user", "people", True, True, False, True, True),
    FieldSpec("assignee", "Assignee", "user", "people", True, True, True, False, True),
    FieldSpec(
        "date_reported", "Date Reported", "datetime", "identity", True, True, False, True, True
    ),
    FieldSpec(
        "fix_version",
        "Fix Version / Target Milestone",
        "text",
        "workflow",
        True,
        True,
        True,
        False,
        True,
    ),
    FieldSpec("linked_issues", "Linked Issues / Test Case ID", "list", "links", False, True),
    FieldSpec("labels", "Labels / Tags", "list", "classification", False, True),
)
DEFAULT_VISIBLE_DEFECT_FIELDS: Final[tuple[str, ...]] = (
    "display_id",
    "title",
    "module",
    "severity",
    "priority",
    "status",
    "reporter",
    "assignee",
    "date_reported",
    "fix_version",
)
