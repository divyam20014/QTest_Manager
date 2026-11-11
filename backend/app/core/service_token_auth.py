from uuid import UUID

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import UnauthorizedError
from app.models.service_token import ServiceToken
from app.services import service_token_service


def require_service_token(scope: str):
    """A third, deliberately narrow auth plane (ADR-059): bearer tokens
    scoped to one capability, never a human session or platform-admin
    identity. `tenant_id` is a path parameter on every route this guards
    (same shape as the SCIM routes it mirrors), so it is always known
    before the token lookup runs -- never a cross-tenant scan."""

    def _checker(
        tenant_id: UUID, request: Request, db: Session = Depends(get_db)
    ) -> ServiceToken:
        auth_header = request.headers.get("authorization", "")
        if not auth_header.lower().startswith("bearer "):
            raise UnauthorizedError("A service-token bearer token is required")
        raw_token = auth_header[len("bearer ") :].strip()
        token = service_token_service.authenticate(db, tenant_id, raw_token, scope)
        if token is None:
            raise UnauthorizedError("Invalid or out-of-scope service token")
        return token

    return _checker
