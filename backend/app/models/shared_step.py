import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TenantScopedMixin


class SharedStep(Base, TenantScopedMixin):
    """Pass 5: a reusable step-template library (project-scoped).

    Deliberately a template, not a live reference: inserting a shared step
    into a test case COPIES its current action/expected text at that
    moment. Editing the library entry afterward never retroactively
    changes a test case that already copied from it -- this preserves the
    existing immutable-version-snapshot model (ADR-001/ADR-003) exactly,
    where a test case's content only ever changes through its own
    authoring/approval workflow, never silently via a shared dependency.
    """

    __tablename__ = "shared_steps"

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    action: Mapped[str] = mapped_column(String, nullable=False)
    expected: Mapped[str] = mapped_column(String, nullable=False)
    category: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
