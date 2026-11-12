from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "QTestHub"
    environment: str = "development"
    log_level: str = "INFO"

    database_url: str = "postgresql+psycopg://qtesthub:qtesthub@localhost:5432/qtesthub"
    # Owner-privileged connection used only to run Alembic migrations
    # (ADR-006: the runtime app role has UPDATE/DELETE revoked on audit_logs
    # and cannot alter schema). Falls back to database_url for local dev.
    migration_database_url: str | None = None

    # ADR-067: a second, narrowly-scoped runtime connection for tenant-less
    # login's identity-resolution lookup (POST /auth/identify). The
    # `users` table is RLS-scoped with FORCE ROW LEVEL SECURITY, so the
    # ordinary app role (bound by `database_url`) cannot look up a user by
    # email alone before any tenant is known -- this role is granted
    # BYPASSRLS, but SELECT-only on `users`/`tenants`, nothing else, and is
    # used by a dedicated engine reserved exclusively for that one lookup
    # (see app/core/db.py's identify_engine). Never used for anything
    # authenticated or state-changing.
    identify_database_url: str = (
        "postgresql+psycopg://qtesthub_identify:qtesthub_identify@localhost:5432/qtesthub"
    )

    session_cookie_name: str = "qth_session"
    session_ttl_minutes: int = 30
    session_absolute_ttl_hours: int = 12

    # ADR-011: MFA delivery mode. "simulated" logs/returns the code instead of
    # sending it through a real provider; only ever used outside production.
    mfa_delivery_mode: str = "simulated"

    # SMTP settings for "real" MFA delivery mode (ADR-032). Unused in
    # "simulated" mode. smtp_host empty means "not configured" -- real mode
    # fails loudly rather than silently not sending the code.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_email: str = "no-reply@qtesthub.local"
    smtp_use_tls: bool = True

    cors_allow_origins: list[str] = ["http://localhost:5173"]

    # ADR-012: attachment bytes live on disk, never as DB blobs. Matches the
    # `qtesthub_attachments` volume already mounted at this path in
    # docker-compose.yml; falls back to a local dir for tests/bare-metal dev.
    attachments_dir: str = "/data/attachments"
    attachment_max_bytes: int = 10 * 1024 * 1024

    # ADR-035: CSV bulk import limits. max_rows matches the spec's "maximum
    # 2,000 test cases per batch" rule; max_bytes is a generous ceiling for
    # a CSV of that size (long step cells included), not a tight budget.
    csv_import_max_bytes: int = 5 * 1024 * 1024
    csv_import_max_rows: int = 2000

    # AI/SaaS vision roadmap Phase 3 (ADR-045): Fernet key used to encrypt
    # tenant-supplied AI provider API keys at rest. Empty means "not
    # configured" -- saving a key fails loudly rather than storing it
    # unencrypted (same fail-loud convention as smtp_host).
    ai_credential_encryption_key: str = ""
    gemini_api_base_url: str = "https://generativelanguage.googleapis.com"
    # Google retired gemini-2.0-flash; its own 404 error names
    # gemini-3.8-flash as the replacement. Override via GEMINI_MODEL if
    # Google retires this one too, without a code change.
    gemini_model: str = "gemini-3.8-flash"
    ai_request_timeout_seconds: float = 30.0
    ai_max_cases_per_request: int = 5

    # Phase 9 (ADR-051): mirrors ADR-032's MFA simulated/real delivery
    # pattern. "simulated" (default outside production) records the
    # in-app notification only; "real" also emails it via the same SMTP
    # settings MFA already uses.
    notification_email_delivery_mode: str = "simulated"

    # Tier 0 / ADR-052: explicit SQLAlchemy pool tuning. Defaults match
    # SQLAlchemy's own built-in defaults (pool_size=5, max_overflow=10,
    # pool_timeout=30) so dev/test behavior is unchanged; a prod deployment
    # sets these via env vars sized to its expected concurrency.
    db_pool_size: int = 5
    db_max_overflow: int = 10
    db_pool_timeout: int = 30
    # Recycle connections periodically so a managed Postgres (which may
    # silently drop idle connections) never hands back a dead one.
    db_pool_recycle_seconds: int = 1800

    # Tier 0 / ADR-052: optional Sentry error monitoring. Empty (the
    # default) means "not configured" -- sentry_sdk.init is simply skipped,
    # matching the existing fail-quiet-when-unset convention used for
    # ai_credential_encryption_key/smtp_host being empty.
    sentry_dsn: str = ""

    # Tier 0 / ADR-052: platform-admin brute-force lockout (mirrors the
    # spirit of MFA's attempt_count, applied to the HTTP Basic plane since
    # a full session+MFA replacement was deliberately deferred -- see
    # ADR-052).
    platform_admin_max_failed_logins: int = 5
    platform_admin_lockout_minutes: int = 15

    # Tier 1 / ADR-053: pluggable attachment storage backend. "local" (the
    # default, unchanged dev/test behavior) writes under attachments_dir;
    # "s3" targets AWS S3 or any S3-compatible endpoint (MinIO, DO Spaces)
    # via s3_endpoint_url.
    storage_backend: str = "local"
    s3_bucket: str = ""
    s3_region: str = "us-east-1"
    s3_endpoint_url: str = ""
    s3_access_key_id: str = ""
    s3_secret_access_key: str = ""

    # Tier 1 / ADR-053: tenant user-invite token lifetime.
    user_invite_ttl_hours: int = 72

    # Tier 1 / ADR-053: DB-backed background job queue (no Redis/Celery in
    # the approved stack -- see ADR-053). The worker polls for queued jobs
    # at this interval when none are available.
    worker_poll_interval_seconds: float = 2.0

    # Tier 4 / ADR-054: only trust X-Forwarded-For for IP-allowlist
    # enforcement (PV-11.3) when a reverse proxy is actually in front of
    # the app (Tier 0's deploy/nginx/reverse-proxy.conf) -- a client can
    # set this header itself, so blindly trusting it with no proxy in
    # front would let anyone spoof their way past an allowlist. False by
    # default (dev/test, no proxy): the raw connection IP is used instead.
    trust_proxy_headers: bool = False

    # Tier 4 / ADR-054: tenant SSO (OIDC) config. No new env var is needed
    # for the common case -- per-tenant issuer/client_id/secret live in the
    # sso_configs table, not here. This only bounds the HTTP calls this
    # app itself makes to an IdP's discovery/token endpoints.
    sso_http_timeout_seconds: float = 10.0

    @property
    def sentry_enabled(self) -> bool:
        return bool(self.sentry_dsn)


