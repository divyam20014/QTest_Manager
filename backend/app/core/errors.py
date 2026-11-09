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


class UnauthorizedError(AppError):
    def __init__(self, message: str = "Unauthorized") -> None:
        super().__init__("unauthorized", message, status_code=401)


class ValidationAppError(AppError):
    def __init__(self, message: str) -> None:
        super().__init__("validation_error", message, status_code=422)


class ConflictError(AppError):
    def __init__(self, message: str) -> None:
        super().__init__("conflict", message, status_code=409)


class ConfigurationError(AppError):
    """Raised when a feature is enabled by config but its required
    infrastructure (e.g. an SMTP server) isn't configured. Fails loudly
    rather than silently degrading to a no-op."""

    def __init__(self, message: str) -> None:
        super().__init__("configuration_error", message, status_code=500)
