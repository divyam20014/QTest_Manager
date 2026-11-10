from ipaddress import ip_network

from pydantic import BaseModel, field_validator


class TenantSettingsOut(BaseModel):
    default_currency_code: str
    default_timezone: str
    ai_enabled: bool
    ai_provider: str
    ai_api_key_configured: bool
    ip_allowlist: list[str]


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