_DEV_DATABASE_URL = "postgresql+psycopg://qtesthub:qtesthub@localhost:5432/qtesthub"
_DEV_IDENTIFY_DATABASE_URL = (
    "postgresql+psycopg://qtesthub_identify:qtesthub_identify@localhost:5432/qtesthub"
)
_DEV_CORS_ORIGINS = ["http://localhost:5173"]


class InsecureProductionConfigError(RuntimeError):
    """Raised at startup, not request time -- a misconfigured production
    deployment must fail to boot rather than silently run insecurely."""


def validate_for_production(settings: Settings) -> None:
    """Deployment-hardening pass: the many ``${VAR:?...}`` guards in
    docker-compose.prod.yml already refuse to start a container with an
    unset required variable, but that only helps when this exact compose
    file is used. This is the same check at the application layer, so an
    operator running the image any other way (a different orchestrator,
    bare `uvicorn`, a forgotten override) still can't boot an insecure
    production instance. Only runs when ENVIRONMENT=production -- dev/test
    must never trip this.
    """
    if settings.environment != "production":
        return

    problems: list[str] = []

    # Simulated MFA delivery returns the one-time code directly in the
    # /auth/login response body (ADR-011) -- exactly what "simulated" is
    # for in dev/test. Left on in production, every login response would
    # hand the attacker the MFA code needed to complete it.
    if settings.mfa_delivery_mode == "simulated":
        problems.append(
            "MFA_DELIVERY_MODE=simulated returns one-time codes directly in API "
            "responses -- set MFA_DELIVERY_MODE=real and configure SMTP_* for production."
        )

    if settings.database_url == _DEV_DATABASE_URL:
        problems.append(
            "DATABASE_URL is still the insecure local-dev default "
            "(qtesthub:qtesthub@localhost) -- set a real DATABASE_URL."
        )

    if settings.identify_database_url == _DEV_IDENTIFY_DATABASE_URL:
        problems.append(
            "IDENTIFY_DATABASE_URL is still the insecure local-dev default "
            "(qtesthub_identify:qtesthub_identify@localhost) -- this role has "
            "BYPASSRLS, so a weak/default password here is a real credential "
            "exposure -- set a real IDENTIFY_DATABASE_URL."
        )

    if not settings.cors_allow_origins or settings.cors_allow_origins == _DEV_CORS_ORIGINS:
        problems.append(
            "CORS_ALLOW_ORIGINS is unset or still the local-dev default "
            "(http://localhost:5173) -- set it to your real frontend origin(s)."
        )
    if "*" in settings.cors_allow_origins:
        problems.append(
            "CORS_ALLOW_ORIGINS includes '*', which is rejected by browsers anyway when "
            "credentials are allowed and would be unsafe even if it weren't -- "
            "list explicit origins."
        )

    if problems:
        raise InsecureProductionConfigError(
            "Refusing to start with ENVIRONMENT=production and insecure configuration:\n"
            + "\n".join(f"  - {p}" for p in problems)
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
