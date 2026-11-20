"""ADR-084: Fernet key rotation (multi-key helper + scripts/rotate_encryption_key.py).

Everything runs against the throwaway test database; no dev data is touched."""

import uuid

import pytest
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import text

from app.core.config import InsecureProductionConfigError, get_settings, validate_for_production
from app.core.crypto import CredentialEncryptionError, decrypt_secret, encrypt_secret, parse_keys
from scripts import rotate_encryption_key as rotate
from tests.platform_helpers import seed_admin
from tests.test_production_config_validation import _base_production_settings

OLD = Fernet.generate_key().decode()
NEW = Fernet.generate_key().decode()
TOTP = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"
AI_KEY = "sk-test-ai-key"
SSO_SECRET = "oidc-client-secret"


@pytest.fixture
def set_keys(monkeypatch):
    def _set(value: str) -> None:
        monkeypatch.setattr(get_settings(), "ai_credential_encryption_key", value)

    return _set


def _token(key: str, plaintext: str) -> str:
    return Fernet(key.encode()).encrypt(plaintext.encode()).decode()


def _can_decrypt(key: str, token: str) -> bool:
    try:
        Fernet(key.encode()).decrypt(token.encode())
        return True
    except InvalidToken:
        return False


# ---- multi-key helper -------------------------------------------------------


def test_single_key_behaves_as_before(set_keys) -> None:
    set_keys(OLD)
    token = encrypt_secret("hello")
    assert _can_decrypt(OLD, token)
    assert decrypt_secret(token) == "hello"
    assert len(parse_keys(OLD)) == 1


def test_encrypt_uses_first_key_and_all_keys_decrypt(set_keys) -> None:
    set_keys(f"{NEW},{OLD}")
    token = encrypt_secret("hello")
    assert _can_decrypt(NEW, token)
    assert not _can_decrypt(OLD, token)
    assert decrypt_secret(token) == "hello"
    # A value written under the old key is still readable.
    assert decrypt_secret(_token(OLD, "legacy")) == "legacy"


def test_whitespace_around_entries_is_tolerated(set_keys) -> None:
    set_keys(f" {NEW} , {OLD} ")
    assert decrypt_secret(_token(OLD, "x")) == "x"


def test_key_not_in_list_cannot_decrypt(set_keys) -> None:
    set_keys(NEW)
    with pytest.raises(CredentialEncryptionError, match="could not be decrypted"):
        decrypt_secret(_token(OLD, "x"))


@pytest.mark.parametrize("raw", ["", "   "])
def test_empty_value_is_not_configured(raw: str) -> None:
    with pytest.raises(CredentialEncryptionError, match="not configured"):
        parse_keys(raw)


# ---- production validation --------------------------------------------------


def test_production_accepts_a_valid_key_list() -> None:
    validate_for_production(_base_production_settings(ai_credential_encryption_key=f"{NEW},{OLD}"))


@pytest.mark.parametrize("bad", ["not-a-key-SECRETMARKER", ""])
def test_production_rejects_malformed_entry_without_leaking(bad: str) -> None:
    raw = f"{NEW},{bad},{OLD}"
    with pytest.raises(InsecureProductionConfigError) as exc:
        validate_for_production(_base_production_settings(ai_credential_encryption_key=raw))
    message = str(exc.value)
    assert "entry 2" in message
    for secret in (NEW, OLD, "SECRETMARKER"):
        assert secret not in message


@pytest.mark.parametrize("raw", [f"{NEW},", f",{NEW}", f"{NEW},,{OLD}"])
def test_production_rejects_empty_entry(raw: str) -> None:
    with pytest.raises(InsecureProductionConfigError, match="is empty"):
        validate_for_production(_base_production_settings(ai_credential_encryption_key=raw))


# ---- rotation script --------------------------------------------------------


def _seed(owner_engine, set_keys) -> uuid.UUID:
    """One row per encrypted column, all encrypted under OLD."""
    set_keys(OLD)
    seed_admin(owner_engine, email="rot-admin@example.com", totp_secret=TOTP)
    tenant_id = uuid.uuid4()
    with owner_engine.begin() as conn:
        conn.execute(
            text("INSERT INTO tenants (id, name, ai_api_key_encrypted) VALUES (:id, 'Rot Co', :k)"),
            {"id": tenant_id, "k": encrypt_secret(AI_KEY)},
        )
        conn.execute(
            text(
                "INSERT INTO sso_configs (id, tenant_id, issuer, client_id, "
                "client_secret_encrypted) VALUES (:id, :t, 'https://idp.example', 'cid', :s)"
            ),
            {"id": uuid.uuid4(), "t": tenant_id, "s": encrypt_secret(SSO_SECRET)},
        )
    return tenant_id


