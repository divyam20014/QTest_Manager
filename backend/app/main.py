import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy import text

from app.api import (
    ai,
    attachments,
    audit,
    auth,
    csv_import,
    defects,
    execution,
    platform,
    projects,
    reporting,
    requirements,
    test_cases,
    users,
)
from app.api import (
    settings as settings_api,
)
from app.core.config import get_settings
from app.core.db import engine
from app.core.errors import AppError
from app.core.logging import configure_logging, logger
from app.core.rate_limit import limiter
from app.core.responses import envelope

settings = get_settings()
configure_logging(settings.log_level)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    logger.info("QTestHub API starting up (environment=%s)", settings.environment)
    yield


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
    return JSONResponse(
        status_code=exc.status_code,
        content={"data": None, "error": {"code": exc.code, "message": exc.message}},
    )


@app.exception_handler(RateLimitExceeded)
def handle_rate_limit(request: Request, exc: RateLimitExceeded) -> JSONResponse:
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
app.include_router(auth.router, prefix="/api/v1")
app.include_router(users.router, prefix="/api/v1")
app.include_router(projects.router, prefix="/api/v1")
app.include_router(test_cases.router, prefix="/api/v1")
app.include_router(csv_import.router, prefix="/api/v1")
app.include_router(execution.router, prefix="/api/v1")
app.include_router(defects.router, prefix="/api/v1")
app.include_router(reporting.router, prefix="/api/v1")
app.include_router(audit.router, prefix="/api/v1")
app.include_router(attachments.router, prefix="/api/v1")
app.include_router(settings_api.router, prefix="/api/v1")
app.include_router(requirements.router, prefix="/api/v1")
app.include_router(ai.router, prefix="/api/v1")


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
