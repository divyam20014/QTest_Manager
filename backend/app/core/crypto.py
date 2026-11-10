from cryptography.fernet import Fernet, InvalidToken

from app.core.config import get_settings


class CredentialEncryptionError(RuntimeError):
    pass


def _fernet() -> Fernet:
    key = get_settings().ai_credential_encryption_key
    if not key:
        raise CredentialEncryptionError("AI_CREDENTIAL_ENCRYPTION_KEY is not configured")
    try:
        return Fernet(key.encode())
    except ValueError as exc:
        raise CredentialEncryptionError("AI_CREDENTIAL_ENCRYPTION_KEY is not a valid key") from exc


def encrypt_secret(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_secret(ciphertext: str) -> str:
    try:
        return _fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken as exc:
        raise CredentialEncryptionError("Stored credential could not be decrypted") from exc
