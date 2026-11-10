from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, get_current_context, require_permission
from app.core.db import get_db
from app.core.responses import envelope
from app.schemas.field_customization import (
    CustomFieldDefinitionCreateRequest,
    CustomFieldDefinitionUpdateRequest,
    CustomFieldValuesSetRequest,
    FieldKey,
    FieldOptionCreateRequest,
    FieldOptionUpdateRequest,
    StatusEntityType,
    StatusLabelSetRequest,
)
from app.services import custom_field_service, field_option_service, status_label_service

router = APIRouter(tags=["field-customization"])


@router.get("/field-options")
def list_field_options(
    field_key: FieldKey = Query(...),
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    options = field_option_service.list_options(db, ctx.tenant_id, field_key)
    return envelope([o.model_dump(mode="json") for o in options])


@router.post("/field-options")
def create_field_option(
    req: FieldOptionCreateRequest,
    ctx: SessionContext = Depends(require_permission("field_customization.manage")),
    db: Session = Depends(get_db),
) -> dict:
    option = field_option_service.create_option(db, ctx.tenant_id, ctx.user_id, req)
    return envelope(option.model_dump(mode="json"))


@router.patch("/field-options/{option_id}")
def update_field_option(
    option_id: UUID,
    req: FieldOptionUpdateRequest,
    ctx: SessionContext = Depends(require_permission("field_customization.manage")),
    db: Session = Depends(get_db),
) -> dict:
    option = field_option_service.update_option(db, ctx.tenant_id, ctx.user_id, option_id, req)
    return envelope(option.model_dump(mode="json"))


@router.delete("/field-options/{option_id}")
def delete_field_option(
    option_id: UUID,
    ctx: SessionContext = Depends(require_permission("field_customization.manage")),
    db: Session = Depends(get_db),
) -> dict:
    field_option_service.delete_option(db, ctx.tenant_id, ctx.user_id, option_id)
    return envelope({"deleted": True})


@router.get("/status-labels")
def list_status_labels(
    entity_type: StatusEntityType = Query(...),
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    labels = status_label_service.list_labels(db, ctx.tenant_id, entity_type)
    return envelope([label.model_dump(mode="json") for label in labels])


@router.put("/status-labels")
def set_status_label(
    req: StatusLabelSetRequest,
    ctx: SessionContext = Depends(require_permission("field_customization.manage")),
    db: Session = Depends(get_db),
) -> dict:
    label = status_label_service.set_label(db, ctx.tenant_id, ctx.user_id, req)
    return envelope(label.model_dump(mode="json"))


@router.get("/custom-fields/definitions")
def list_custom_field_definitions(
    entity_type: str = Query(...),
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    definitions = custom_field_service.list_definitions(db, ctx.tenant_id, entity_type)
    return envelope([d.model_dump(mode="json") for d in definitions])


@router.post("/custom-fields/definitions")
def create_custom_field_definition(
    req: CustomFieldDefinitionCreateRequest,
    ctx: SessionContext = Depends(require_permission("field_customization.manage")),
    db: Session = Depends(get_db),
) -> dict:
    definition = custom_field_service.create_definition(db, ctx.tenant_id, ctx.user_id, req)
    return envelope(definition.model_dump(mode="json"))


@router.patch("/custom-fields/definitions/{definition_id}")
def update_custom_field_definition(
    definition_id: UUID,
    req: CustomFieldDefinitionUpdateRequest,
    ctx: SessionContext = Depends(require_permission("field_customization.manage")),
    db: Session = Depends(get_db),
) -> dict:
    definition = custom_field_service.update_definition(
        db, ctx.tenant_id, ctx.user_id, definition_id, req
    )
    return envelope(definition.model_dump(mode="json"))


@router.delete("/custom-fields/definitions/{definition_id}")
def delete_custom_field_definition(
    definition_id: UUID,
    ctx: SessionContext = Depends(require_permission("field_customization.manage")),
    db: Session = Depends(get_db),
) -> dict:
    custom_field_service.delete_definition(db, ctx.tenant_id, ctx.user_id, definition_id)
    return envelope({"deleted": True})


@router.get("/custom-fields/values/{owner_type}/{owner_id}")
def get_custom_field_values(
    owner_type: str,
    owner_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    values = custom_field_service.get_values_for_owner(db, ctx.tenant_id, owner_type, owner_id)
    return envelope({"values": values})


@router.put("/custom-fields/values/{owner_type}/{owner_id}")
def set_custom_field_values(
    owner_type: str,
    owner_id: UUID,
    req: CustomFieldValuesSetRequest,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    values = custom_field_service.set_values_for_owner(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, owner_type, owner_id, req.values
    )
    return envelope({"values": values})
