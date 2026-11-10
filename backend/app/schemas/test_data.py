from pydantic import BaseModel, Field


class FieldSpec(BaseModel):
    name: str = Field(min_length=1)
    type: str = Field(min_length=1)


class GenerateTestDataRequest(BaseModel):
    fields: list[FieldSpec] = Field(min_length=1, max_length=50)
    count: int = Field(ge=1, le=1000)


class MaskTestDataRequest(BaseModel):
    values: list[str] = Field(min_length=1, max_length=5000)
    salt: str = Field(min_length=1)
