from uuid import UUID

from sqlalchemy.orm import Session

from app.core.errors import ValidationAppError
from app.services import defect_service, execution_service, test_case_service

OWNER_TYPE_TEST_CASE = "test_case"
OWNER_TYPE_DEFECT = "defect"
OWNER_TYPE_EXECUTION_STEP = "execution_step"


def authorize_owner_access(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, owner_type: str, owner_id: UUID
) -> None:
    """Shared polymorphic-ownership access check (Phase 7/ADR-049, reused by
    Phase 8's comments per ADR-050): a thing attached to an entity (a file,
    a comment) is never more visible than the entity itself -- dispatches
    to each owner type's own existing project-visibility check rather than
    duplicating it per feature."""
    if owner_type == OWNER_TYPE_TEST_CASE:
        test_case_service.get_test_case(db, tenant_id, role_code, user_id, owner_id)
    elif owner_type == OWNER_TYPE_DEFECT:
        defect_service.get_defect(db, tenant_id, role_code, user_id, owner_id)
    elif owner_type == OWNER_TYPE_EXECUTION_STEP:
        execution_service.get_execution_step(db, tenant_id, role_code, user_id, owner_id)
    else:
        raise ValidationAppError(f"Unsupported owner type: {owner_type}")
