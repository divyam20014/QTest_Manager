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
    gemini_model: str = "gemini-2.0-flash"
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

    @property
    def sentry_enabled(self) -> bool:
        return bool(self.sentry_dsn)


@lru_cache
def get_settings() -> Settings:
    return Settings()
