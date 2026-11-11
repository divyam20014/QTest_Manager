from uuid import UUID

from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    # ADR-017: email is only unique per tenant, so the tenant must be known
    # before the users table (tenant-RLS'd) can even be queried.
    tenant_id: UUID
    email: EmailStr
    password: str


class LoginResponse(BaseModel):
    mfa_required: bool = True


class MfaVerifyRequest(BaseModel):
    code: str


class MeResponse(BaseModel):
    user_id: UUID
    tenant_id: UUID
    email: str
    name: str
    role: str
    # Pass 2: the frontend previously had no way to recognize a custom role
    # (ADR-059) as admin/manager-equivalent -- several `role === 'admin'`
    # conditionals wouldn't light up for a custom role granted the same
    # real permissions. Exposing the actual permission set lets those
    # checks test capability instead of a hardcoded role name.
    permissions: list[str] = []
