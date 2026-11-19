"""RFC 6238 TOTP (SHA-1, 6 digits, 30 s period) using only the standard
library, for Platform Admin MFA (ADR-074).

SHA-1 / 6 digits / 30 s is deliberately the one parameter set every
authenticator app (Google Authenticator, Microsoft Authenticator, Authy,
1Password, ...) supports without extra configuration. HMAC-SHA1 is not
affected by SHA-1's collision weaknesses.

Replay protection is the caller's job: `verify_totp` returns the matched
time step so the caller can persist it and reject any step <= the last one
accepted (a code is single-use even inside its +-1 step tolerance window).
"""

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

PERIOD_SECONDS = 30
DIGITS = 6
# +-1 step tolerates ordinary clock drift between the server and the phone.
WINDOW_STEPS = 1
SECRET_BYTES = 20  # 160 bits, the RFC 4226 recommended HOTP key length


def generate_secret() -> str:
    """A fresh random 160-bit secret, base32 without padding (what
    authenticator apps expect to be typed or encoded in a QR code)."""
    return base64.b32encode(secrets.token_bytes(SECRET_BYTES)).decode().rstrip("=")


def _decode_secret(secret_b32: str) -> bytes:
    normalized = secret_b32.strip().replace(" ", "").upper()
    padded = normalized + "=" * (-len(normalized) % 8)
    return base64.b32decode(padded, casefold=True)


def is_valid_secret(secret_b32: str) -> bool:
    try:
        return len(_decode_secret(secret_b32)) >= 10
    except (ValueError, TypeError):
        return False


def _hotp(key: bytes, counter: int) -> str:
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    binary = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(binary % (10**DIGITS)).zfill(DIGITS)


def time_step(at: float | None = None) -> int:
    return int((time.time() if at is None else at) // PERIOD_SECONDS)


def generate_code(secret_b32: str, at: float | None = None) -> str:
    """The code an authenticator would show at `at` (default: now). Used by
    tests, the dev seed tooling and the e2e fixtures -- never by a request
    handler to 'compute the answer' for a caller."""
    return _hotp(_decode_secret(secret_b32), time_step(at))


def verify_totp(
    secret_b32: str,
    code: str,
    *,
    last_used_step: int | None = None,
    at: float | None = None,
) -> int | None:
    """Returns the matched time step if `code` is valid for the secret within
    the tolerance window and the step has not already been used; else None.

    Every candidate step is compared (constant-time) and the loop never exits
    early, so timing doesn't reveal which step or digit position matched.
    """
    candidate = (code or "").strip()
    if len(candidate) != DIGITS or not candidate.isascii() or not candidate.isdigit():
        return None
    key = _decode_secret(secret_b32)
    now_step = time_step(at)
    matched: int | None = None
    for step in range(now_step - WINDOW_STEPS, now_step + WINDOW_STEPS + 1):
        if hmac.compare_digest(_hotp(key, step), candidate) and (
            last_used_step is None or step > last_used_step
        ):
            # Prefer the latest matching step (only differs in the
            # vanishingly unlikely event two adjacent steps share a code).
            matched = step if matched is None else max(matched, step)
    return matched


def provisioning_uri(secret_b32: str, account_email: str, issuer: str) -> str:
    """otpauth:// URI for QR enrolment (Key Uri Format)."""
    label = quote(f"{issuer}:{account_email}", safe="")
    return (
        f"otpauth://totp/{label}?secret={secret_b32}"
        f"&issuer={quote(issuer, safe='')}&algorithm=SHA1&digits={DIGITS}&period={PERIOD_SECONDS}"
    )
