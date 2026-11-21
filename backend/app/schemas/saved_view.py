import json
import re
from collections.abc import Callable
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

ListKey = Literal["test_cases", "defects", "test_runs"]

MAX_FILTERS_BYTES = 2048
MAX_VIEWS_PER_LIST = 25

_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TOKEN_RE = re.compile(r"^[A-Za-z0-9_.\- ]{1,64}$")


def _is_uuid(v: str) -> bool:
    return bool(_UUID_RE.match(v))


def _is_date(v: str) -> bool:
    return bool(_DATE_RE.match(v))


def _is_token(v: str) -> bool:
    return bool(_TOKEN_RE.match(v))


def _is_text(v: str) -> bool:
    return len(v) <= 200


def _is_bool(v: str) -> bool:
    return v in ("true", "false")


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
    },
    "defects": {
        "projectId": _is_uuid,
        "status": _is_token,
        "severity": _is_token,
        "reportedBy": _is_uuid,
        "createdFrom": _is_date,
        "createdTo": _is_date,
    },
    "test_runs": {
        "projectId": _is_uuid,
        "activeOnly": _is_bool,
    },
}

SORT_ALLOWLIST: dict[str, set[str]] = {
    "test_cases": {
        f"{sign}{field}"
        for sign in ("", "-")
        for field in ("created_at", "title", "priority", "status")
    },
    "defects": set(),
    "test_runs": set(),
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
