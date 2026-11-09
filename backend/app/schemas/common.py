import re
from typing import Annotated

from pydantic import AfterValidator

# GAP-10: BRD gives both "min 8" and "enterprise recommends 12"; the
# enterprise recommendation is enforced as policy for this regulated product.
_MIN_PASSWORD_LENGTH = 12
_COMPLEXITY_PATTERN = re.compile(r"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$")


def _validate_password(value: str) -> str:
    if len(value) < _MIN_PASSWORD_LENGTH:
        raise ValueError(f"Password must be at least {_MIN_PASSWORD_LENGTH} characters long")
    if not _COMPLEXITY_PATTERN.match(value):
        raise ValueError(
            "Password must include an uppercase letter, a lowercase letter, and a digit"
        )
    return value


StrongPassword = Annotated[str, AfterValidator(_validate_password)]
