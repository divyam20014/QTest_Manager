from pydantic import BaseModel, field_validator


class TenantSettingsOut(BaseModel):
    default_currency_code: str
    default_timezone: str
    ai_enabled: bool
    ai_provider: str
    ai_api_key_configured: bool


class TenantSettingsUpdateRequest(BaseModel):
    default_currency_code: str | None = None
    default_timezone: str | None = None
    ai_enabled: bool | None = None
    # Write-only: the plaintext key, never echoed back. An empty string
    # clears a previously configured key.
    ai_api_key: str | None = None

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
