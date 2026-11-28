"""ADR-120: the column definitions of the standard import / export files.

One table per module (Test Case, Defect). The header of a column is the label of the
field in the 22-field catalogue (`GET /test-cases/columns`, `GET /defects/columns`), so
the template, the export and the catalogue can never drift apart. Pure data, no I/O.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Final

from app.core.field_standards import DEFECT_FIELDS, TEST_CASE_FIELDS, FieldSpec


@dataclass(frozen=True)
class ImportColumn:
    key: str
    header: str
    mandatory: bool = False
    # Exported for information, ignored when the file is imported (derived values).
    readonly: bool = False
    # Extra header spellings accepted on import (legacy files, other tools).
    aliases: tuple[str, ...] = ()
    # Name of the list of allowed values shown in the template (None = free text).
    enum: str | None = None
    note: str = ""
    example: str = ""
    # Not one of the 22 fields (kept for the legacy file layout).
    extra: bool = False


def normalise_header(value: str) -> str:
    """'Requirement / User Story ID' == 'requirement_user-story id' (case, spaces, '_',
    '-', '/' and any punctuation are ignored)."""
    return re.sub(r"[^a-z0-9]", "", value.lower())


READONLY_NOTE: Final[str] = "Derived by the application; ignored on import."

# --- Test Case -------------------------------------------------------------------------

TC_MANDATORY: Final[frozenset[str]] = frozenset(
    {"module", "title", "priority", "preconditions", "test_data", "steps", "expected_result"}
)
TC_READONLY: Final[frozenset[str]] = frozenset(
    {
        "actual_result",
        "execution_status",
        "linked_defects",
        "created_by",
        "executed_by",
        "last_executed_at",
        "attachments",
    }
)
_TC_ALIASES: Final[dict[str, tuple[str, ...]]] = {
    "display_id": ("ID", "TC ID", "Test Case Id"),
    "requirement_ref": ("Requirement ID", "User Story ID", "Requirement"),
    "module": ("Module / Sub-module / Feature", "Module Path"),
    "title": ("Test Case Title", "Name"),
    "preconditions": ("Prerequisite", "Prerequisites", "Precondition"),
    "steps": ("Steps",),
    "linked_defects": ("Defect ID", "Bug ID", "Defects"),
    "last_executed_at": ("Execution Date", "Last Executed"),
    "attachments": ("Attachments",),
}
_TC_ENUM: Final[dict[str, str]] = {
    "test_type": "Test Type",
    "priority": "Priority",
    "severity": "Severity",
    "automation_status": "Automation Status",
}
_TC_NOTE: Final[dict[str, str]] = {
    "display_id": "Optional. Kept when it looks like TC_000123 and is not used by another "
    "test case in the file; otherwise the next id is assigned.",
    "requirement_ref": "Optional free text (a requirement or user story id).",
    "module": "Path 'Module/Submodule/Feature'. Missing modules are created.",
    "title": "5 to 255 characters.",
    "description": "Optional. Markdown.",
    "preconditions": "Markdown.",
    "test_data": "Free text or JSON.",
    "steps": "One step per line: 'N. action | test data | expected result'.",
    "expected_result": "The overall expected result.",
    "postconditions": "Optional. Markdown.",
    "environment": "Optional free text.",
}
_TC_EXAMPLE: Final[dict[str, str]] = {
    "display_id": "",
    "requirement_ref": "US-101",
    "module": "Claims/Total Loss",
    "title": "Example: verify total loss settlement",
    "description": "Confirms the settlement is computed correctly.",
    "test_type": "Functional",
    "priority": "High",
    "severity": "Major",
    "automation_status": "Manual",
    "environment": "QA",
    "preconditions": "The policy is active.",
    "test_data": "Policy: AUTO-100234",
    "steps": "1. Open the claim | Policy: AUTO-100234 | The claim opens\n"
    "2. Choose Total Loss | | The settlement is shown",
    "expected_result": "Settlement equals ACV minus the deductible.",
    "postconditions": "",
}
TC_EXAMPLE_TITLE: Final[str] = _TC_EXAMPLE["title"]


def _from_spec(
    spec: FieldSpec,
    mandatory: frozenset[str],
    readonly: frozenset[str],
    aliases: dict[str, tuple[str, ...]],
    enum: dict[str, str],
    notes: dict[str, str],
    examples: dict[str, str],
) -> ImportColumn:
    is_readonly = spec.key in readonly
    return ImportColumn(
        key=spec.key,
        header=spec.label,
        mandatory=spec.key in mandatory,
        readonly=is_readonly,
        aliases=aliases.get(spec.key, ()),
        enum=enum.get(spec.key),
        note=READONLY_NOTE if is_readonly else notes.get(spec.key, ""),
        example=examples.get(spec.key, ""),
    )


TEST_CASE_COLUMNS: Final[tuple[ImportColumn, ...]] = tuple(
    _from_spec(f, TC_MANDATORY, TC_READONLY, _TC_ALIASES, _TC_ENUM, _TC_NOTE, _TC_EXAMPLE)
    for f in TEST_CASE_FIELDS
) + (
    ImportColumn(
        "assignee",
        "Assignee Email",
        aliases=("Assignee",),
        extra=True,
        note="Optional. The email of an active user.",
    ),
    ImportColumn(
        "status",
        "Review Status",
        aliases=("Status",),
        enum="Review Status",
        extra=True,
        note="Optional. Draft (default), Ready for Review, Approved or Deprecated.",
        example="Draft",
    ),
    ImportColumn("scenario_id", "Scenario Id", extra=True, note="Optional free text."),
    ImportColumn(
        "scenario_description", "Scenario Description", extra=True, note="Optional free text."
    ),
    ImportColumn(
        "project",
        "Project Name",
        readonly=True,
        extra=True,
        note="The project is chosen in the import dialog; ignored on import.",
    ),
    ImportColumn(
        "task",
        "Task",
        extra=True,
        aliases=("Task ID", "Task IDs", "Tasks"),
        note="Optional. Task ids of this project (e.g. TASK_000001) to link, separated by ';'. "
        "Needs the task.manage permission.",
    ),
)
# Accepted on import only (legacy files): appended to the Module path.
TC_IMPORT_ONLY: Final[tuple[ImportColumn, ...]] = (
    ImportColumn("sub_module", "Sub Module", extra=True),
)

# --- Defect ----------------------------------------------------------------------------

DEFECT_MANDATORY: Final[frozenset[str]] = frozenset(
    {
        "title",
        "description",
        "repro_steps",
        "expected_result",
        "actual_result",
        "environment",
        "severity",
        "priority",
    }
)
DEFECT_READONLY: Final[frozenset[str]] = frozenset({"attachments", "reporter", "date_reported"})
_DEFECT_ALIASES: Final[dict[str, tuple[str, ...]]] = {
    "display_id": ("Defect ID", "ID"),
    "module": ("Component", "Module"),
    "repro_steps": ("Steps", "Repro Steps"),
    "build_found": ("Build", "Build Found", "Version Found"),
    "fix_version": ("Fix Version", "Target Milestone"),
    "linked_issues": ("Linked Test Case IDs", "Linked Test Cases", "Test Case ID"),
    "labels": ("Labels", "Tags"),
    "assignee": ("Assignee Email",),
    "reporter": ("Reported By",),
}
_DEFECT_ENUM: Final[dict[str, str]] = {
    "severity": "Severity",
    "priority": "Priority",
    "status": "Status",
    "resolution": "Resolution",
    "root_cause": "Root Cause",
}
_DEFECT_NOTE: Final[dict[str, str]] = {
    "display_id": "Optional. Kept when it looks like BUG_000123 and is not used by another "
    "defect in the file; otherwise the next id is assigned.",
    "title": "5 to 255 characters.",
    "description": "Markdown.",
    "module": "Optional path 'Module/Submodule/Feature'. Missing modules are created.",
    "repro_steps": "One step per line: 'N. action | test data | expected result'.",
    "environment": "Free text, e.g. Staging.",
    "status": "Optional, New by default. Any status; Resolution must fit it.",
    "resolution": "Needed for Fixed, Rejected and Closed (see the Allowed values sheet).",
    "assignee": "Optional. The email of an active project member.",
    "linked_issues": "Optional. Test case ids of this project, separated by ';'.",
    "labels": "Optional. Separated by ';'.",
    "reporter": "The importing user; ignored on import.",
    "date_reported": "Set to the import time; ignored on import.",
}
_DEFECT_EXAMPLE: Final[dict[str, str]] = {
    "title": "Example: settlement amount is wrong",
    "description": "The settlement does not match the policy terms.",
    "module": "Claims/Total Loss",
    "repro_steps": "1. Open claim AUTO-100234 | | The claim opens\n"
    "2. Mark the vehicle as total loss | | The settlement is shown",
    "expected_result": "Settlement equals ACV minus the deductible.",
    "actual_result": "Settlement equals ACV.",
    "environment": "Staging",
    "build_found": "2.4.1",
    "severity": "Major",
    "priority": "High",
    "status": "New",
    "labels": "claims; calculation",
}
DEFECT_EXAMPLE_TITLE: Final[str] = _DEFECT_EXAMPLE["title"]

DEFECT_COLUMNS: Final[tuple[ImportColumn, ...]] = tuple(
    _from_spec(
        f,
        DEFECT_MANDATORY,
        DEFECT_READONLY,
        _DEFECT_ALIASES,
        _DEFECT_ENUM,
        _DEFECT_NOTE,
        _DEFECT_EXAMPLE,
    )
    for f in DEFECT_FIELDS
) + (
    ImportColumn("root_cause_notes", "Root Cause Notes", extra=True, note="Optional. Markdown."),
    ImportColumn(
        "task",
        "Task",
        extra=True,
        aliases=("Task ID",),
        note="Optional. The id of one task of this project, e.g. TASK_000001.",
    ),
)

# --- Requirement (ADR-151) --------------------------------------------------------------

REQUIREMENT_EXAMPLE_TITLE: Final[str] = "Example: a settlement is explained to the customer"

REQUIREMENT_COLUMNS: Final[tuple[ImportColumn, ...]] = (
    ImportColumn(
        "display_id",
        "Requirement ID",
        aliases=("ID",),
        note="Optional. Kept when it looks like REQ_000123 and is not already used; otherwise "
        "the next id is assigned. Importing never changes an existing requirement.",
    ),
    ImportColumn(
        "title",
        "Title",
        mandatory=True,
        note="At least 5 characters.",
        example=REQUIREMENT_EXAMPLE_TITLE,
    ),
    ImportColumn(
        "description",
        "Description",
        note="Optional. Markdown.",
        example="The customer can see how the amount was worked out.",
    ),
    ImportColumn(
        "requirement_type",
        "Type",
        aliases=("Requirement Type",),
        enum="Type",
        note="Optional.",
        example="Functional",
    ),
    ImportColumn("priority", "Priority", enum="Priority", note="Optional.", example="Medium"),
    ImportColumn(
        "status", "Status", enum="Status", note="Optional. Draft by default.", example="Draft"
    ),
    ImportColumn(
        "owner",
        "Owner Email",
        aliases=("Owner",),
        note="Optional. The email of an active project member.",
    ),
    ImportColumn(
        "criteria",
        "Acceptance Criteria",
        aliases=("Criteria",),
        note="Optional. One per line in the cell (Alt+Enter in Excel).",
        example="Shows each deduction\nCan be downloaded",
    ),
    ImportColumn(
        "task",
        "Task",
        aliases=("Task ID",),
        note="Optional. The id of one task of this project, e.g. TASK_000001. Without it the "
        "requirement goes to 'Unassigned requirements'.",
    ),
)

COLUMNS_BY_KIND: Final[dict[str, tuple[ImportColumn, ...]]] = {
    "test_case": TEST_CASE_COLUMNS,
    "defect": DEFECT_COLUMNS,
    "requirement": REQUIREMENT_COLUMNS,
}


def build_header_index(kind: str) -> dict[str, str]:
    """normalised header -> column key, for every label, key and alias of the module."""
    index: dict[str, str] = {}
    columns = list(COLUMNS_BY_KIND[kind])
    if kind == "test_case":
        columns += list(TC_IMPORT_ONLY)
    for col in columns:
        for name in (col.header, col.key, *col.aliases):
            index.setdefault(normalise_header(name), col.key)
    return index
