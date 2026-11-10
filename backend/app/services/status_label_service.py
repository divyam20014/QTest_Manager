from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.errors import ValidationAppError
from app.models.field_customization import StatusLabel
from app.schemas.field_customization import StatusEntityType, StatusLabelOut, StatusLabelSetRequest

# The fixed, built-in codes this overlay may attach a display label to --
# never touched themselves (see ADR-055 / field_customization.py's
# StatusLabel docstring for why status, unlike severity/priority, is kept
# this conservative).
_BUILT_IN: dict[str, dict[str, str]] = {
    "defect": {
        "New": "New",
        "Open": "Open",
        "Fixed": "Fixed",
        "Verified": "Verified",
        "Closed": "Closed",
    },
    "test_case": {
        "draft": "Draft",
        "ready_for_review": "Ready for Review",
        "approved": "Approved",
        "deprecated": "Deprecated",
    },
}


def get_labels_map(db: Session, tenant_id: UUID, entity_type: StatusEntityType) -> dict[str, str]:
    """Built-in label per code, overridden by any tenant customization --
    used by defect_service.to_out / test_case_service.to_out to populate
    `status_label` without every caller needing to know this layer exists."""
    labels = dict(_BUILT_IN.get(entity_type, {}))
    overrides = db.execute(
        select(StatusLabel).where(
            StatusLabel.tenant_id == tenant_id, StatusLabel.entity_type == entity_type
        )
    ).scalars()
    for row in overrides:
        labels[row.status_code] = row.label
    return labels


def list_labels(
    db: Session, tenant_id: UUID, entity_type: StatusEntityType
) -> list[StatusLabelOut]:
    labels = get_labels_map(db, tenant_id, entity_type)
    return [
        StatusLabelOut(entity_type=entity_type, status_code=code, label=label)
        for code, label in labels.items()
    ]


def set_label(
    db: Session, tenant_id: UUID, actor_user_id: UUID, req: StatusLabelSetRequest
) -> StatusLabelOut:
    if req.status_code not in _BUILT_IN.get(req.entity_type, {}):
        raise ValidationAppError(
            f"'{req.status_code}' is not a valid {req.entity_type} status code"
        )

    existing = db.execute(
        select(StatusLabel).where(
            StatusLabel.tenant_id == tenant_id,
            StatusLabel.entity_type == req.entity_type,
            StatusLabel.status_code == req.status_code,
        )
    ).scalar_one_or_none()

    if req.label is None:
        # None resets to the built-in label -- remove the override, if any.
        if existing is not None:
            db.delete(existing)
            record_audit_event(
                db,
                tenant_id=tenant_id,
                user_id=actor_user_id,
                action="status_label.reset",
                entity_type="status_label",
                entity_id=existing.id,
                metadata={"entity_type": req.entity_type, "status_code": req.status_code},
            )
            db.commit()
        return StatusLabelOut(
            entity_type=req.entity_type,
            status_code=req.status_code,
            label=_BUILT_IN[req.entity_type][req.status_code],
        )

    if existing is not None:
        existing.label = req.label
        label_row = existing
    else:
        label_row = StatusLabel(
            tenant_id=tenant_id,
            entity_type=req.entity_type,
            status_code=req.status_code,
            label=req.label,
        )
        db.add(label_row)
    db.flush()

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="status_label.set",
        entity_type="status_label",
        entity_id=label_row.id,
        metadata={
            "entity_type": req.entity_type,
            "status_code": req.status_code,
            "label": req.label,
        },
    )
    db.commit()
    return StatusLabelOut(entity_type=req.entity_type, status_code=req.status_code, label=req.label)
