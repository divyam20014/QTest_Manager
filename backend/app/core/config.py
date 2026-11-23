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

    # Multiplies the per-minute sign-in/MFA rate limits (app/core/rate_limit.py
    # `scaled`). Dev/e2e only; production must leave it at 1.
    auth_rate_limit_multiplier: int = 1

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

    # Local-dev default: browsers treat localhost and 127.0.0.1 as different
    # origins, so both are allowed. validate_for_production() still rejects
    # these defaults, so a production deploy must set CORS_ALLOW_ORIGINS.
    cors_allow_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

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

    # ADR-120: standard preview/commit import (csv + xlsx).
    import_file_max_bytes: int = 10 * 1024 * 1024
    import_max_rows: int = 20_000
    import_max_columns: int = 60
    import_zip_max_uncompressed_bytes: int = 100 * 1024 * 1024
    import_session_ttl_minutes: int = 30
    import_async_threshold: int = 2000
    import_session_max_bytes: int = 40 * 1024 * 1024

    # ADR-116 / ADR-117: when True, failing a step (verdict `fail`) needs a non-blank
    # `actual_result`. On by default now that the Execution Console asks for it;
    # set REQUIRE_ACTUAL_RESULT_ON_FAIL=false for API clients that do not send the
    # field yet. Blocking a case already needs a reason.
    require_actual_result_on_fail: bool = True

    # AI/SaaS vision roadmap Phase 3 (ADR-045): Fernet key used to encrypt
    # tenant-supplied AI provider API keys at rest. Empty means "not
    # configured" -- saving a key fails loudly rather than storing it
    # unencrypted (same fail-loud convention as smtp_host). ADR-084: may be a
    # comma-separated list for key rotation -- first key encrypts, all decrypt.
    ai_credential_encryption_key: str = ""

    # ADR-085 (GAP-01): HMAC key that signs audit-chain checkpoints. It must live
    # OUTSIDE the database (env / secret manager): the signature only protects
    # anything while the DB owner cannot read this key. Empty in dev/test falls
    # back to a public, dev-only constant; production refuses to boot without a
    # real key (validate_for_production).
    audit_checkpoint_hmac_key: str = ""
    # The worker writes checkpoints on this cadence (0 disables the worker loop;
    # `python -m scripts.audit_checkpoint` from cron works either way).
    audit_checkpoint_interval_seconds: float = 3600.0
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
    # ADR-113: per-statement ceiling (ms) applied to every pooled app connection so a
    # runaway query cannot hold a connection (and a worker) indefinitely. 0 disables.
    # Exports/verify-chain stream in short statements, so 30 s is generous.
    db_statement_timeout_ms: int = 30000
    db_pool_pre_ping: bool = True
    # ADR-113: seconds a read-only report result (dashboard summary, report
    # aggregates, ...) is reused in-process; invalidated on writes, hard-capped at
    # 60. 0 disables the cache.
    report_cache_ttl_seconds: float = 20.0

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

    # ADR-074: Platform Admin session + TOTP MFA (supersedes the HTTP Basic
    # plane described above). A distinct cookie name keeps a tenant session
    # from ever being read as a platform session and vice versa.
    platform_session_cookie_name: str = "qth_platform_session"
    platform_session_absolute_ttl_hours: int = 8
    # ADR-083: session hardening. Idle expiry, optional IP binding (off by default
    # because mobile / VPN users change address) and the step-up freshness window
    # for sensitive actions. The User-Agent binding is always on.
    platform_session_idle_minutes: int = 30
    platform_session_bind_ip: bool = False
    platform_step_up_minutes: int = 5
    # The password-verified, pre-MFA session is short-lived: it only has to
    # survive the time it takes to type a 6-digit code.
    platform_pre_mfa_ttl_minutes: int = 10
    platform_mfa_max_failed_attempts: int = 5
    platform_mfa_issuer: str = "QTestHub"
    # ADR-080: a first-time authenticator enrolment also needs a one-time code
    # that the creating admin hands over separately from the password.
    platform_enrolment_code_ttl_hours: int = 24
    # ADR-081: validity of an admin-issued one-time password-reset code.
    platform_password_reset_code_ttl_hours: int = 24

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
_DEV_CORS_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]


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

    # Real delivery with no SMTP host would fail every MFA email at login time.
    if settings.mfa_delivery_mode == "real" and not settings.smtp_host.strip():
        problems.append(
            "MFA_DELIVERY_MODE=real requires SMTP_HOST to be set -- without it no "
            "MFA code can be delivered and nobody can sign in."
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

    if not settings.cors_allow_origins or set(settings.cors_allow_origins) <= set(
        _DEV_CORS_ORIGINS
    ):
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

    # ADR-074: platform-admin TOTP secrets are encrypted at rest with the
    # same Fernet key as AI credentials. An empty/invalid key would make
    # every platform sign-in fail at runtime -- refuse to boot instead.
    if not settings.ai_credential_encryption_key:
        problems.append(
            "AI_CREDENTIAL_ENCRYPTION_KEY is unset -- it also encrypts platform-admin "
            "MFA secrets (ADR-074); generate one with Fernet.generate_key()."
        )
    else:
        # ADR-084: the value may be a comma-separated rotation list (first key
        # encrypts, all decrypt). Every entry must be a valid key; the message
        # names the position only, never a key value.
        from app.core.crypto import CredentialEncryptionError, parse_keys

        try:
            parse_keys(settings.ai_credential_encryption_key)
        except CredentialEncryptionError as exc:
            problems.append(f"{exc} -- it also encrypts platform-admin MFA secrets.")

    # ADR-085: the checkpoint signing key is the real tamper protection for the
    # audit chains, so it must be set, long, and not reused from another secret.
    key = settings.audit_checkpoint_hmac_key
    if not key:
        problems.append(
            "AUDIT_CHECKPOINT_HMAC_KEY is unset -- it signs audit-chain checkpoints "
            '(ADR-085); generate one with `python -c "import secrets; '
            'print(secrets.token_urlsafe(48))"`.'
        )
    elif len(key) < 32:
        problems.append("AUDIT_CHECKPOINT_HMAC_KEY must be at least 32 characters (ADR-085).")
    else:
        other_secrets = [
            *settings.ai_credential_encryption_key.split(","),
            settings.smtp_password,
            settings.s3_secret_access_key,
        ]
        reused = any(s and s.strip() == key for s in other_secrets) or any(
            key in url
            for url in (
                settings.database_url,
                settings.identify_database_url,
                settings.migration_database_url or "",
            )
        )
        if reused:
            problems.append(
                "AUDIT_CHECKPOINT_HMAC_KEY must differ from every other secret "
                "(encryption key, SMTP/S3 credentials, database passwords) (ADR-085)."
            )

    if settings.auth_rate_limit_multiplier != 1:
        problems.append(
            "AUTH_RATE_LIMIT_MULTIPLIER must be 1 in production -- it loosens the "
            "sign-in and MFA rate limits and exists only for dev/e2e stacks."
        )

    # ADR-083: a zero/negative idle window would lock everyone out, an absurd one
    # (> 24 h, i.e. longer than a day) makes the idle timeout meaningless. Same
    # bounds for the step-up window.
    if not 1 <= settings.platform_session_idle_minutes <= 1440:
        problems.append(
            "PLATFORM_SESSION_IDLE_MINUTES must be between 1 and 1440 -- it is the "
            "Platform Admin idle timeout (ADR-083)."
        )
    if not 1 <= settings.platform_step_up_minutes <= 1440:
        problems.append(
            "PLATFORM_STEP_UP_MINUTES must be between 1 and 1440 -- it is how long a "
            "TOTP step-up stays valid for sensitive Platform Admin actions (ADR-083)."
        )

    if problems:
        raise InsecureProductionConfigError(
            "Refusing to start with ENVIRONMENT=production and insecure configuration:\n"
            + "\n".join(f"  - {p}" for p in problems)
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
