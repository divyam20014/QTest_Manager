from uuid import UUID

from pydantic import BaseModel, Field


class PermissionOut(BaseModel):
    code: str
    description: str | None = None


class RoleCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    permission_codes: list[str] = Field(default_factory=list)


class RoleUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    permission_codes: list[str] | None = None


class RoleOut(BaseModel):
    id: UUID
    name: str
    code: str | None
    is_system: bool
    is_active: bool
    permission_codes: list[str]
    user_count: int

    model_config = {"from_attributes": True}
