import pytest

from app.core.config import InsecureProductionConfigError, Settings, validate_for_production


def _base_production_settings(**overrides) -> Settings:
    defaults = dict(
        environment="production",
        database_url="postgresql+psycopg://real_user:real_pass@db.internal:5432/qtesthub",
        mfa_delivery_mode="real",
        smtp_host="smtp.example.com",
        cors_allow_origins=["https://app.example.com"],
        ai_credential_encryption_key="kEdknj1w6XzjMsv2T86nToujCkYjMqSYnr3CoPxuKAI=",
        audit_checkpoint_hmac_key="Zk3p9vQw1LrT7yUaXc5NmB8dEh2GfJ4sRt6VnKo0WiA",
    )
    defaults.update(overrides)
    return Settings(**defaults)


def test_valid_production_config_passes() -> None:
    validate_for_production(_base_production_settings())  # must not raise


def test_dev_environment_is_never_checked() -> None:
    # Even the insecure local defaults are fine outside production.
    validate_for_production(Settings())


def test_simulated_mfa_in_production_is_rejected() -> None:
    with pytest.raises(InsecureProductionConfigError, match="MFA_DELIVERY_MODE"):
        validate_for_production(_base_production_settings(mfa_delivery_mode="simulated"))


def test_dev_database_url_in_production_is_rejected() -> None:
    with pytest.raises(InsecureProductionConfigError, match="DATABASE_URL"):
        validate_for_production(
            _base_production_settings(
                database_url="postgresql+psycopg://qtesthub:qtesthub@localhost:5432/qtesthub"
            )
        )


def test_dev_cors_origin_in_production_is_rejected() -> None:
    with pytest.raises(InsecureProductionConfigError, match="CORS_ALLOW_ORIGINS"):
        validate_for_production(
            _base_production_settings(cors_allow_origins=["http://localhost:5173"])
        )


def test_wildcard_cors_in_production_is_rejected() -> None:
    with pytest.raises(InsecureProductionConfigError, match="CORS_ALLOW_ORIGINS"):
        validate_for_production(_base_production_settings(cors_allow_origins=["*"]))


def test_multiple_problems_are_all_reported() -> None:
    with pytest.raises(InsecureProductionConfigError) as exc_info:
        validate_for_production(
            _base_production_settings(mfa_delivery_mode="simulated", cors_allow_origins=["*"])
        )
    message = str(exc_info.value)
    assert "MFA_DELIVERY_MODE" in message
    assert "CORS_ALLOW_ORIGINS" in message


def test_missing_encryption_key_in_production_is_rejected() -> None:
    # ADR-074: the Fernet key also protects platform-admin MFA secrets.
    with pytest.raises(InsecureProductionConfigError, match="AI_CREDENTIAL_ENCRYPTION_KEY"):
        validate_for_production(_base_production_settings(ai_credential_encryption_key=""))


def test_invalid_encryption_key_in_production_is_rejected() -> None:
    with pytest.raises(InsecureProductionConfigError, match="not a valid Fernet key"):
        validate_for_production(_base_production_settings(ai_credential_encryption_key="nope"))


def test_loosened_auth_rate_limit_in_production_is_rejected() -> None:
    with pytest.raises(InsecureProductionConfigError, match="AUTH_RATE_LIMIT_MULTIPLIER"):
        validate_for_production(_base_production_settings(auth_rate_limit_multiplier=10))


def test_real_mfa_without_smtp_host_in_production_is_rejected() -> None:
    with pytest.raises(InsecureProductionConfigError, match="SMTP_HOST"):
        validate_for_production(_base_production_settings(smtp_host=""))
