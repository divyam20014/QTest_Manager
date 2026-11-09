from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field

from app.schemas.common import StrongPassword

RoleCode = Literal["admin", "manager", "tester"]


class UserCreateRequest(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1)
    role: RoleCode
    password: StrongPassword


class PasswordResetRequest(BaseModel):
    new_password: StrongPassword


class UserUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    role: RoleCode | None = None
    is_active: bool | None = None


class UserOut(BaseModel):
    id: UUID
    email: str
    name: str
    role: RoleCode
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}
