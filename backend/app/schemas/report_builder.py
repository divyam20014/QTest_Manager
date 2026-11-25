"""ADR-098: report-builder definitions and the per-source field allowlist.

A definition is structured JSON only. Every field name, operator and value is
checked here against a fixed allowlist; nothing from a definition is ever
interpolated into SQL (the service maps allowlisted names to SQLAlchemy
expressions).
"""

import json
import math
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from datetime import date as date_cls
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.field_standards import DEFECT_STATUSES

Source = Literal["test_cases", "test_runs", "defects", "tasks"]
FieldType = Literal["text", "enum", "id", "number", "date", "bool"]
Operator = Literal["eq", "neq", "in", "contains", "gt", "gte", "lt", "lte", "is_null"]

MAX_FIELDS = 12
MAX_FILTERS = 8
MAX_GROUP_BY = 2
MAX_DEFINITION_BYTES = 8192
MAX_VALUE_CHARS = 200
MAX_IN_VALUES = 20
MAX_PAGE_SIZE = 100
MAX_EXPORT_ROWS = 5000
MAX_REPORTS_PER_USER = 50
STATEMENT_TIMEOUT_MS = 10_000

OPS_BY_TYPE: dict[str, tuple[str, ...]] = {
    "text": ("eq", "neq", "in", "contains", "is_null"),
    "enum": ("eq", "neq", "in", "is_null"),
    "id": ("eq", "in"),
    "number": ("eq", "neq", "in", "gt", "gte", "lt", "lte", "is_null"),
    "date": ("gt", "gte", "lt", "lte", "is_null"),
    "bool": ("eq",),
}


@dataclass(frozen=True)
class FieldSpec:
    label: str
    type: FieldType
    sortable: bool = True
    groupable: bool = False
    options: tuple[str, ...] = ()

    @property
    def operators(self) -> tuple[str, ...]:
        return OPS_BY_TYPE[self.type]


_PRIORITY = ("Low", "Medium", "High", "Critical")
_DEFECT_SEVERITY = (*_PRIORITY, "Major", "Minor")

SOURCES: dict[str, dict[str, FieldSpec]] = {
    "test_cases": {
        "id": FieldSpec("ID", "id", sortable=False),
        "title": FieldSpec("Title", "text"),
        "priority": FieldSpec("Priority", "enum", groupable=True, options=_PRIORITY),
        "status": FieldSpec(
            "Status",
            "enum",
            groupable=True,
            options=("draft", "ready_for_review", "approved", "deprecated"),
        ),
        "module": FieldSpec("Module", "text", groupable=True),
        "assignee": FieldSpec("Assignee", "text", groupable=True),
        "quarantined": FieldSpec("Quarantined", "bool", groupable=True),
        "created_at": FieldSpec("Created", "date"),
        "project": FieldSpec("Project", "text", groupable=True),
    },
    "test_runs": {
        "id": FieldSpec("ID", "id", sortable=False),
        "name": FieldSpec("Name", "text"),
        "run_type": FieldSpec(
            "Type", "enum", groupable=True, options=("Regression", "Sanity", "Smoke")
        ),
        "status": FieldSpec("Status", "enum", groupable=True, options=("open", "finished")),
        "executor": FieldSpec("Executed by", "text", groupable=True),
        "created_at": FieldSpec("Created", "date"),
        "finished_at": FieldSpec("Finished", "date"),
        "project": FieldSpec("Project", "text", groupable=True),
        "total_cases": FieldSpec("Cases", "number"),
        "passed_cases": FieldSpec("Passed", "number"),
        "failed_cases": FieldSpec("Failed", "number"),
    },
    "defects": {
        "id": FieldSpec("ID", "id", sortable=False),
        "title": FieldSpec("Title", "text"),
        "severity": FieldSpec("Severity", "enum", groupable=True, options=_DEFECT_SEVERITY),
        "status": FieldSpec(
            "Status",
            "enum",
            groupable=True,
            options=DEFECT_STATUSES,
        ),
        "priority": FieldSpec("Priority", "text", groupable=True),
        "environment": FieldSpec("Environment", "text", groupable=True),
        "reporter": FieldSpec("Reporter", "text", groupable=True),
        "assignee": FieldSpec("Assignee", "text", groupable=True),
        "created_at": FieldSpec("Created", "date"),
        "project": FieldSpec("Project", "text", groupable=True),
        "release": FieldSpec("Fixed in release", "text", groupable=True),
        # ADR-127: the task the defect belongs to (its TASK_ id).
        "task": FieldSpec("Task", "text", groupable=True),
    },
    # ADR-127: tasks and sub-tasks. Status and priority are tenant-configurable, so they are text;
    # `category` is the fixed meaning of the status.
    "tasks": {
        "id": FieldSpec("ID", "id", sortable=False),
        "display_id": FieldSpec("Task ID", "text"),
        "title": FieldSpec("Title", "text"),
        "status": FieldSpec("Status", "text", groupable=True),
        "category": FieldSpec(
            "Status category", "enum", groupable=True, options=("todo", "in_progress", "done")
        ),
        "priority": FieldSpec("Priority", "text", groupable=True),
        "level": FieldSpec("Level (1 = top)", "number", groupable=True),
        "parent": FieldSpec("Parent task", "text", groupable=True),
        "assignee": FieldSpec("Assignee", "text", groupable=True),
        "release": FieldSpec("Release", "text", groupable=True),
        "start_date": FieldSpec("Start", "date"),
        "due_date": FieldSpec("Due", "date"),
        "completed_at": FieldSpec("Completed", "date"),
        "overdue": FieldSpec("Overdue", "bool", groupable=True),
        "created_at": FieldSpec("Created", "date"),
        "project": FieldSpec("Project", "text", groupable=True),
        "sub_tasks": FieldSpec("Sub-tasks", "number"),
        "requirements": FieldSpec("Requirements", "number"),
        "test_cases": FieldSpec("Linked test cases", "number"),
        "defects": FieldSpec("Defects", "number"),
    },
}

