import pytest

from app.core.config import InsecureProductionConfigError, Settings, validate_for_production


def _base_production_settings(**overrides) -> Settings:
    defaults = dict(
        environment="production",
        database_url="postgresql+psycopg://real_user:real_pass@db.internal:5432/qtesthub",
        mfa_delivery_mode="real",
        cors_allow_origins=["https://app.example.com"],
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
