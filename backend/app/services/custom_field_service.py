from typing import cast
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.db import set_tenant_context
from app.core.errors import NotFoundError, ValidationAppError
from app.models.field_customization import CustomFieldDefinition, CustomFieldValue
from app.schemas.field_customization import (
    CustomFieldDefinitionCreateRequest,
    CustomFieldDefinitionOut,
    CustomFieldDefinitionUpdateRequest,
    CustomFieldEntityType,
    CustomFieldType,
)
from app.services import owner_access


def _def_to_out(definition: CustomFieldDefinition) -> CustomFieldDefinitionOut:
    return CustomFieldDefinitionOut(
        id=definition.id,
        entity_type=cast(CustomFieldEntityType, definition.entity_type),
        field_key=definition.field_key,
        label=definition.label,
        field_type=cast(CustomFieldType, definition.field_type),
        options=definition.options,
        required=definition.required,
        sort_order=definition.sort_order,
        created_at=definition.created_at,
    )


def list_definitions(
    db: Session, tenant_id: UUID, entity_type: str
) -> list[CustomFieldDefinitionOut]:
    rows = db.execute(
        select(CustomFieldDefinition)
        .where(
            CustomFieldDefinition.tenant_id == tenant_id,
            CustomFieldDefinition.entity_type == entity_type,
        )
        .order_by(CustomFieldDefinition.sort_order, CustomFieldDefinition.label)
    ).scalars()
    return [_def_to_out(d) for d in rows]


def _validate_select_options(req_field_type: str, options: list[str] | None) -> None:
    if req_field_type in ("select", "multi_select"):
        if not options:
            raise ValidationAppError(f"'{req_field_type}' fields require a non-empty options list")
    elif options:
        raise ValidationAppError(f"'{req_field_type}' fields may not define options")


def create_definition(
    db: Session, tenant_id: UUID, actor_user_id: UUID, req: CustomFieldDefinitionCreateRequest
) -> CustomFieldDefinitionOut:
    _validate_select_options(req.field_type, req.options)

    existing = db.execute(
        select(CustomFieldDefinition).where(
            CustomFieldDefinition.tenant_id == tenant_id,
            CustomFieldDefinition.entity_type == req.entity_type,
            CustomFieldDefinition.field_key == req.field_key,
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise ValidationAppError(
            f"A custom field '{req.field_key}' already exists for {req.entity_type}"
        )

    definition = CustomFieldDefinition(
        tenant_id=tenant_id,
        entity_type=req.entity_type,
        field_key=req.field_key,
        label=req.label,
        field_type=req.field_type,
        options=req.options,
        required=req.required,
        sort_order=req.sort_order,
    )
    db.add(definition)
    db.flush()
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="custom_field_definition.created",
        entity_type="custom_field_definition",
        entity_id=definition.id,
        metadata={"entity_type": req.entity_type, "field_key": req.field_key},
    )
    db.commit()
    return _def_to_out(definition)


def update_definition(
    db: Session,
    tenant_id: UUID,
    actor_user_id: UUID,
    definition_id: UUID,
    req: CustomFieldDefinitionUpdateRequest,
) -> CustomFieldDefinitionOut:
    definition = db.execute(
        select(CustomFieldDefinition).where(
            CustomFieldDefinition.tenant_id == tenant_id, CustomFieldDefinition.id == definition_id
        )
    ).scalar_one_or_none()
    if definition is None:
        raise NotFoundError("Custom field definition not found")

    if req.options is not None:
        _validate_select_options(definition.field_type, req.options)
        definition.options = req.options
    if req.label is not None:
        definition.label = req.label
    if req.required is not None:
        definition.required = req.required
    if req.sort_order is not None:
        definition.sort_order = req.sort_order

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="custom_field_definition.updated",
        entity_type="custom_field_definition",
        entity_id=definition.id,
        metadata={},
    )
    db.commit()
    return _def_to_out(definition)


