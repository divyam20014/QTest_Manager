from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.common import StrongPassword


class PlatformLoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=256)


class PlatformEnrolStartRequest(BaseModel):
    enrolment_code: str = Field(min_length=1, max_length=64)


class PlatformEnrolVerifyRequest(BaseModel):
    code: str = Field(min_length=6, max_length=8)
    enrolment_code: str = Field(min_length=1, max_length=64)


class PlatformMfaVerifyRequest(BaseModel):
    """Exactly one of `code` (TOTP) or `recovery_code` is expected."""

    code: str | None = Field(default=None, max_length=8)
    recovery_code: str | None = Field(default=None, max_length=40)


class PlatformSessionOut(BaseModel):
    email: str
    stage: str
    mfa_enrolled: bool
    recovery_codes_remaining: int | None = None
    # ADR-083: when the current step-up lapses (None = a code is needed first).
    step_up_expires_at: datetime | None = None


class PlatformStepUpRequest(BaseModel):
    """Exactly one of `code` (TOTP) or `recovery_code`."""

    code: str | None = Field(default=None, max_length=8)
    recovery_code: str | None = Field(default=None, max_length=40)


class PlatformStepUpOut(BaseModel):
    step_up_expires_at: datetime


class PlatformSessionListItem(BaseModel):
    """One of the caller's own sessions. No token or token hash, by design."""

    id: UUID
    created_at: datetime
    last_seen_at: datetime | None
    ip_address: str | None
    user_agent: str | None
    current: bool


class PlatformEnrolStartOut(BaseModel):
    secret: str
    otpauth_uri: str
    issuer: str
    account: str


class PlatformEnrolFinishOut(BaseModel):
    email: str
    stage: str
    recovery_codes: list[str]


class PlatformPasswordChangeRequest(BaseModel):
    """Self-service change: the current password plus exactly one of `code`
    (TOTP) or `recovery_code`. The new password follows the platform policy."""

    current_password: str = Field(min_length=1, max_length=256)
    new_password: StrongPassword
    code: str | None = Field(default=None, max_length=8)
    recovery_code: str | None = Field(default=None, max_length=40)


class PlatformPasswordResetRequest(BaseModel):
    """Unauthenticated reset flow: the one-time reset code another admin issued,
    the new password, and (when the admin is enrolled) exactly one of `code` /
    `recovery_code`."""

    email: str = Field(min_length=3, max_length=320)
    reset_code: str = Field(min_length=1, max_length=64)
    new_password: StrongPassword
    code: str | None = Field(default=None, max_length=8)
    recovery_code: str | None = Field(default=None, max_length=40)
