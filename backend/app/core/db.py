from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings

settings = get_settings()

# ADR-113: a per-statement ceiling for the app role's connections, so a runaway
# query (or a client that stopped reading) cannot pin a pooled connection and,
# with it, a worker. Applied as a connection-level option, i.e. also to the
# worker process; 0 disables it (the worker compose service does, because the
# tenant-export job streams whole tables in single statements).
_connect_args: dict[str, str] = (
    {"options": f"-c statement_timeout={settings.db_statement_timeout_ms}"}
    if settings.db_statement_timeout_ms > 0
    else {}
)

engine = create_engine(
    settings.database_url,
    # One extra round trip per checkout; kept on by default so a connection the
    # server or a proxy dropped is never handed to a request. DB_POOL_PRE_PING=false
    # trades that for ~0.2 ms/checkout when pool_recycle alone is trusted.
    pool_pre_ping=settings.db_pool_pre_ping,
    connect_args=_connect_args,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_timeout=settings.db_pool_timeout,
    pool_recycle=settings.db_pool_recycle_seconds,
)
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


# ADR-067: a second, deliberately separate engine/session for tenant-less
# login's identity-resolution lookup (POST /auth/identify). It connects as
# `qtesthub_identify` (BYPASSRLS, SELECT-only on users/tenants -- see
# alembic/versions/f1a2b3c4d5e6_add_identify_role_for_tenantless_login.py),
# NOT as the ordinary `qtesthub_app` role bound to `engine` above. Reserved
# exclusively for app/services/identify_service.py's one read-only query --
# never use this session for anything authenticated, tenant-scoped, or
# state-changing, since it bypasses RLS entirely and has no tenant
# isolation of its own.
identify_engine = create_engine(settings.identify_database_url, pool_pre_ping=True, pool_size=2)
IdentifySessionLocal = sessionmaker(
    bind=identify_engine, autoflush=False, autocommit=False, expire_on_commit=False
)


def get_identify_db() -> Generator[Session, None, None]:
    db = IdentifySessionLocal()
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
