from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings

settings = get_settings()

engine = create_engine(settings.database_url, pool_pre_ping=True)
# expire_on_commit=False: services commit once and then build a response
# from the same objects. With the default (True), that post-commit access
# would trigger a refresh query in a NEW transaction that no longer has
# app.current_tenant set (ADR-007's RLS GUC is transaction-LOCAL), which
# RLS then correctly -- but unhelpfully -- denies.
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def set_tenant_context(db: Session, tenant_id: str) -> None:
    """Binds the RLS session variable for this transaction (ADR-007).

    Must be called with a tenant_id derived from the authenticated session,
    never from request input.

    Uses set_config(..., true) rather than `SET LOCAL app.x = :param`,
    since PostgreSQL's SET command does not accept bind parameters.
    """
    db.execute(
        text("SELECT set_config('app.current_tenant', :tenant_id, true)"),
        {"tenant_id": tenant_id},
    )
