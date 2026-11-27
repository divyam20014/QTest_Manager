"""ADR-136: refuse a save made from an out-of-date copy of a record.

The record is locked while it is changed, so two requests cannot both pass the check.
`row_version` moves once per saved change. A client that sends `expected_version` is
refused when the record has moved on; a client that sends none is not checked.
"""

from typing import TYPE_CHECKING

from app.core.errors import StaleWriteError

if TYPE_CHECKING:
    from app.models.defect import Defect
    from app.models.test_case import TestCase

    # The records that carry a `row_version`.
    Versioned = TestCase | Defect


def check_row_version(record: "Versioned", expected: int | None, noun: str) -> None:
    if expected is not None and expected != record.row_version:
        raise StaleWriteError(
            f"This {noun} was changed by someone else after you opened it, so nothing was "
            "saved. Look at the latest version, then try again."
        )


def bump_row_version(record: "Versioned") -> None:
    record.row_version += 1
