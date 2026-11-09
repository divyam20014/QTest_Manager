"""Phase 9: targeted unit tests for findings from the manual security
review (docs/KNOWN_GAPS.md GAP-16 through GAP-19)."""

from app.core.security import hash_password, verify_password


def test_verify_password_fails_closed_on_malformed_hash() -> None:
    """GAP-18: a corrupted/malformed stored hash must return False, not
    raise an uncaught argon2 exception past the auth layer."""
    assert verify_password("anything", "not-a-real-argon2-hash") is False
    assert verify_password("anything", "") is False


def test_verify_password_still_works_normally() -> None:
    hashed = hash_password("CorrectHorseBattery1")
    assert verify_password("CorrectHorseBattery1", hashed) is True
    assert verify_password("WrongPassword1", hashed) is False
