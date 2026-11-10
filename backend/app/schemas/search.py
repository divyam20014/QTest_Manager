from typing import Literal
from uuid import UUID

from pydantic import BaseModel

SearchResultType = Literal["test_case", "defect", "requirement"]


class SearchResultEntry(BaseModel):
    type: SearchResultType
    id: UUID
    title: str
    project_id: UUID
    project_name: str


class SearchResponse(BaseModel):
    query: str
    results: list[SearchResultEntry]
