class AppError(Exception):
    """Raised by services/routes; translated into the standard API envelope
    by the handler registered in app.main."""

    def __init__(self, code: str, message: str, status_code: int = 400) -> None:
        self.code = code
        self.message = message
        self.status_code = status_code
        super().__init__(message)


class NotFoundError(AppError):
    def __init__(self, message: str = "Not found") -> None:
        super().__init__("not_found", message, status_code=404)


class ForbiddenError(AppError):
    def __init__(self, message: str = "Forbidden") -> None:
        super().__init__("forbidden", message, status_code=403)


class AccessRuleBlockedError(AppError):
    """RBAC Phase 4 (ADR-092): a tenant access rule (release freeze, restricted
    environment) blocks this action. Carries the rule's admin-written reason as
    the message and nothing else about the rule."""

    def __init__(self, reason: str) -> None:
        super().__init__("blocked_by_access_rule", reason, status_code=403)


class UnauthorizedError(AppError):
    def __init__(self, message: str = "Unauthorized") -> None:
        super().__init__("unauthorized", message, status_code=401)


class ValidationAppError(AppError):
    def __init__(self, message: str, fields: dict[str, str] | None = None) -> None:
        super().__init__("validation_error", message, status_code=422)
        # ADR-116: one message per offending field, returned as `error.fields`.
        self.fields = fields


class ConflictError(AppError):
    def __init__(self, message: str) -> None:
        super().__init__("conflict", message, status_code=409)


class ConfigurationError(AppError):
    """Raised when a feature is enabled by config but its required
    infrastructure (e.g. an SMTP server) isn't configured. Fails loudly
    rather than silently degrading to a no-op."""

    def __init__(self, message: str) -> None:
        super().__init__("configuration_error", message, status_code=500)


class StepUpRequiredError(AppError):
    """ADR-083: a sensitive Platform Admin action needs a TOTP / recovery code
    verified within the step-up window. The stable `step_up_required` code lets
    the console prompt for a code and retry."""

    def __init__(self) -> None:
        super().__init__(
            "step_up_required",
            "Confirm with your authenticator code to continue",
            status_code=403,
        )


class SessionIdleError(AppError):
    """ADR-083: the session sat idle longer than the idle window."""

    def __init__(self, minutes: int) -> None:
        super().__init__(
            "session_idle_expired",
            f"You were signed out after {minutes} minutes of inactivity. Sign in again.",
            status_code=401,
        )
