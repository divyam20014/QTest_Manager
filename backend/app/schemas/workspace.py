"""ADR-125: tenant workspace defaults (sidebar modules, project tabs, list view modes).

Stored as one small JSON document in ``tenants.workspace_config``. Everything here is cosmetic:
hiding an entry removes it from a menu, it never changes who may call an endpoint.
"""

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas.project import NavConfig

# Top-level sidebar entries an admin may order or hide (ids match frontend lib/navRegistry.ts).
# Entries every role needs to get around are core: reorderable, never hidden.
NAV_ENTRY_KEYS = (
    "home",
    "projects",
    "my-work",
    "test-management",
    "test-execution",
    "defects",
    "reports",
    "admin",
)
CORE_NAV_ENTRY_KEYS = ("home", "projects", "my-work", "admin")
HIDEABLE_NAV_ENTRY_KEYS = tuple(k for k in NAV_ENTRY_KEYS if k not in CORE_NAV_ENTRY_KEYS)

ViewModeName = Literal["list", "board", "calendar"]
# The modes each list really offers (frontend: DefectsList, TestCasesList, TestRunsList and
# TestRunsOverview). "list" is always available and cannot be switched off.
VIEW_MODE_LISTS: dict[str, tuple[str, ...]] = {
    "defects": ("list", "board"),
    "test_cases": ("list", "board"),
    "test_runs": ("list", "board", "calendar"),
}


class SidebarConfig(BaseModel):
    model_config = {"extra": "forbid"}

    order: list[str] = Field(default_factory=list, max_length=len(NAV_ENTRY_KEYS))
    hidden: list[str] = Field(default_factory=list, max_length=len(NAV_ENTRY_KEYS))

    @model_validator(mode="after")
    def _validate_keys(self) -> "SidebarConfig":
        for label, keys in (("order", self.order), ("hidden", self.hidden)):
            unknown = [k for k in keys if k not in NAV_ENTRY_KEYS]
            if unknown:
                raise ValueError(f"Unknown sidebar entry in {label}: {', '.join(unknown)}")
            if len(set(keys)) != len(keys):
                raise ValueError(f"Duplicate sidebar entry in {label}")
        locked = [k for k in self.hidden if k not in HIDEABLE_NAV_ENTRY_KEYS]
        if locked:
            raise ValueError(f"These sidebar entries cannot be hidden: {', '.join(locked)}")
        return self


class WorkspaceConfig(BaseModel):
    model_config = {"extra": "forbid"}

    sidebar: SidebarConfig = Field(default_factory=SidebarConfig)
    project_tabs: NavConfig = Field(default_factory=NavConfig)
    # list key -> the modes offered. Unlisted lists keep every built-in mode.
    view_modes: dict[str, list[ViewModeName]] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _validate_view_modes(self) -> "WorkspaceConfig":
        for list_key, modes in self.view_modes.items():
            allowed = VIEW_MODE_LISTS.get(list_key)
            if allowed is None:
                raise ValueError(f"Unknown list in view_modes: {list_key}")
            if len(set(modes)) != len(modes):
                raise ValueError(f"Duplicate view mode for {list_key}")
            if "list" not in modes:
                raise ValueError(f"The list view cannot be switched off ({list_key})")
            extra = [m for m in modes if m not in allowed]
            if extra:
                raise ValueError(f"{list_key} does not offer: {', '.join(extra)}")
        return self

    def is_default(self) -> bool:
        return (
            not self.sidebar.order
            and not self.sidebar.hidden
            and not self.project_tabs.order
            and not self.project_tabs.hidden
            and not self.view_modes
        )
