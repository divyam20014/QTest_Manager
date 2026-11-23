"""ADR-120: the single-cell steps format of the import / export files.

One step per line, three parts separated by a vertical bar::

    1. Open the claim | Policy: AUTO-100234 | The claim opens
    2. Choose Total Loss | | The settlement is shown

``N. action | test data | expected result``. The test data and the expected result may be
left empty (keep the bars); a literal bar inside a part is written ``\\|``; a line that does
not start with a number continues the previous step. Parts may also carry the labels
``data:`` / ``expected:`` (the earlier defect export wrote them that way). A cell without
numbered lines is read as one step per line, and a single line with ';' separators is the
legacy test case layout ``Action|Expected[|Test data]``. Pure functions, no I/O.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.core.field_standards import MAX_STEPS, STEP_DATA_MAX, STEP_TEXT_MAX
from app.core.text_sanitize import clean_plain, sanitize_markdown

_NUMBERING = re.compile(r"^\s*\d{1,4}\s*[.)]\s*")
_BAR = re.compile(r"(?<!\\)\|")
_DATA_LABEL = re.compile(r"^\s*(?:test\s+data|data)\s*:\s*", re.I)
_EXPECTED_LABEL = re.compile(r"^\s*expected(?:\s+result)?\s*:\s*", re.I)


@dataclass(frozen=True)
class ParsedStep:
    action: str
    test_data: str | None
    expected: str | None


def _unescape(part: str) -> str:
    return part.replace("\\|", "|").strip()


def _split_entries(text: str) -> tuple[list[str], bool]:
    """-> (raw step texts, legacy semicolon layout)."""
    lines = [ln for ln in text.split("\n")]
    if any(_NUMBERING.match(ln) for ln in lines):
        entries: list[str] = []
        for line in lines:
            if _NUMBERING.match(line):
                entries.append(_NUMBERING.sub("", line, count=1))
            elif not line.strip():
                continue
            elif entries:
                entries[-1] += "\n" + line.strip()
            else:
                entries.append(line.strip())
        return entries, False
    non_empty = [ln.strip() for ln in lines if ln.strip()]
    if len(non_empty) == 1 and ";" in non_empty[0]:
        return [c for c in (x.strip() for x in non_empty[0].split(";")) if c], True
    return non_empty, False


def parse_steps(raw: str | None, *, require_expected: bool) -> tuple[list[ParsedStep], list[str]]:
    """Parse one steps cell. Returns the steps and the problems found (each message
    names the step), never raising."""
    text = (raw or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        return [], []
    entries, legacy = _split_entries(text)
    steps: list[ParsedStep] = []
    errors: list[str] = []
    for number, entry in enumerate(entries, start=1):
        parts = [_unescape(p) for p in _BAR.split(entry)]
        if len(parts) > 3:
            errors.append(f"Step {number} has more than three parts; write a literal '|' as '\\|'.")
            continue
        action = parts[0]
        data: str | None = None
        expected: str | None = None
        rest = parts[1:]
        if any(_DATA_LABEL.match(p) or _EXPECTED_LABEL.match(p) for p in rest):
            for part in rest:
                if _DATA_LABEL.match(part):
                    data = _DATA_LABEL.sub("", part, count=1)
                elif _EXPECTED_LABEL.match(part):
                    expected = _EXPECTED_LABEL.sub("", part, count=1)
                elif data is None:
                    data = part
                else:
                    expected = part
        elif legacy:
            # Action|Expected[|Test data]
            expected = rest[0] if rest else None
            data = rest[1] if len(rest) > 1 else None
        elif len(rest) == 1:
            expected = rest[0]  # 'action | expected'
        elif len(rest) == 2:
            data, expected = rest
        action = sanitize_markdown(action)
        expected_clean = sanitize_markdown(expected) if expected else ""
        data_clean = clean_plain(data) if data else ""
        if not action:
            errors.append(f"Step {number} has no action.")
            continue
        if require_expected and not expected_clean:
            errors.append(f"Step {number} has no expected result.")
            continue
        if len(action) > STEP_TEXT_MAX or len(expected_clean) > STEP_TEXT_MAX:
            errors.append(f"Step {number} is longer than {STEP_TEXT_MAX} characters.")
            continue
        if len(data_clean) > STEP_DATA_MAX:
            errors.append(f"Step {number}'s test data is longer than {STEP_DATA_MAX} characters.")
            continue
        steps.append(ParsedStep(action, data_clean or None, expected_clean or None))
    if len(steps) > MAX_STEPS:
        errors.append(f"At most {MAX_STEPS} steps are allowed.")
    return steps, errors


def _escape(part: str | None) -> str:
    return (part or "").replace("|", "\\|")


def format_steps(steps: list[tuple[str, str | None, str | None]]) -> str:
    """[(action, test data, expected)] -> the cell text `parse_steps` reads back."""
    return "\n".join(
        f"{index}. {_escape(action)} | {_escape(data)} | {_escape(expected)}"
        for index, (action, data, expected) in enumerate(steps, start=1)
    )