def delete_definition(
    db: Session, tenant_id: UUID, actor_user_id: UUID, definition_id: UUID
) -> None:
    definition = db.execute(
        select(CustomFieldDefinition).where(
            CustomFieldDefinition.tenant_id == tenant_id, CustomFieldDefinition.id == definition_id
        )
    ).scalar_one_or_none()
    if definition is None:
        raise NotFoundError("Custom field definition not found")

    # Deliberate: deletes the definition's own values too (ON DELETE CASCADE
    # at the DB level) -- this discards metadata an admin chose to remove,
    # not the TestCase/Defect/Requirement rows themselves.
    db.delete(definition)
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="custom_field_definition.deleted",
        entity_type="custom_field_definition",
        entity_id=definition_id,
        metadata={"entity_type": definition.entity_type, "field_key": definition.field_key},
    )
    db.commit()


def _validate_value(field_type: str, options: list[str] | None, value: object) -> None:
    if value is None:
        return
    if field_type == "text" and not isinstance(value, str):
        raise ValidationAppError("Expected a text value")
    if field_type == "number" and (isinstance(value, bool) or not isinstance(value, int | float)):
        raise ValidationAppError("Expected a numeric value")
    if field_type == "boolean" and not isinstance(value, bool):
        raise ValidationAppError("Expected a boolean value")
    if field_type == "date" and not isinstance(value, str):
        raise ValidationAppError("Expected an ISO date string")
    if field_type == "select":
        if value not in (options or []):
            raise ValidationAppError(f"'{value}' is not one of this field's configured options")
    if field_type == "multi_select":
        if not isinstance(value, list) or any(v not in (options or []) for v in value):
            raise ValidationAppError("Expected a list of this field's configured options")


def get_values_for_owner(
    db: Session, tenant_id: UUID, owner_type: str, owner_id: UUID
) -> dict[str, object]:
    rows = db.execute(
        select(CustomFieldDefinition.field_key, CustomFieldValue.value)
        .join(
            CustomFieldValue,
            (CustomFieldValue.field_definition_id == CustomFieldDefinition.id)
            & (CustomFieldValue.owner_id == owner_id)
            & (CustomFieldValue.owner_type == owner_type),
            isouter=True,
        )
        .where(
            CustomFieldDefinition.tenant_id == tenant_id,
            CustomFieldDefinition.entity_type == owner_type,
        )
    ).all()
    return {field_key: value for field_key, value in rows}


def set_values_for_owner(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    owner_type: str,
    owner_id: UUID,
    values: dict[str, object],
) -> dict[str, object]:
    """Authorization mirrors Comments/Attachments (ADR-049/050): visibility
    of the owning entity is the gate, not a separate edit permission -- the
    same precedent those features already set."""
    owner_access.authorize_owner_access(
        db, tenant_id, role_code, actor_user_id, owner_type, owner_id
    )

    definitions = {
        d.field_key: d
        for d in db.execute(
            select(CustomFieldDefinition).where(
                CustomFieldDefinition.tenant_id == tenant_id,
                CustomFieldDefinition.entity_type == owner_type,
            )
        ).scalars()
    }

    for field_key in values:
        if field_key not in definitions:
            raise ValidationAppError(f"Unknown custom field '{field_key}' for {owner_type}")

    for field_key, definition in definitions.items():
        if definition.required and field_key in values and values[field_key] is None:
            raise ValidationAppError(f"'{definition.label}' is required")
        if field_key in values:
            _validate_value(definition.field_type, definition.options, values[field_key])

    for field_key, value in values.items():
        definition = definitions[field_key]
        existing = db.execute(
            select(CustomFieldValue).where(
                CustomFieldValue.field_definition_id == definition.id,
                CustomFieldValue.owner_id == owner_id,
            )
        ).scalar_one_or_none()
        if existing is not None:
            existing.value = value
        else:
            db.add(
                CustomFieldValue(
                    tenant_id=tenant_id,
                    field_definition_id=definition.id,
                    owner_type=owner_type,
                    owner_id=owner_id,
                    value=value,
                )
            )

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="custom_field_values.set",
        entity_type=owner_type,
        entity_id=owner_id,
        metadata={"fields": list(values.keys())},
    )
    db.commit()
    # ADR-007 addendum: the RLS GUC is transaction-local and resets on
    # commit -- re-assert it before the post-commit read below, the same
    # pattern every other service's `_to_out` already follows.
    set_tenant_context(db, str(tenant_id))
    return get_values_for_owner(db, tenant_id, owner_type, owner_id)