_FIELD_RE = r"^[a-z][a-z_]{0,39}$"
Scalar = str | int | float | bool


class FilterIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: str = Field(pattern=_FIELD_RE)
    op: Operator
    value: Scalar | list[Scalar] | None = None


class SortIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: str = Field(pattern=_FIELD_RE)
    dir: Literal["asc", "desc"] = "asc"


class DefinitionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: Source
    fields: list[str] = Field(default_factory=list, max_length=MAX_FIELDS)
    filters: list[FilterIn] = Field(default_factory=list, max_length=MAX_FILTERS)
    group_by: list[str] = Field(default_factory=list, max_length=MAX_GROUP_BY)
    sort: SortIn | None = None

    @model_validator(mode="after")
    def _check(self) -> "DefinitionIn":
        specs = SOURCES[self.source]
        for name in [*self.fields, *self.group_by]:
            if not re.match(_FIELD_RE, name) or name not in specs:
                raise ValueError(f"Unknown field '{name[:40]}' for source {self.source}")
        if len(set(self.fields)) != len(self.fields):
            raise ValueError("Duplicate field")
        if len(set(self.group_by)) != len(self.group_by):
            raise ValueError("Duplicate group-by field")
        for name in self.group_by:
            if not specs[name].groupable:
                raise ValueError(f"Field '{name}' cannot be grouped")
        if self.group_by:
            if any(f not in self.group_by for f in self.fields):
                raise ValueError("A grouped report can only show its group-by fields")
        elif not self.fields:
            raise ValueError("Select at least one field")
        for flt in self.filters:
            spec = specs.get(flt.field)
            if spec is None:
                raise ValueError(f"Unknown filter field '{flt.field[:40]}'")
            if flt.op not in spec.operators:
                raise ValueError(f"Operator '{flt.op}' is not allowed on '{flt.field}'")
            flt.value = _coerce(spec, flt.op, flt.value)
        if self.sort is not None:
            if self.group_by:
                if self.sort.field not in (*self.group_by, "count"):
                    raise ValueError("Sort a grouped report by a group field or count")
            else:
                spec = specs.get(self.sort.field)
                if spec is None or not spec.sortable:
                    raise ValueError(f"Cannot sort by '{self.sort.field[:40]}'")
        if len(json.dumps(self.model_dump(mode="json"), default=str)) > MAX_DEFINITION_BYTES:
            raise ValueError("Definition is too large")
        return self


def _text_value(v: Any) -> str:
    if not isinstance(v, str) or not v or len(v) > MAX_VALUE_CHARS or "\x00" in v:
        raise ValueError("Filter value must be a non-empty string up to 200 characters")
    return v


def _date_value(v: Any) -> str:
    if not isinstance(v, str) or len(v) > 40:
        raise ValueError("Filter value must be an ISO date")
    try:
        if "T" in v:
            parsed = datetime.fromisoformat(v)
        else:
            parsed = datetime.combine(date_cls.fromisoformat(v), datetime.min.time())
    except ValueError:
        raise ValueError("Filter value must be an ISO date") from None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.isoformat()


def _one(spec: FieldSpec, v: Any) -> Any:
    t = spec.type
    if t in ("text", "enum"):
        return _text_value(v)
    if t == "id":
        if not isinstance(v, str) or len(v) > 40:
            raise ValueError("Filter value must be a UUID")
        return str(UUID(v))
    if t == "number":
        if isinstance(v, bool) or not isinstance(v, int | float) or not math.isfinite(v):
            raise ValueError("Filter value must be a number")
        if abs(v) > 1e12:
            raise ValueError("Number out of range")
        return v
    if t == "date":
        return _date_value(v)
    if not isinstance(v, bool):
        raise ValueError("Filter value must be true or false")
    return v


def _coerce(spec: FieldSpec, op: str, value: Any) -> Any:
    if op == "is_null":
        if value is not None:
            raise ValueError("is_null takes no value")
        return None
    if op == "in":
        if not isinstance(value, list) or not 1 <= len(value) <= MAX_IN_VALUES:
            raise ValueError(f"The in operator needs 1 to {MAX_IN_VALUES} values")
        return [_one(spec, v) for v in value]
    if value is None or isinstance(value, list):
        raise ValueError("A single filter value is required")
    return _one(spec, value)


class PreviewIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    definition: DefinitionIn
    page: int = Field(default=1, ge=1, le=100_000)
    page_size: int = Field(default=25, ge=1, le=MAX_PAGE_SIZE)


class SavedReportCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)
    definition: DefinitionIn
    is_shared: bool = False


class SavedReportUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=80)
    definition: DefinitionIn | None = None
    is_shared: bool | None = None
