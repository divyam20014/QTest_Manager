import json
import re
from collections.abc import Callable
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

ListKey = Literal[
    "test_cases", "test_repository", "defects", "test_runs", "requirements", "projects"
]

MAX_FILTERS_BYTES = 2048
MAX_VIEWS_PER_LIST = 25

_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TOKEN_RE = re.compile(r"^[A-Za-z0-9_.\-' ]{1,64}$")


def _is_uuid(v: str) -> bool:
    return bool(_UUID_RE.match(v))


def _is_date(v: str) -> bool:
    return bool(_DATE_RE.match(v))


def _is_token(v: str) -> bool:
    return bool(_TOKEN_RE.match(v))


def _is_text(v: str) -> bool:
    return len(v) <= 200


_LIST_TOKEN_RE = re.compile(r"^[A-Za-z0-9_.\-' ]{1,64}(,[A-Za-z0-9_.\-' ]{1,64}){0,19}$")


def _is_token_list(v: str) -> bool:
    """One or more comma-separated tokens (a multi-value filter such as status)."""
    return bool(_LIST_TOKEN_RE.match(v))


def _is_bool(v: str) -> bool:
    return v in ("true", "false")


def _is_view_mode(v: str) -> bool:
    """ADR-124: the view mode a saved view opens in (a list page offers only some of them)."""
    return v in ("list", "board", "calendar")


# Per-list allowlist: filter key -> value check. Every value is a short string
# (mirroring the URL query params those list pages already use). Anything not
# listed here is rejected, so a view can never smuggle arbitrary JSON.
FILTER_ALLOWLIST: dict[str, dict[str, Callable[[str], bool]]] = {
    "test_cases": {
        "search": _is_text,
        "priority": _is_token,
        "status": _is_token,
        "assigneeId": _is_uuid,
        "moduleId": _is_uuid,
        "quarantined": _is_token,
        "view": _is_view_mode,
        # ADR-116: filters added with the 22-field standard.
        "testType": _is_text,
        "severity": _is_text,
        "automationStatus": _is_text,
        "environment": _is_text,
        "executionStatus": _is_text,
        "executedBy": _is_uuid,
    },
    # ADR-132: the all-projects Test Cases page. Separate from "test_cases" (one project's
    # tab): the filters differ, and a default view on one page must not apply to the other.
    "test_repository": {
        "search": _is_text,
        "status": _is_token,
        "priority": _is_token,
        "projectId": _is_uuid,
        "showDeprecated": _is_bool,
        "assignee": _is_token,
    },
    "defects": {
        "projectId": _is_uuid,
        "status": _is_token_list,
        "severity": _is_token_list,
        "reportedBy": _is_uuid,
        "createdFrom": _is_date,
        "createdTo": _is_date,
        # ADR-118: filters added with the 22-field defect standard.
        "priority": _is_token_list,
        "assigneeId": _is_uuid,
        "moduleId": _is_uuid,
        "labels": _is_token_list,
        "testCaseId": _is_uuid,
        "fixVersion": _is_text,
        "environment": _is_text,
        "resolution": _is_token,
        "search": _is_text,
        "view": _is_view_mode,
    },
    "test_runs": {
        "projectId": _is_uuid,
        "activeOnly": _is_bool,
        # ADR-124: view mode and the calendar's "overdue only" toggle.
        "view": _is_view_mode,
        "overdue": _is_bool,
    },
    # ADR-124: the Requirements and Projects lists gained saved views (their own URL filters).
    "requirements": {
        "search": _is_text,
        "view": _is_view_mode,
    },
    "projects": {
        "search": _is_text,
        "status": _is_token,
        "view": _is_view_mode,
    },
}

SORT_ALLOWLIST: dict[str, set[str]] = {
    "test_cases": {
        f"{sign}{field}"
        for sign in ("", "-")
        for field in (
            "created_at",
            "title",
            "priority",
            "status",
            "display_id",
            "test_type",
            "severity",
            "automation_status",
            "last_executed_at",
            "execution_status",
        )
    },
    "defects": {
        f"{sign}{field}"
        for sign in ("", "-")
        for field in (
            "display_id",
            "title",
            "severity",
            "priority",
            "status",
            "assignee",
            "date_reported",
            "created_at",
            "fix_version",
        )
    },
    "test_repository": set(),
    "test_runs": set(),
    "requirements": set(),
    "projects": set(),
}


def validate_view(list_key: str, filters: dict[str, Any], sort: str | None) -> None:
    """Raises ValueError with a user-facing message on any violation."""
    allowed = FILTER_ALLOWLIST[list_key]
    for key, value in filters.items():
        check = allowed.get(key)
        if check is None:
            raise ValueError(f"Filter '{key}' is not allowed for {list_key}")
        if not isinstance(value, str) or not check(value):
            raise ValueError(f"Filter '{key}' has an invalid value")
    if len(json.dumps(filters, separators=(",", ":")).encode()) > MAX_FILTERS_BYTES:
        raise ValueError("Filters are too large (2KB maximum)")
    if sort is not None and sort not in SORT_ALLOWLIST[list_key]:
        raise ValueError(f"Sort '{sort}' is not allowed for {list_key}")


MAX_COLUMNS = 40
_COLUMN_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")


def clean_columns(value: Any) -> list[str] | None:
    """A saved column layout is an ordered list of column keys (de-duplicated).
    Keys are checked for shape only: which columns exist is the list page's own
    metadata, and an unknown key is simply ignored when the view is applied."""
    if value is None:
        return None
    if not isinstance(value, list):
        raise ValueError("columns must be a list of column keys")
    if len(value) > MAX_COLUMNS:
        raise ValueError(f"A view can hold at most {MAX_COLUMNS} columns")
    out: list[str] = []
    for item in value:
        if not isinstance(item, str) or not _COLUMN_KEY_RE.match(item):
            raise ValueError("columns has an invalid column key")
        if item not in out:
            out.append(item)
    return out


def _clean_name(v: str) -> str:
    v = v.strip()
    if not 1 <= len(v) <= 60:
        raise ValueError("Name must be 1 to 60 characters")
    return v


class SavedViewCreateRequest(BaseModel):
    list_key: ListKey
    name: str = Field(max_length=200)
    filters: dict[str, Any] = Field(default_factory=dict)
    sort: str | None = Field(default=None, max_length=50)
    is_default: bool = False
    # ADR-117: optional ordered list of visible column keys.
    columns: list[str] | None = None

    @field_validator("columns", mode="before")
    @classmethod
    def _columns(cls, v: Any) -> list[str] | None:
        return clean_columns(v)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return _clean_name(v)

    @model_validator(mode="after")
    def _check(self) -> "SavedViewCreateRequest":
        validate_view(self.list_key, self.filters, self.sort)
        return self


class SavedViewUpdateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    filters: dict[str, Any] | None = None
    sort: str | None = Field(default=None, max_length=50)
    is_default: bool | None = None
    columns: list[str] | None = None

    @field_validator("columns", mode="before")
    @classmethod
    def _columns(cls, v: Any) -> list[str] | None:
        return clean_columns(v)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        return None if v is None else _clean_name(v)


class SavedViewOut(BaseModel):
    id: UUID
    list_key: ListKey
    name: str
    filters: dict[str, Any]
    sort: str | None
    is_default: bool
    created_at: datetime
    updated_at: datetime
    # ADR-117: optional saved column layout (ordered column keys).
    columns: dict[str, Any] | list[Any] | None = None
