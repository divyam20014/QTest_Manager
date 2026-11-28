from ipaddress import ip_network

from pydantic import BaseModel, field_validator

from app.schemas.platform import TenantPrimaryDomain
from app.schemas.project import DOMAIN_MAX_CHARS, MAX_PROJECT_DOMAINS, NO_DOMAIN


class TenantSettingsOut(BaseModel):
    default_currency_code: str
    default_timezone: str
    ai_enabled: bool
    ai_provider: str
    ai_api_key_configured: bool
    ip_allowlist: list[str]
    primary_domain: str | None = None
    # ADR-139: the domains projects may use, and whether this is the organization's own list.
    project_domains: list[str] = []
    project_domains_customised: bool = False
    testers_see_assigned_cases_only: bool = False
    reports_hidden_from_testers: bool = False
    # ADR-152
    require_run_environment_build: bool = False


class TenantSettingsUpdateRequest(BaseModel):
    default_currency_code: str | None = None
    default_timezone: str | None = None
    ai_enabled: bool | None = None
    # Write-only: the plaintext key, never echoed back. An empty string
    # clears a previously configured key.
    ai_api_key: str | None = None
    # Tier 4 / ADR-054 (PV-11.3): a full replace of the allowlist, never a
    # diff -- an empty list clears it (no restriction).
    ip_allowlist: list[str] | None = None
    # BRD gap Phase 4 / ADR-073: send the field to set it, send null to clear
    # it, omit it to leave it unchanged (distinguished via model_fields_set).
    primary_domain: TenantPrimaryDomain | None = None
    # ADR-139: replaces the list; send null to return to the built-in one, [] for none.
    project_domains: list[str] | None = None
    # ADR-093: Tester visibility switches (Admin only via tenant.settings.manage).
    testers_see_assigned_cases_only: bool | None = None
    reports_hidden_from_testers: bool | None = None
    # ADR-152: new test runs must name an environment and a build.
    require_run_environment_build: bool | None = None

    @field_validator("default_currency_code")
    @classmethod
    def _currency_code_shape(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip().upper()
        if len(v) != 3 or not v.isalpha():
            raise ValueError("default_currency_code must be a 3-letter ISO 4217 code")
        return v

    @field_validator("default_timezone")
    @classmethod
    def _timezone_not_empty(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("default_timezone must not be empty")
        return v

    @field_validator("project_domains")
    @classmethod
    def _domains_valid(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        cleaned: dict[str, str] = {}
        for entry in v:
            name = " ".join(entry.split())
            if not name or len(name) > DOMAIN_MAX_CHARS:
                raise ValueError(f"A domain needs 1 to {DOMAIN_MAX_CHARS} characters")
            if name.lower() == NO_DOMAIN.lower():
                raise ValueError(f"'{NO_DOMAIN}' is what reports call a project without one")
            cleaned.setdefault(name.lower(), name)
        if len(cleaned) > MAX_PROJECT_DOMAINS:
            raise ValueError(f"At most {MAX_PROJECT_DOMAINS} domains")
        return list(cleaned.values())

    @field_validator("ip_allowlist")
    @classmethod
    def _cidrs_valid(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        cleaned = []
        for entry in v:
            entry = entry.strip()
            try:
                ip_network(entry, strict=False)
            except ValueError as exc:
                raise ValueError(f"'{entry}' is not a valid IP address or CIDR block") from exc
            cleaned.append(entry)
        return cleaned


class TenantBrandingOut(BaseModel):
    display_name: str | None
    primary_color: str | None
    has_logo: bool
    # Readable by every tenant member (the shell and the new-project form need
    # it) -- it is a non-sensitive organisation label, like the display name.
    primary_domain: str | None = None
    # ADR-139: the new-project form needs the choices.
    project_domains: list[str] = []


class TenantBrandingUpdateRequest(BaseModel):
    display_name: str | None = None
    primary_color: str | None = None

    @field_validator("primary_color")
    @classmethod
    def _color_shape(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None
        v = v.strip()
        if not (v.startswith("#") and len(v) == 7):
            raise ValueError("primary_color must be a 7-character hex color, e.g. #1a2b3c")
        return v
