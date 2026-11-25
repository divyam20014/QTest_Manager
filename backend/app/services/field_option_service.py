from typing import cast
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.errors import ConflictError, NotFoundError, ValidationAppError
from app.core.field_standards import (
    DEFECT_SEVERITY_ADDITIONS,
    TASK_PRIORITY_DEFAULTS,
    TEST_CASE_SEVERITY_DEFAULTS,
    TEST_TYPE_DEFAULTS,
)
from app.models.defect import Defect
from app.models.field_customization import FieldOption
from app.models.test_case import TestCase
from app.schemas.field_customization import (
    FieldKey,
    FieldOptionCreateRequest,
    FieldOptionOut,
    FieldOptionUpdateRequest,
)

# Mirrors the four values that used to be the only legal ones, hardcoded in
# a DB CheckConstraint -- seeded for every tenant (migration backfill for
# existing tenants, this function for new ones) so nothing changes by
# default. See ADR-055.
_DEFAULTS = ["Low", "Medium", "High", "Critical"]


def _to_out(option: FieldOption) -> FieldOptionOut:
    return FieldOptionOut(
        id=option.id,
        field_key=cast(FieldKey, option.field_key),
        code=option.code,
        label=option.label,
        color=option.color,
        sort_order=option.sort_order,
    )


def seed_defaults_for_tenant(db: Session, tenant_id: UUID) -> None:
    """Called once at tenant creation (platform_service.create_tenant_with_admin),
    alongside the Tier 1 subscription seed -- same "every tenant gets this
    at birth" pattern, not only a migration-time backfill of pre-existing
    tenants."""
    # ADR-115: the 22-field standard's sets are added on top of the legacy four
    # (defect severity gains Major/Minor; test case severity and Test Type are new
    # keys) -- the same defaults the migration seeds for existing tenants.
    option_sets: dict[str, list[str]] = {
        "defect_severity": [*_DEFAULTS, *DEFECT_SEVERITY_ADDITIONS],
        "test_case_priority": list(_DEFAULTS),
        "defect_priority": list(_DEFAULTS),
        "test_case_severity": list(TEST_CASE_SEVERITY_DEFAULTS),
        "test_type": list(TEST_TYPE_DEFAULTS),
        "task_priority": list(TASK_PRIORITY_DEFAULTS),
    }
    for field_key, codes in option_sets.items():
        for order, code in enumerate(codes):
            db.add(
                FieldOption(
                    tenant_id=tenant_id,
                    field_key=field_key,
                    code=code,
                    label=code,
                    sort_order=order,
                )
            )
    db.flush()


def list_options(db: Session, tenant_id: UUID, field_key: str) -> list[FieldOptionOut]:
    rows = db.execute(
        select(FieldOption)
        .where(FieldOption.tenant_id == tenant_id, FieldOption.field_key == field_key)
        .order_by(FieldOption.sort_order, FieldOption.label)
    ).scalars()
    return [_to_out(o) for o in rows]


def validate_code(db: Session, tenant_id: UUID, field_key: str, code: str) -> None:
    """Raises if `code` isn't one of this tenant's currently-configured
    options for `field_key` -- the service-layer replacement for the fixed
    DB CheckConstraint this field used to have."""
    exists = db.execute(
        select(FieldOption.id).where(
            FieldOption.tenant_id == tenant_id,
            FieldOption.field_key == field_key,
            FieldOption.code == code,
        )
    ).scalar_one_or_none()
    if exists is None:
        raise ValidationAppError(f"'{code}' is not a configured {field_key} option for this tenant")


def create_option(
    db: Session, tenant_id: UUID, actor_user_id: UUID, req: FieldOptionCreateRequest
) -> FieldOptionOut:
    existing = db.execute(
        select(FieldOption).where(
            FieldOption.tenant_id == tenant_id,
            FieldOption.field_key == req.field_key,
            FieldOption.code == req.code,
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise ConflictError(f"Option '{req.code}' already exists for {req.field_key}")

    max_order = db.execute(
        select(FieldOption.sort_order)
        .where(FieldOption.tenant_id == tenant_id, FieldOption.field_key == req.field_key)
        .order_by(FieldOption.sort_order.desc())
        .limit(1)
    ).scalar_one_or_none()

    option = FieldOption(
        tenant_id=tenant_id,
        field_key=req.field_key,
        code=req.code,
        label=req.label,
        color=req.color,
        sort_order=(max_order or 0) + 1 if max_order is not None else 0,
    )
    db.add(option)
    db.flush()
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="field_option.created",
        entity_type="field_option",
        entity_id=option.id,
        metadata={"field_key": req.field_key, "code": req.code},
    )
    db.commit()
    return _to_out(option)


def update_option(
    db: Session,
    tenant_id: UUID,
    actor_user_id: UUID,
    option_id: UUID,
    req: FieldOptionUpdateRequest,
) -> FieldOptionOut:
    option = db.execute(
        select(FieldOption).where(FieldOption.tenant_id == tenant_id, FieldOption.id == option_id)
    ).scalar_one_or_none()
    if option is None:
        raise NotFoundError("Field option not found")

    if req.label is not None:
        option.label = req.label
    if req.color is not None:
        option.color = req.color
    if req.sort_order is not None:
        option.sort_order = req.sort_order

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="field_option.updated",
        entity_type="field_option",
        entity_id=option.id,
        metadata={},
    )
    db.commit()
    return _to_out(option)


def delete_option(db: Session, tenant_id: UUID, actor_user_id: UUID, option_id: UUID) -> None:
    option = db.execute(
        select(FieldOption).where(FieldOption.tenant_id == tenant_id, FieldOption.id == option_id)
    ).scalar_one_or_none()
    if option is None:
        raise NotFoundError("Field option not found")

    # field_key -> (model, column) this value actually lives on. A binary
    # defect_severity-vs-else branch was correct while only two field_keys
    # existed; `defect_priority` (Pass 2) would have silently fallen into
    # the TestCase.priority branch under that assumption.
    in_use_column = {
        "defect_severity": Defect.severity,
        "defect_priority": Defect.priority,
        "test_case_priority": TestCase.priority,
        "test_case_severity": TestCase.severity,
        "test_type": TestCase.test_type,
    }[option.field_key]
    in_use_model = Defect if option.field_key.startswith("defect_") else TestCase
    in_use = (
        db.execute(
            select(in_use_model.id)
            .where(in_use_model.tenant_id == tenant_id, in_use_column == option.code)
            .limit(1)
        ).scalar_one_or_none()
        is not None
    )
    if in_use:
        raise ConflictError(
            f"'{option.code}' is still used by at least one existing record and cannot be deleted"
        )

    remaining = (
        db.execute(
            select(FieldOption.id).where(
                FieldOption.tenant_id == tenant_id,
                FieldOption.field_key == option.field_key,
                FieldOption.id != option_id,
            )
        )
        .scalars()
        .all()
    )
    if not remaining:
        raise ValidationAppError(f"At least one {option.field_key} option must remain")

    db.delete(option)
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="field_option.deleted",
        entity_type="field_option",
        entity_id=option_id,
        metadata={"field_key": option.field_key, "code": option.code},
    )
    db.commit()
