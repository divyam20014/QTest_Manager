import secrets
import smtplib
from email.message import EmailMessage

from app.core.config import get_settings
from app.core.errors import ConfigurationError

settings = get_settings()


def generate_otp_code() -> str:
    """6-digit numeric code (FR-AUTH-003)."""
    return f"{secrets.randbelow(1_000_000):06d}"


def send_mfa_code(email: str, code: str) -> None:
    """Dispatches the MFA code per settings.mfa_delivery_mode (ADR-032).

    "simulated" (default outside production): does nothing here -- the
    caller (auth_service.start_login) returns the code directly in the API
    response instead, for local/dev/test use without a mail server.

    "real": sends the code by email via SMTP. Fails loudly (not silently)
    if SMTP isn't configured, rather than pretending delivery succeeded.
    """
    if settings.mfa_delivery_mode != "real":
        return

    if not settings.smtp_host:
        raise ConfigurationError(
            "MFA delivery mode is 'real' but SMTP is not configured (smtp_host is empty)"
        )

    message = EmailMessage()
    message["Subject"] = "Your QTestHub verification code"
    message["From"] = settings.smtp_from_email
    message["To"] = email
    message.set_content(
        f"Your QTestHub verification code is {code}. It expires in 5 minutes.\n\n"
        "If you did not request this, you can ignore this email."
    )

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as client:
        if settings.smtp_use_tls:
            client.starttls()
        if settings.smtp_username:
            client.login(settings.smtp_username, settings.smtp_password)
        client.send_message(message)
