from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, get_current_context
from app.core.db import get_db
from app.core.responses import envelope
from app.schemas.comment import CommentCreateRequest
from app.services import comment_service
from app.services.owner_access import (
    OWNER_TYPE_DEFECT,
    OWNER_TYPE_EXECUTION_STEP,
    OWNER_TYPE_TEST_CASE,
)

router = APIRouter(tags=["comments"])


@router.get("/test-cases/{test_case_id}/comments")
def list_test_case_comments(
    test_case_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    comments = comment_service.list_comments(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, OWNER_TYPE_TEST_CASE, test_case_id
    )
    return envelope([c.model_dump(mode="json") for c in comments])


@router.post("/test-cases/{test_case_id}/comments")
def create_test_case_comment(
    test_case_id: UUID,
    req: CommentCreateRequest,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    comment = comment_service.create_comment(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, OWNER_TYPE_TEST_CASE, test_case_id, req
    )
    return envelope(comment.model_dump(mode="json"))


@router.get("/defects/{defect_id}/comments")
def list_defect_comments(
    defect_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    comments = comment_service.list_comments(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, OWNER_TYPE_DEFECT, defect_id
    )
    return envelope([c.model_dump(mode="json") for c in comments])


@router.post("/defects/{defect_id}/comments")
def create_defect_comment(
    defect_id: UUID,
    req: CommentCreateRequest,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    comment = comment_service.create_comment(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, OWNER_TYPE_DEFECT, defect_id, req
    )
    return envelope(comment.model_dump(mode="json"))


@router.get("/execution-steps/{execution_step_id}/comments")
def list_execution_step_comments(
    execution_step_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    comments = comment_service.list_comments(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, OWNER_TYPE_EXECUTION_STEP, execution_step_id
    )
    return envelope([c.model_dump(mode="json") for c in comments])


@router.post("/execution-steps/{execution_step_id}/comments")
def create_execution_step_comment(
    execution_step_id: UUID,
    req: CommentCreateRequest,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    comment = comment_service.create_comment(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, OWNER_TYPE_EXECUTION_STEP,
        execution_step_id, req,
    )
    return envelope(comment.model_dump(mode="json"))


@router.delete("/comments/{comment_id}")
def delete_comment(
    comment_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    comment_service.delete_comment(db, ctx.tenant_id, ctx.role_code, ctx.user_id, comment_id)
    return envelope({"deleted": True})
