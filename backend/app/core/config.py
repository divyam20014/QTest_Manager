from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "QTestHub"
    environment: str = "development"

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

    cors_allow_origins: list[str] = ["http://localhost:5173"]

    # ADR-012: attachment bytes live on disk, never as DB blobs. Matches the
    # `qtesthub_attachments` volume already mounted at this path in
    # docker-compose.yml; falls back to a local dir for tests/bare-metal dev.
    attachments_dir: str = "/data/attachments"
    attachment_max_bytes: int = 10 * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
