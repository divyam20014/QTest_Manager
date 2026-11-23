import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy import text
from sqlalchemy.exc import DataError

from app.api import (
    access_rules,
    ai,
    attachments,
    audit,
    auth,
    ci,
    comments,
    csv_import,
    dashboards,
    defects,
    execution,
    export,
    field_customization,
    import_export,
    marketing,
    notifications,
    platform,
    platform_auth,
    projects,
    report_builder,
    report_schedule,
    reporting,
    requirements,
    roles,
    saved_views,
    scim,
    search,
    service_tokens,
    shared_steps,
    sso,
    templates,
    test_assets,
    test_cases,
    test_data,
    test_data_sets,
    test_modules,
    test_plans,
    test_suites,
    user_guide,
    users,
)
from app.api import (
    settings as settings_api,
)
from app.core.auth import client_ip
from app.core.config import get_settings, validate_for_production
from app.core.db import engine
from app.core.errors import AppError
from app.core.logging import configure_logging, logger, request_id_var
from app.core.rate_limit import limiter
from app.core.responses import envelope
from app.services.platform_audit_service import client_ip_var

settings = get_settings()
# Deployment-hardening pass: fail loudly at import time (before the app
# object or anything else is built) rather than let an insecure production
# deployment serve even a single request.
validate_for_production(settings)
configure_logging(settings.log_level, service_name="qtesthub-api")

# Tier 0 / ADR-052: optional error monitoring. A no-op when SENTRY_DSN is
# unset (dev/test), matching the fail-quiet-when-unconfigured convention
# used elsewhere (ai_credential_encryption_key, smtp_host) -- this one is
# "quiet" rather than "fail loud" because losing error reporting is not as
# dangerous as e.g. silently not sending an MFA code.
if settings.sentry_enabled:
    import sentry_sdk

    sentry_sdk.init(
        dsn=settings.sentry_dsn, environment=settings.environment, traces_sample_rate=0.0
    )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    logger.info("QTestHub API starting up (environment=%s)", settings.environment)
    yield


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)
# ADR-113: compress JSON/CSV bodies of 1 KB and up (list pages are 15-30 KB of
# highly repetitive JSON). Added before CORS so CORS stays the outer layer.
app.add_middleware(GZipMiddleware, minimum_size=1024)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # ADR-071: lets the SPA read the server-chosen filename of a file download
    # (fetch + blob) instead of falling back to a generic name.
    expose_headers=["Content-Disposition", "X-Result-Truncated"],
)


@app.middleware("http")
async def correlation_id(request: Request, call_next):
    # Tier 0 / ADR-052: propagate/generate a per-request id so every log
    # line emitted while handling this request (across service code, not
    # just this middleware) can be correlated, and so a client/proxy that
    # already generated one upstream is honored rather than overwritten.
    incoming = request.headers.get("x-request-id")
    request_id = incoming if incoming else str(uuid.uuid4())
    token = request_id_var.set(request_id)
    try:
        response = await call_next(request)
    finally:
        request_id_var.reset(token)
    response.headers["x-request-id"] = request_id
    return response


@app.middleware("http")
async def platform_audit_client_ip(request: Request, call_next):
    # ADR-082: lets the platform audit trail record the caller's IP from
    # anywhere in the service layer without threading `request` through it.
    token = client_ip_var.set(client_ip(request))
    try:
        return await call_next(request)
    finally:
        client_ip_var.reset(token)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start) * 1000
    logger.info(
        "%s %s %s %.1fms",
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    return response


@app.exception_handler(AppError)
def handle_app_error(request: Request, exc: AppError) -> JSONResponse:
    error: dict = {"code": exc.code, "message": exc.message}
    fields = getattr(exc, "fields", None)
    if fields:
        error["fields"] = fields
    return JSONResponse(status_code=exc.status_code, content={"data": None, "error": error})


# ADR-088: FastAPI's default 422 body is `{"detail": [...]}`, which is not this
# API's envelope (the frontend showed "Request failed"). Same status, enveloped.
@app.exception_handler(RequestValidationError)
def handle_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0] if exc.errors() else {}
    where = ".".join(str(part) for part in first.get("loc", ()) if part != "body")
    message = first.get("msg", "Invalid request")
    # ADR-116: every offending field, not only the first (`error.fields`).
    fields: dict[str, str] = {}
    for item in exc.errors():
        key = ".".join(str(part) for part in item.get("loc", ()) if part != "body")
        fields.setdefault(key or "body", str(item.get("msg", "Invalid value")))
    return JSONResponse(
        status_code=422,
        content={
            "data": None,
            "error": {
                "code": "validation_error",
                "message": f"{where}: {message}" if where else message,
                "fields": fields,
            },
        },
    )


