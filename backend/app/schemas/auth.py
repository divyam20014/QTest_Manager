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
