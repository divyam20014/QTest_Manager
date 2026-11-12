import os
from pathlib import Path

TEST_DB_NAME = "qtesthub_test"

# Must happen before any `app.*` module is imported (conftest.py is loaded by
# pytest before test modules), since app.core.config caches settings from
# the environment on first access.
os.environ["DATABASE_URL"] = (
    f"postgresql+psycopg://qtesthub_app:qtesthub_app@localhost:5432/{TEST_DB_NAME}"
)
os.environ["MIGRATION_DATABASE_URL"] = (
    f"postgresql+psycopg://qtesthub:qtesthub@localhost:5432/{TEST_DB_NAME}"
)
# ADR-067: tenant-less login's identity-resolution lookup (BYPASSRLS,
# SELECT-only role created by the f1a2b3c4d5e6 migration).
os.environ["IDENTIFY_DATABASE_URL"] = (
    f"postgresql+psycopg://qtesthub_identify:qtesthub_identify@localhost:5432/{TEST_DB_NAME}"
)
os.environ["MFA_DELIVERY_MODE"] = "simulated"
# Fixed test-only Fernet key for AI Test Case Generator credential
# encryption (ADR-045) -- never used outside this test run.
os.environ["AI_CREDENTIAL_ENCRYPTION_KEY"] = "kEdknj1w6XzjMsv2T86nToujCkYjMqSYnr3CoPxuKAI="
# Non-secure cookies so TestClient can read them over plain http.
os.environ["ENVIRONMENT"] = "development"
# The default /data/attachments only exists inside the Docker container;
# local/CI test runs write to a throwaway temp dir instead.
os.environ["ATTACHMENTS_DIR"] = str(Path(__file__).resolve().parent / "_tmp_attachments")

import psycopg  # noqa: E402
import pytest  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402

from alembic import command  # noqa: E402

BACKEND_ROOT = Path(__file__).resolve().parent.parent
ADMIN_DSN = "postgresql://qtesthub:qtesthub@localhost:5432/postgres"
OWNER_URL = f"postgresql+psycopg://qtesthub:qtesthub@localhost:5432/{TEST_DB_NAME}"

_owner_engine = create_engine(OWNER_URL)


@pytest.fixture(scope="session", autouse=True)
def _test_database():
    admin_conn = psycopg.connect(ADMIN_DSN, autocommit=True)
    with admin_conn.cursor() as cur:
        cur.execute(f"DROP DATABASE IF EXISTS {TEST_DB_NAME} WITH (FORCE)")
        cur.execute(f"CREATE DATABASE {TEST_DB_NAME}")
    admin_conn.close()

    alembic_cfg = Config(str(BACKEND_ROOT / "alembic.ini"))
    alembic_cfg.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    alembic_cfg.set_main_option("sqlalchemy.url", OWNER_URL)
    command.upgrade(alembic_cfg, "head")

    yield

    _owner_engine.dispose()
    admin_conn = psycopg.connect(ADMIN_DSN, autocommit=True)
    with admin_conn.cursor() as cur:
        cur.execute(f"DROP DATABASE IF EXISTS {TEST_DB_NAME} WITH (FORCE)")
    admin_conn.close()


@pytest.fixture(autouse=True)
def _clean_tenant_data():
    yield
    # Cascades through every tenant-owned table via their tenant_id FK; the
    # RBAC seed (roles/permissions/role_permissions) is left untouched.
    with _owner_engine.begin() as conn:
        conn.execute(text("TRUNCATE TABLE tenants, platform_admins RESTART IDENTITY CASCADE"))


@pytest.fixture
def owner_engine():
    return _owner_engine


@pytest.fixture(autouse=True)
def _disable_rate_limiting():
    """GAP-16's login/MFA rate limiter uses in-memory, per-process storage
    keyed by client IP -- every test's TestClient looks like the same IP,
    so left enabled it would make most of this suite trip the limit well
    before 74 tests' worth of logins finish. Off by default; the dedicated
    rate-limit test re-enables and resets it for just that one test."""
    from app.core.rate_limit import limiter

    limiter.enabled = False
    yield


@pytest.fixture
def client() -> TestClient:
    from app.main import app

    return TestClient(app)


@pytest.fixture
def db_session():
    """A Session bound to the app role, for tests that call services
    directly rather than through TestClient's HTTP layer -- useful for
    isolating backend processing time from TestClient's own double-threaded
    ASGI-bridging overhead (not representative of a real deployed server)."""
    from app.core.db import SessionLocal

    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def platform_admin(owner_engine):
    from app.core.security import hash_password

    email = "owner@qtesthub.local"
    password = "PlatformOwner123!"
    with owner_engine.begin() as conn:
        conn.execute(
            text("INSERT INTO platform_admins (email, password_hash) VALUES (:email, :hash)"),
            {"email": email, "hash": hash_password(password)},
        )
    return {"email": email, "password": password}