# ADR-088: a value the database refuses to adapt/cast (e.g. a malformed UUID that
# slipped past schema typing into a raw query) is a bad request, not a server
# fault. Never echoes the driver message.
@app.exception_handler(DataError)
def handle_db_data_error(request: Request, exc: DataError) -> JSONResponse:
    logger.warning(
        "DataError on %s %s: %s", request.method, request.url.path, type(exc.orig).__name__
    )
    return JSONResponse(
        status_code=422,
        content={
            "data": None,
            "error": {"code": "invalid_value", "message": "A supplied value is malformed."},
        },
    )


@app.exception_handler(RateLimitExceeded)
def handle_rate_limit(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    logger.warning(
        "security_event=rate_limited path=%s client=%s", request.url.path, request.client
    )
    return JSONResponse(
        status_code=429,
        content={
            "data": None,
            "error": {
                "code": "rate_limited",
                "message": "Too many attempts. Please wait and try again.",
            },
        },
    )


# SAAS-GAP-15: a genuine unhandled bug previously fell through to Starlette's
# default error shape instead of this app's consistent envelope, which broke
# the frontend's uniform ApiError handling at exactly the moment something
# had already gone wrong. Logs the real exception server-side (never leaked
# to the client) and returns a generic, envelope-shaped 500.
@app.exception_handler(Exception)
def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "data": None,
            "error": {"code": "internal_error", "message": "An unexpected error occurred."},
        },
    )


app.include_router(platform.router, prefix="/api/v1")
app.include_router(platform_auth.router, prefix="/api/v1")
app.include_router(auth.router, prefix="/api/v1")
app.include_router(users.router, prefix="/api/v1")
app.include_router(projects.router, prefix="/api/v1")
app.include_router(import_export.router, prefix="/api/v1")
app.include_router(test_cases.router, prefix="/api/v1")
app.include_router(csv_import.router, prefix="/api/v1")
app.include_router(execution.router, prefix="/api/v1")
app.include_router(defects.router, prefix="/api/v1")
app.include_router(reporting.router, prefix="/api/v1")
app.include_router(audit.router, prefix="/api/v1")
app.include_router(user_guide.router, prefix="/api/v1")
app.include_router(attachments.router, prefix="/api/v1")
app.include_router(comments.router, prefix="/api/v1")
app.include_router(notifications.router, prefix="/api/v1")
app.include_router(settings_api.router, prefix="/api/v1")
app.include_router(requirements.router, prefix="/api/v1")
app.include_router(ai.router, prefix="/api/v1")
app.include_router(test_assets.router, prefix="/api/v1")
app.include_router(test_modules.router, prefix="/api/v1")
app.include_router(search.router, prefix="/api/v1")
app.include_router(export.router, prefix="/api/v1")
app.include_router(sso.router, prefix="/api/v1")
app.include_router(sso.admin_router, prefix="/api/v1")
app.include_router(scim.router, prefix="/api/v1")
app.include_router(scim.admin_router, prefix="/api/v1")
app.include_router(field_customization.router, prefix="/api/v1")
app.include_router(templates.router, prefix="/api/v1")
app.include_router(test_data.router, prefix="/api/v1")
app.include_router(service_tokens.router, prefix="/api/v1")
app.include_router(access_rules.router, prefix="/api/v1")
app.include_router(roles.router, prefix="/api/v1")
app.include_router(ci.router, prefix="/api/v1")
app.include_router(report_schedule.router, prefix="/api/v1")
app.include_router(saved_views.router, prefix="/api/v1")
app.include_router(report_builder.router, prefix="/api/v1")
app.include_router(dashboards.router, prefix="/api/v1")
app.include_router(shared_steps.router, prefix="/api/v1")
app.include_router(test_data_sets.router, prefix="/api/v1")
app.include_router(test_suites.router, prefix="/api/v1")
app.include_router(test_plans.router, prefix="/api/v1")
app.include_router(marketing.public_router, prefix="/api/v1")
app.include_router(marketing.admin_router, prefix="/api/v1")


@app.get("/api/v1/health")
def health() -> dict:
    return envelope({"status": "ok"})


# SAAS-GAP-16: liveness-only /health reports "healthy" even if the database
# connection pool is broken, defeating the point of an orchestrator health
# check. This does a cheap round trip to confirm real readiness.
@app.get("/api/v1/ready")
def ready() -> dict:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        logger.exception("Readiness check failed: database unreachable")
        return JSONResponse(  # type: ignore[return-value]
            status_code=503,
            content={
                "data": None,
                "error": {"code": "not_ready", "message": "Database is not reachable."},
            },
        )
    return envelope({"status": "ready"})
