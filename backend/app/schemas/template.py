from uuid import UUID

from pydantic import BaseModel


class TemplateOut(BaseModel):
    id: str
    category: str
    title: str
    description: str
    priority: str


class TemplateImportRequest(BaseModel):
    template_ids: list[str]


class TemplateImportResultOut(BaseModel):
    imported_test_case_ids: list[UUID]
    modules_created: list[str]
