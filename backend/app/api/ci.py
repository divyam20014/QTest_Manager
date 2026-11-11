from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import AppError
from app.core.rate_limit import limiter
from app.core.responses import envelope
from app.core.service_token_auth import require_service_token
from app.models.service_token import ServiceToken
from app.schemas.ci import CiResultOutcome, CiWebhookRequest, CiWebhookResponse
from app.services import execution_service

# A CI job posts here, authenticated by its own tenant-scoped service
# token (ADR-059) -- never the human session cookie, never platform-admin
# Basic auth. A new attack surface, so the same posture as every other
# auth-plane addition in this project: rate-limited, scoped, and swept by
# test_security_hardening.py.
router = APIRouter(prefix="/ci/{tenant_id}", tags=["ci"])


@router.post("/webhooks/test-results")
@limiter.limit("30/minute")
def ingest_test_results(
    tenant_id: UUID,
    req: CiWebhookRequest,
    request: Request,
    db: Session = Depends(get_db),
    token: ServiceToken = Depends(require_service_token("ci_results")),
) -> dict:
    outcomes: list[CiResultOutcome] = []
    for result in req.results:
        try:
            execution_service.record_ci_result(
                db, tenant_id, result.test_run_case_id, result.status, token.id
            )
            outcomes.append(
                CiResultOutcome(test_run_case_id=result.test_run_case_id, accepted=True)
            )
        except AppError as exc:
            # One bad row (an unknown test_run_case_id, a finished/paused
            # run) must not sink an entire CI batch -- reported per-row
            # instead of failing the whole request.
            outcomes.append(
                CiResultOutcome(
                    test_run_case_id=result.test_run_case_id, accepted=False, detail=str(exc)
                )
            )

    accepted = sum(1 for o in outcomes if o.accepted)
    return envelope(
        CiWebhookResponse(
            accepted_count=accepted,
            rejected_count=len(outcomes) - accepted,
            outcomes=outcomes,
        ).model_dump()
    )
