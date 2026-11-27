from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

MAX_TEAM_MEMBERS = 200


def _clean_name(v: str) -> str:
    return " ".join(v.split()) if isinstance(v, str) else v


class TeamCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    lead_user_id: UUID | None = None
    member_ids: list[UUID] = Field(default_factory=list, max_length=MAX_TEAM_MEMBERS)

    _name = field_validator("name", mode="before")(_clean_name)


class TeamUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=80)
    # Send null to leave the team without a lead.
    lead_user_id: UUID | None = None
    # Replaces the member list.
    member_ids: list[UUID] | None = Field(default=None, max_length=MAX_TEAM_MEMBERS)

    _name = field_validator("name", mode="before")(_clean_name)

    @model_validator(mode="after")
    def _name_stays_set(self) -> "TeamUpdateRequest":
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("name cannot be cleared")
        return self


class TeamMemberOut(BaseModel):
    user_id: UUID
    name: str
    is_active: bool


class TeamOut(BaseModel):
    id: UUID
    name: str
    lead_user_id: UUID | None
    lead_name: str | None
    members: list[TeamMemberOut]


class TeamAddToProjectOut(BaseModel):
    added: int
    already_members: int
    skipped_inactive: int
