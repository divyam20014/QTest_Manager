import secrets


def generate_otp_code() -> str:
    """6-digit numeric code (FR-AUTH-003)."""
    return f"{secrets.randbelow(1_000_000):06d}"
