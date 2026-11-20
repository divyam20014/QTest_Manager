from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field

from app.schemas.common import StrongPassword

RoleCode = Literal["admin", "manager", "tester"]


class UserCreateRequest(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1)
    # ADR-059: `role` (the 3 fixed system role codes) stays for backward
    # compatibility -- every existing caller keeps working unchanged.
    # `role_id` is the new path, required to assign a tenant's own custom
    # role (which has no fixed code). Exactly one must be provided --
    # enforced in user_service, not here, since it needs a DB lookup either
    # way for role_id.
    role: RoleCode | None = None
    role_id: UUID | None = None
    password: StrongPassword


class PasswordResetRequest(BaseModel):
    new_password: StrongPassword


class UserUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    role: RoleCode | None = None
    role_id: UUID | None = None
    is_active: bool | None = None


class UserOut(BaseModel):
    id: UUID
    email: str
    name: str
    role: str
    role_id: UUID
    is_active: bool
    created_at: datetime
    # Pass C (deferred item #5, bug #20): most recent Session.last_seen_at
    # across every session this user has ever had, or null if they've
    # never logged in.
    last_login_at: datetime | None = None
    # ADR-086: set once the user's personal data has been erased; name/email
    # are then placeholders and clients should not present them as contact data.
    erased_at: datetime | None = None

    model_config = {"from_attributes": True}


class UserInviteRequest(BaseModel):
    """Tier 1 / ADR-053 (SR-2.4/5.11, SAAS-GAP-8): replaces admin-sets-the-
    password-directly provisioning (UserCreateRequest) with an invite the
    user accepts by setting their own password."""

    email: EmailStr
    name: str = Field(min_length=1)
    # ADR-059: the invite flow does not yet support assigning a custom role
    # (kept scoped to the 3 fixed system roles) -- direct user creation
    # (UserCreateRequest) is where role_id support landed this pass.
    role: RoleCode


class UserInviteOut(BaseModel):
    id: UUID
    email: str
    expires_at: datetime
    # Only non-None in "simulated" email-delivery mode (ADR-032/051's same
    # pattern) -- lets dev/test accept the invite without a mail server.
    invite_token: str | None = None


class InviteAcceptRequest(BaseModel):
    password: StrongPassword


class UserEraseRequest(BaseModel):
    """ADR-086. `dry_run` defaults to true so a bare call can never erase
    anything; a real run must also repeat the user's current email."""

    dry_run: bool = True
    confirm_email: str | None = None


class UserErasePreview(BaseModel):
    user_id: UUID
    dry_run: bool
    erased: bool
    # What is changed (or, for a dry run, would be changed), by table.
    changes: dict[str, int]
    # What is deliberately kept, by table (authorship stays as the pseudonymous user id).
    retained: dict[str, int]
    notes: list[str]
