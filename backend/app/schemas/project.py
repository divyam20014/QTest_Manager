from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

Domain = Literal["Motor", "Health", "Travel", "Life", "Property"]
Priority = Literal["Low", "Medium", "High", "Critical"]
ProjectStatus = Literal["On Track", "At Risk", "Delayed", "Completed"]


# ADR-122: the project workspace tabs a nav_config may order or hide. Core tabs are always shown
# (reorderable, never hidden); optional tabs may be hidden, except Settings, which stays reachable
# for whoever may edit the project. The frontend keeps the same lists in lib/projectNav.ts.
# ADR-128: "requirements" is no longer a tab (requirements live in tasks). ADR-131: Settings and
# Activity open from the project header. A saved layout that still names one of these is accepted
# and the key is dropped.
REMOVED_NAV_KEYS = ("requirements", "settings", "activity")
# ADR-131: these two tabs became the one "planning" tab.
MERGED_NAV_KEYS = {"planning": ("test-plans", "releases")}
CORE_NAV_KEYS = ("overview", "test-cases", "test-runs", "defects", "reports")
# ADR-127: "tasks" is optional so a tenant that does not use tasks can hide the tab.
OPTIONAL_NAV_KEYS = ("tasks", "planning", "team")
ALL_NAV_KEYS = CORE_NAV_KEYS + OPTIONAL_NAV_KEYS
HIDEABLE_NAV_KEYS = OPTIONAL_NAV_KEYS


def _without_repeats(keys: list) -> list:
    out: list = []
    for key in keys:
        if key not in out:
            out.append(key)
    return out


def _current_nav_keys(order: list, hidden: list) -> tuple[list, list]:
    """A layout saved before a tab was removed or merged, in today's keys. Layouts are
    validated whenever a project is read, so an old one must never be refused."""
    for new, old_keys in MERGED_NAV_KEYS.items():
        if any(k in old_keys for k in order):
            # The merged tab takes the place of whichever old one came first.
            order = _without_repeats([new if k in old_keys else k for k in order])
        if any(k in old_keys for k in hidden):
            # Hidden only if everything it replaced was hidden: otherwise something the
            # tenant could still see would disappear.
            all_hidden = new in hidden or all(k in hidden for k in old_keys)
            hidden = [k for k in hidden if k not in old_keys and k != new]
            if all_hidden:
                hidden.append(new)
    order = [k for k in order if k not in REMOVED_NAV_KEYS]
    hidden = [k for k in hidden if k not in REMOVED_NAV_KEYS]
    return order, hidden


class NavConfig(BaseModel):
    order: list[str] = Field(default_factory=list, max_length=len(ALL_NAV_KEYS))
    hidden: list[str] = Field(default_factory=list, max_length=len(ALL_NAV_KEYS))

    @model_validator(mode="before")
    @classmethod
    def _use_current_keys(cls, data: Any) -> Any:
        if isinstance(data, dict):
            order, hidden = data.get("order", []), data.get("hidden", [])
            if isinstance(order, list) and isinstance(hidden, list):
                data = dict(data)
                data["order"], data["hidden"] = _current_nav_keys(order, hidden)
        return data

    @model_validator(mode="after")
    def _validate_keys(self) -> "NavConfig":
        for label, keys in (("order", self.order), ("hidden", self.hidden)):
            unknown = [k for k in keys if k not in ALL_NAV_KEYS]
            if unknown:
                raise ValueError(f"Unknown project tab in {label}: {', '.join(unknown)}")
            if len(set(keys)) != len(keys):
                raise ValueError(f"Duplicate project tab in {label}")
        locked = [k for k in self.hidden if k not in HIDEABLE_NAV_KEYS]
        if locked:
            raise ValueError(f"These project tabs cannot be hidden: {', '.join(locked)}")
        return self


class ProjectCreateRequest(BaseModel):
    name: str = Field(min_length=3)
    domain: Domain
    priority: Priority
    status: ProjectStatus = "On Track"
    manager_name: str = Field(min_length=1)
    manager_user_id: UUID | None = None
    start_date: date
    end_date: date
    budget: Decimal = Field(ge=0)
    currency_code: str | None = Field(default=None, min_length=3, max_length=3)
    region: str = Field(min_length=1)

    @model_validator(mode="after")
    def _check_dates(self) -> "ProjectCreateRequest":
        if self.end_date < self.start_date:
            raise ValueError("Start date cannot be after end date.")
        return self


class ProjectUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=3)
    domain: Domain | None = None
    priority: Priority | None = None
    status: ProjectStatus | None = None
    manager_name: str | None = Field(default=None, min_length=1)
    manager_user_id: UUID | None = None
    start_date: date | None = None
    end_date: date | None = None
    budget: Decimal | None = Field(default=None, ge=0)
    currency_code: str | None = Field(default=None, min_length=3, max_length=3)
    region: str | None = Field(default=None, min_length=1)
    # Optimistic concurrency control (GAP-68): pass the project's current
    # `version` (from a prior GET/PATCH response) to detect a concurrent
    # edit -- the update is rejected with 409 if it doesn't match, instead
    # of silently overwriting another caller's change. Omit to keep the
    # previous last-write-wins behavior unchanged.
    expected_version: int | None = None
    # ADR-122: send null to go back to the default tabs.
    nav_config: NavConfig | None = None


class ProjectOut(BaseModel):
    id: UUID
    name: str
    domain: Domain
    status: ProjectStatus
    priority: Priority
    manager_name: str
    manager_user_id: UUID | None
    start_date: date
    end_date: date
    budget: Decimal
    currency_code: str
    region: str
    owner_id: UUID
    assigned_user_ids: list[UUID]
    created_at: datetime
    version: int
    nav_config: NavConfig | None = None
    test_case_count: int = 0
    approved_test_case_count: int = 0
    test_run_count: int = 0
    open_defect_count: int = 0


class ProjectListResponse(BaseModel):
    items: list[ProjectOut]
    total: int


class ProjectMemberAddRequest(BaseModel):
    user_id: UUID


class ProjectMemberOut(BaseModel):
    user_id: UUID
    name: str
    tenant_role_name: str
    project_role_id: UUID | None
    project_role_name: str | None


class ProjectMemberRoleUpdateRequest(BaseModel):
    # None clears the override, reverting the member to their tenant-wide
    # role for this project.
    role_id: UUID | None = None
