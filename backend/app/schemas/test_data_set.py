from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class TestDataSetRowCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    data: dict = Field(default_factory=dict)


class TestDataSetRowOut(BaseModel):
    id: UUID
    test_data_set_id: UUID
    name: str
    data: dict
    created_at: datetime


class TestDataSetCreateRequest(BaseModel):
    name: str = Field(min_length=1)


class TestDataSetOut(BaseModel):
    id: UUID
    test_case_id: UUID
    name: str
    created_at: datetime
    rows: list[TestDataSetRowOut] = Field(default_factory=list)
