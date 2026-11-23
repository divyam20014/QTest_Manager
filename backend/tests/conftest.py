import os
import re
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
# ADR-113: report results must reflect every write immediately in tests; the
# cache itself is covered by tests/test_perf_optimisations.py.
os.environ["REPORT_CACHE_TTL_SECONDS"] = "0"
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
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402

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
        conn.execute(
            text(
                "TRUNCATE TABLE tenants, platform_admins, platform_audit_events, "
                "audit_chain_checkpoints, marketing_leads "
                "RESTART IDENTITY CASCADE"
            )
        )


# --- ADR-116: shared test-case builder -------------------------------------------------
#
# Creating a test case through the API now needs a module, preconditions, test data and a
# case-level expected result (many dozens of tests create cases with just title, priority
# and steps). Rather than weakening that validation, the test HTTP client fills in
# harmless defaults for the fields a request leaves out. A test that exercises the
# validation itself sends the header `X-Test-Strict-Create: 1` (stripped before the
# request goes out) and gets the API exactly as a real client does.

STRICT_CREATE_HEADER = "X-Test-Strict-Create"
_CREATE_PATH = re.compile(
    r"^(?:https?://[^/]+)?(?:/api/v1)?/projects/([0-9a-fA-F-]{36})/test-cases/?$"
)


# --- ADR-118: shared defect builder ------------------------------------------------------
#
# Creating a defect through the API now needs a description, at least one step to
# reproduce, expected and actual result, environment, severity and priority. Older tests
# send just a title and a severity; the test client fills the fields a request leaves out
# (never one it sends). `X-Test-Strict-Create: 1` talks to the API exactly as a client.

_DEFECT_PATH = re.compile(r"^(?:https?://[^/]+)?(?:/api/v1)?/defects/?$")


def _fill_defect_create_defaults(body: dict) -> dict:
    out = dict(body)
    from_execution = bool(out.get("execution_step_id") or out.get("test_run_case_id"))
    out.setdefault("priority", "Medium")
    if out.get("environment") is None and out.get("environment_id") is None:
        out["environment"] = "QA"
    if "actual_result" not in out:
        out["actual_result"] = "The behaviour differs from the expected result"
    if not from_execution:
        out.setdefault("description", "Steps and details are described below")
        if not out.get("repro_steps") and not out.get("steps_to_reproduce"):
            out["repro_steps"] = [{"action": "Perform the action that triggers the defect"}]
        out.setdefault("expected_result", "The feature behaves as specified")
    return out


def _default_module_id(project_id: str) -> str | None:
    with _owner_engine.begin() as conn:
        row = conn.execute(
            text(
                "SELECT id FROM test_modules WHERE project_id = :p AND parent_id IS NULL "
                "AND name = 'General' LIMIT 1"
            ),
            {"p": project_id},
        ).first()
        if row is None:
            row = conn.execute(
                text(
                    "INSERT INTO test_modules (tenant_id, project_id, name) "
                    "SELECT tenant_id, id, 'General' FROM projects WHERE id = :p RETURNING id"
                ),
                {"p": project_id},
            ).first()
    return str(row[0]) if row else None


@pytest.fixture(autouse=True)
def _fill_test_case_create_defaults(monkeypatch):
    original = TestClient.request

    def request(self, method, url, **kwargs):  # type: ignore[no-untyped-def]
        headers = kwargs.get("headers")
        strict = False
        if headers:
            headers = dict(headers)
            for key in list(headers):
                if key.lower() == STRICT_CREATE_HEADER.lower():
                    strict = True
                    headers.pop(key)
            kwargs["headers"] = headers
        body = kwargs.get("json")
        match = _CREATE_PATH.match(str(url))
        if method.upper() == "POST" and _DEFECT_PATH.match(str(url)) and isinstance(body, dict):
            if not strict:
                kwargs["json"] = _fill_defect_create_defaults(body)
        if method.upper() == "POST" and match and isinstance(body, dict) and not strict:
            body = dict(body)
            if "module_id" not in body:
                module_id = _default_module_id(match.group(1))
                if module_id:
                    body["module_id"] = module_id
            if "preconditions" not in body and "prerequisite" not in body:
                body["preconditions"] = "Environment is ready"
            body.setdefault("test_data", "none")
            body.setdefault("expected_result", "The feature behaves as specified")
            kwargs["json"] = body
        return original(self, method, url, **kwargs)

    monkeypatch.setattr(TestClient, "request", request)
    yield


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
    """A platform admin that is already MFA-enrolled and signed in through the
    real password + TOTP flow (ADR-074). `headers` carries the fully
    authenticated session cookie; `email`/`password`/`totp_secret` are there
    for tests that exercise the sign-in flow itself."""
    from app.main import app
    from tests.platform_helpers import (
        PLATFORM_EMAIL,
        PLATFORM_PASSWORD,
        PLATFORM_TOTP_SECRET,
        seed_admin,
        sign_in,
    )

    seed_admin(owner_engine)
    headers = sign_in(TestClient(app))
    return {
        "email": PLATFORM_EMAIL,
        "password": PLATFORM_PASSWORD,
        "totp_secret": PLATFORM_TOTP_SECRET,
        "headers": headers,
    }
