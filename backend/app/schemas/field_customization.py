from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

FieldKey = Literal["defect_severity", "test_case_priority"]
StatusEntityType = Literal["test_case", "defect"]
CustomFieldEntityType = Literal["test_case", "defect", "requirement"]
CustomFieldType = Literal["text", "number", "boolean", "date", "select", "multi_select"]


class FieldOptionCreateRequest(BaseModel):
    field_key: FieldKey
    code: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=120)
    color: str | None = None


class FieldOptionUpdateRequest(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    color: str | None = None
    sort_order: int | None = None


class FieldOptionOut(BaseModel):
    id: UUID
    field_key: FieldKey
    code: str
    label: str
    color: str | None
    sort_order: int


class StatusLabelSetRequest(BaseModel):
    entity_type: StatusEntityType
    status_code: str = Field(min_length=1, max_length=64)
    label: str | None = Field(
        default=None, min_length=1, max_length=120, description="None resets to the built-in label"
    )


class StatusLabelOut(BaseModel):
    entity_type: StatusEntityType
    status_code: str
    label: str


class CustomFieldDefinitionCreateRequest(BaseModel):
    entity_type: CustomFieldEntityType
    field_key: str = Field(min_length=1, max_length=64, pattern=r"^[a-z][a-z0-9_]*$")
    label: str = Field(min_length=1, max_length=120)
    field_type: CustomFieldType
    options: list[str] | None = None
    required: bool = False
    sort_order: int = 0


class CustomFieldDefinitionUpdateRequest(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    options: list[str] | None = None
    required: bool | None = None
    sort_order: int | None = None


class CustomFieldDefinitionOut(BaseModel):
    id: UUID
    entity_type: CustomFieldEntityType
    field_key: str
    label: str
    field_type: CustomFieldType
    options: list[str] | None
    required: bool
    sort_order: int
    created_at: datetime


class CustomFieldValuesSetRequest(BaseModel):
    values: dict[str, object]


class CustomFieldValuesOut(BaseModel):
    values: dict[str, object]
