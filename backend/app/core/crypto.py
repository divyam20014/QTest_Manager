from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from app.core.config import get_settings


class CredentialEncryptionError(RuntimeError):
    pass


def parse_keys(raw: str) -> list[Fernet]:
    """Parses AI_CREDENTIAL_ENCRYPTION_KEY into Fernet instances (ADR-084).

    The value is a comma-separated list: the FIRST key encrypts, every key
    decrypts, which is what makes key rotation possible without downtime. A
    single key behaves exactly as it always did. Error messages name the
    position of a bad entry, never its value.
    """
    if not raw or not raw.strip():
        raise CredentialEncryptionError("AI_CREDENTIAL_ENCRYPTION_KEY is not configured")
    fernets: list[Fernet] = []
    for index, part in enumerate(raw.split(","), start=1):
        entry = part.strip()
        if not entry:
            raise CredentialEncryptionError(
                f"AI_CREDENTIAL_ENCRYPTION_KEY entry {index} is empty "
                "(stray comma or whitespace in the key list)"
            )
        try:
            fernets.append(Fernet(entry.encode()))
        except ValueError:
            # `from None`: never chain anything that could carry key material.
            raise CredentialEncryptionError(
                f"AI_CREDENTIAL_ENCRYPTION_KEY entry {index} is not a valid Fernet key "
                "(urlsafe-base64, 32 bytes)"
            ) from None
    return fernets


def get_multifernet(raw: str | None = None) -> MultiFernet:
    keys = parse_keys(get_settings().ai_credential_encryption_key if raw is None else raw)
    return MultiFernet(keys)


def encrypt_secret(plaintext: str) -> str:
    return get_multifernet().encrypt(plaintext.encode()).decode()


def decrypt_secret(ciphertext: str) -> str:
    try:
        return get_multifernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken as exc:
        raise CredentialEncryptionError("Stored credential could not be decrypted") from exc
