import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, SmallInteger, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TenantScopedMixin


class BackgroundJob(Base, TenantScopedMixin):
    """Tier 1 / ADR-053: lightweight DB-backed job queue (SR-6.10).

    Deliberately exempt from RLS, same reasoning as ADR-015's Session
    exemption: the worker process must scan for the next queued job across
    ALL tenants, before any tenant context can be set for that row. Every
    tenant-facing read of a job (status polling) is still explicitly
    filtered by `tenant_id == ctx.tenant_id` at the service layer -- the
    same "unguessable id + explicit filter" trust model Session already
    uses, not a DB-level guarantee.
    """

    __tablename__ = "background_jobs"
    __table_args__ = (
        CheckConstraint(
            "status in ('queued','running','succeeded','failed')", name="ck_background_jobs_status"
        ),
    )

    job_type: Mapped[str] = mapped_column(String, nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(
        String, nullable=False, default="queued", server_default="queued"
    )
    attempts: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, default=0, server_default="0"
    )
    error: Mapped[str | None] = mapped_column(String, nullable=True)
    result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
