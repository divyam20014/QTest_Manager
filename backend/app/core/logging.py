"""Structured application logging setup (Tier 0 / ADR-052).

Configures the root logger once at process startup to emit one JSON object
per line (timestamp, level, logger name, message, and a request correlation
ID when available) rather than plain text -- so log lines are directly
machine-parseable by a log aggregator. Request-level access logs are emitted
by the ASGI middleware registered in app.main so every request is traceable
(method, path, status, duration) without relying on uvicorn's own access log
format.
"""

import json
import logging
import sys
from contextvars import ContextVar
from datetime import UTC, datetime

_CONFIGURED = False

# Bound by the correlation-ID middleware in app.main for the lifetime of a
# single request; read here so every log line emitted while handling that
# request carries the same id without threading it through every call site.
request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict = {
            "timestamp": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        request_id = request_id_var.get()
        if request_id is not None:
            payload["request_id"] = request_id
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(level: str = "INFO") -> None:
    global _CONFIGURED
    if _CONFIGURED:
        return

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())

    root = logging.getLogger()
    root.setLevel(level)
    root.handlers = [handler]

    _CONFIGURED = True


logger = logging.getLogger("qtesthub")
