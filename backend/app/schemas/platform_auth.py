from pydantic import BaseModel, Field


class PlatformLoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=256)


class PlatformEnrolVerifyRequest(BaseModel):
    code: str = Field(min_length=6, max_length=8)


class PlatformMfaVerifyRequest(BaseModel):
    """Exactly one of `code` (TOTP) or `recovery_code` is expected."""

    code: str | None = Field(default=None, max_length=8)
    recovery_code: str | None = Field(default=None, max_length=40)


class PlatformSessionOut(BaseModel):
    email: str
    stage: str
    mfa_enrolled: bool
    recovery_codes_remaining: int | None = None


class PlatformEnrolStartOut(BaseModel):
    secret: str
    otpauth_uri: str
    issuer: str
    account: str


class PlatformEnrolFinishOut(BaseModel):
    email: str
    stage: str
    recovery_codes: list[str]
