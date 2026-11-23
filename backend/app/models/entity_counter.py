from sqlalchemy import BigInteger, CheckConstraint, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TenantScopedMixin


class EntityCounter(Base, TenantScopedMixin):
    """ADR-115: per-tenant counter behind the human-readable ids (TC_000001,
    BUG_000001). `next_value` is the next number to hand out; allocation is one
    atomic upsert (app/services/display_id_service.py)."""

    __tablename__ = "entity_counters"
    __table_args__ = (
        CheckConstraint("kind in ('test_case','defect')", name="ck_entity_counters_kind"),
        CheckConstraint("next_value >= 1", name="ck_entity_counters_next_value"),
        UniqueConstraint("tenant_id", "kind", name="uq_entity_counters_tenant_kind"),
    )

    kind: Mapped[str] = mapped_column(String, nullable=False)
    next_value: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=1, server_default="1"
    )
