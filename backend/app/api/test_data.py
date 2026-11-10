"""Gap-closure pass (ADR-057): minimal test-data generation/masking
utility (GAP-75). No persisted dataset, no tenant_id on these routes --
callers only ever see data they themselves provided (mask) or parameters
they themselves chose (generate); any authenticated tenant member can use
it, same bar as other read-only utility actions in this app."""

from fastapi import APIRouter, Depends

from app.core.auth import SessionContext, get_current_context
from app.core.errors import ValidationAppError
from app.core.responses import envelope
from app.schemas.test_data import GenerateTestDataRequest, MaskTestDataRequest
from app.services import test_data_service

router = APIRouter(prefix="/test-data", tags=["test-data"])


@router.get("/field-types")
def list_field_types(ctx: SessionContext = Depends(get_current_context)) -> dict:
    return envelope({"field_types": test_data_service.SUPPORTED_FIELD_TYPES})


@router.post("/generate")
def generate(
    req: GenerateTestDataRequest, ctx: SessionContext = Depends(get_current_context)
) -> dict:
    try:
        rows = test_data_service.generate_synthetic_rows(
            [(f.name, f.type) for f in req.fields], req.count
        )
    except ValueError as exc:
        raise ValidationAppError(str(exc)) from exc
    return envelope({"rows": rows})


@router.post("/mask")
def mask(req: MaskTestDataRequest, ctx: SessionContext = Depends(get_current_context)) -> dict:
    masked = test_data_service.mask_values(req.values, req.salt)
    return envelope({"masked": masked})