def _stored(owner_engine) -> dict[str, str]:
    with owner_engine.connect() as conn:
        return {
            "mfa": conn.execute(
                text("SELECT mfa_secret_encrypted FROM platform_admins")
            ).scalar_one(),
            "ai": conn.execute(text("SELECT ai_api_key_encrypted FROM tenants")).scalar_one(),
            "sso": conn.execute(
                text("SELECT client_secret_encrypted FROM sso_configs")
            ).scalar_one(),
        }


def test_dry_run_changes_nothing_and_reports_counts(owner_engine, set_keys, capsys) -> None:
    _seed(owner_engine, set_keys)
    before = _stored(owner_engine)
    set_keys(f"{NEW},{OLD}")
    assert rotate.main([]) == 0
    out = capsys.readouterr().out
    assert "Dry run" in out and "3 value(s) would be re-encrypted" in out
    assert _stored(owner_engine) == before
    for secret in (OLD, NEW, TOTP, AI_KEY, SSO_SECRET, *before.values()):
        assert secret not in out


def test_apply_reencrypts_under_primary_and_old_key_alone_fails(
    owner_engine, set_keys, capsys
) -> None:
    _seed(owner_engine, set_keys)
    set_keys(f"{NEW},{OLD}")
    assert rotate.main(["--verify"]) == 1  # not rotated yet
    assert rotate.main(["--apply"]) == 0
    after = _stored(owner_engine)
    for token in after.values():
        assert _can_decrypt(NEW, token)
        assert not _can_decrypt(OLD, token)
    # Same plaintexts, readable with the new key alone (the post-rotation deploy).
    set_keys(NEW)
    assert decrypt_secret(after["mfa"]) == TOTP
    assert decrypt_secret(after["ai"]) == AI_KEY
    assert decrypt_secret(after["sso"]) == SSO_SECRET
    assert rotate.main(["--verify"]) == 0
    out = capsys.readouterr().out
    assert "VERIFY OK" in out
    assert NEW not in out and OLD not in out


def test_apply_is_idempotent(owner_engine, set_keys, capsys) -> None:
    _seed(owner_engine, set_keys)
    set_keys(f"{NEW},{OLD}")
    assert rotate.main(["--apply"]) == 0
    first = _stored(owner_engine)
    capsys.readouterr()
    assert rotate.main(["--apply"]) == 0
    assert "Nothing to rotate" in capsys.readouterr().out
    assert _stored(owner_engine) == first  # no re-encryption churn


def test_undecryptable_value_aborts_with_no_partial_writes(owner_engine, set_keys, capsys) -> None:
    _seed(owner_engine, set_keys)
    stranger = Fernet.generate_key().decode()
    with owner_engine.begin() as conn:
        # The tenant AI key becomes unreadable by any configured key.
        conn.execute(
            text("UPDATE tenants SET ai_api_key_encrypted = :v"), {"v": _token(stranger, "x")}
        )
    before = _stored(owner_engine)
    set_keys(f"{NEW},{OLD}")
    assert rotate.main(["--apply"]) == 2
    out = capsys.readouterr().out
    assert "1 value(s) cannot be decrypted" in out
    assert _stored(owner_engine) == before  # the decryptable rows were NOT rotated either
    assert stranger not in out
    assert rotate.main(["--verify"]) == 2


def test_apply_rolls_back_everything_on_midway_failure(owner_engine, set_keys, monkeypatch) -> None:
    _seed(owner_engine, set_keys)
    before = _stored(owner_engine)
    set_keys(f"{NEW},{OLD}")
    real = rotate._classify
    calls = {"n": 0}

    def flaky(token, primary, every):
        # Passes the scan and the first self-check, fails the second self-check.
        result = real(token, primary, every)
        calls["n"] += 1
        return "bad" if calls["n"] == 8 else result

    monkeypatch.setattr(rotate, "_classify", flaky)
    # scan #1 (dry pass) = 3 calls, scan #2 = 3 classify + 2 self-checks pass, 3rd fails
    with pytest.raises(RuntimeError, match="self-check"):
        rotate.main(["--apply"])
    assert _stored(owner_engine) == before


def test_malformed_key_list_refuses_to_run(set_keys, capsys) -> None:
    set_keys(f"{NEW},nope-SECRETMARKER")
    assert rotate.main([]) == 2
    captured = capsys.readouterr()
    assert "SECRETMARKER" not in captured.out + captured.err


def test_script_covers_every_encrypted_column(owner_engine) -> None:
    """A new `*_encrypted` column must be added to the script's TARGETS, or a
    rotation would silently leave it on the old key."""
    with owner_engine.connect() as conn:
        found = {
            (r[0], r[1])
            for r in conn.execute(
                text(
                    "SELECT table_name, column_name FROM information_schema.columns "
                    "WHERE table_schema = 'public' AND column_name LIKE '%\_encrypted'"
                )
            )
        }
    assert found == {(table, column) for table, column, _ in rotate.TARGETS}
