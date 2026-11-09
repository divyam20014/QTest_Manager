from typing import Any


def envelope(data: Any) -> dict:
    return {"data": data, "error": None}
