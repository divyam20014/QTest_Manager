from fastapi import Depends
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import UnauthorizedError
from app.core.security import verify_password
from app.models.identity import PlatformAdmin

_security = HTTPBasic()


def require_platform_admin(
    credentials: HTTPBasicCredentials = Depends(_security), db: Session = Depends(get_db)
) -> PlatformAdmin:
    """Platform Administration is provisioning-only (ADR-008): separate from
    tenant RBAC, authenticated against the RLS-exempt platform_admins table.
    """
    admin = db.execute(
        select(PlatformAdmin).where(PlatformAdmin.email == credentials.username)
    ).scalar_one_or_none()
    if admin is None or not verify_password(credentials.password, admin.password_hash):
        raise UnauthorizedError("Invalid platform admin credentials")
    return admin
