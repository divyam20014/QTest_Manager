from pydantic import BaseModel, Field


class SsoConfigOut(BaseModel):
    enabled: bool
    issuer: str | None
    client_id: str | None
    default_role_code: str


class SsoConfigUpsertRequest(BaseModel):
    enabled: bool
    issuer: str = Field(min_length=1)
    client_id: str = Field(min_length=1)
    # Write-only, never echoed back. Omit/empty on an update that only
    # changes other fields to keep the previously stored secret.
    client_secret: str | None = None
    default_role_code: str = "tester"


class SsoStatusOut(BaseModel):
    enabled: bool
