from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.api import (
    attachments,
    audit,
    auth,
    csv_import,
    defects,
    execution,
    platform,
    projects,
    reporting,
    test_cases,
    users,
)
from app.core.config import get_settings
from app.core.errors import AppError
from app.core.rate_limit import limiter
from app.core.responses import envelope

settings = get_settings()

app = FastAPI(title=settings.app_name, version="0.1.0")
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


@app.get("/api/v1/health")
def health() -> dict:
    return envelope({"status": "ok"})
