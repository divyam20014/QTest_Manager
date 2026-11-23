"""ADR-116: text hygiene for test case content (Markdown stored, never HTML).

Description, preconditions, postconditions, expected results and step text are
stored as Markdown text and rendered by the UI through a Markdown renderer with
raw HTML disabled. As defence in depth the API also removes HTML on the way in:
``<script>`` / ``<style>`` blocks are dropped with their content, remaining tags
and comments are stripped (their text content is kept), and control characters
are removed. A bare ``<`` or ``>`` that does not open a tag (``a < b``) is left
alone.
"""

import json
import re

_BLOCK_RE = re.compile(r"<\s*(script|style)\b[^>]*>.*?<\s*/\s*\1\s*>", re.I | re.S)
_TAG_RE = re.compile(r"<!--.*?-->|</?\s*[A-Za-z][^<>]*>", re.S)
_CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def sanitize_markdown(value: str) -> str:
    """Strip HTML and control characters, trim surrounding whitespace."""
    cleaned = _CTRL_RE.sub("", value)
    cleaned = _BLOCK_RE.sub("", cleaned)
    cleaned = _TAG_RE.sub("", cleaned)
    return cleaned.strip()


def clean_plain(value: str) -> str:
    """Control characters out and trimmed; no tag stripping (data fields)."""
    return _CTRL_RE.sub("", value).strip()


def detect_text_format(value: str | None) -> str | None:
    """'json' when `value` parses as a JSON object or array, else 'text'
    (None for an empty value)."""
    if value is None or not value.strip():
        return None
    try:
        parsed = json.loads(value)
    except ValueError:
        return "text"
    return "json" if isinstance(parsed, dict | list) else "text"
