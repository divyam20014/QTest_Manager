from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User"
SCIM_LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse"
SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error"


class ScimEmail(BaseModel):
    value: str
    primary: bool = True


class ScimMeta(BaseModel):
    resourceType: str = "User"
    created: datetime
    lastModified: datetime


class ScimUserOut(BaseModel):
    schemas: list[str] = [SCIM_USER_SCHEMA]
    id: str
    userName: str
    displayName: str
    emails: list[ScimEmail]
    active: bool
    meta: ScimMeta


class ScimUserCreateRequest(BaseModel):
    schemas: list[str] = [SCIM_USER_SCHEMA]
    userName: str = Field(min_length=1)
    displayName: str | None = None
    active: bool = True


class ScimUserReplaceRequest(BaseModel):
    schemas: list[str] = [SCIM_USER_SCHEMA]
    userName: str | None = None
    displayName: str | None = None
    active: bool | None = None


class ScimPatchOperation(BaseModel):
    op: str
    path: str | None = None
    value: Any = None


class ScimPatchRequest(BaseModel):
    schemas: list[str] = []
    Operations: list[ScimPatchOperation] = []


class ScimListResponse(BaseModel):
    schemas: list[str] = [SCIM_LIST_SCHEMA]
    totalResults: int
    startIndex: int
    itemsPerPage: int
    Resources: list[ScimUserOut]


class ScimTokenOut(BaseModel):
    id: UUID
    created_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None


class ScimTokenCreateResponse(BaseModel):
    id: UUID
    token: str
