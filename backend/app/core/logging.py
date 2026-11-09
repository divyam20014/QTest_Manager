"""Structured application logging setup.

Configures the root logger once at process startup. Request-level access
logs are emitted by the ASGI middleware registered in app.main so every
request is traceable (method, path, status, duration) without relying on
uvicorn's own access log format.
"""

import logging
import sys

_CONFIGURED = False


def configure_logging(level: str = "INFO") -> None:
    global _CONFIGURED
    if _CONFIGURED:
        return

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter(
            fmt="%(asctime)s %(levelname)s %(name)s %(message)s",
            datefmt="%Y-%m-%dT%H:%M:%S%z",
        )
    )

    root = logging.getLogger()
    root.setLevel(level)
    root.handlers = [handler]

    _CONFIGURED = True


logger = logging.getLogger("qtesthub")
