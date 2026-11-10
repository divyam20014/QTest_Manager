"""Gap-closure pass (ADR-057): test-data repository -- synthetic
generation + masking (named missing in GAP-75's "zero test-data-
repository/masking/synthetic-data capability").

Deliberately minimal: no persisted "repository" of generated datasets, no
real PII-detection engine, no third-party data-generation dependency
(e.g. Faker) -- a self-contained, deterministic generator/masker that's
genuinely useful for seeding/sanitizing test environments without
inventing a sprawling data-management platform nobody asked for. Pure
functions, no tenant_id/DB access, so there is no tenant-isolation
concern of the usual kind -- callers only ever see what they themselves
sent in (generate) or what they themselves supplied (mask).
"""

import hashlib
import hmac
from datetime import date, timedelta

FieldType = str  # name | email | phone | address | ssn_like | date | number

_FIRST_NAMES = [
    "Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Avery", "Quinn",
    "Jamie", "Drew", "Reese", "Sawyer", "Rowan", "Skyler", "Hayden", "Emerson",
]
_LAST_NAMES = [
    "Nguyen", "Smith", "Garcia", "Patel", "Kim", "Johnson", "Brown", "Clark",
    "Davis", "Martinez", "Lopez", "Walker", "Young", "Allen", "Scott", "Hill",
]
_STREET_NAMES = [
    "Maple St", "Oak Ave", "Cedar Ln", "River Rd", "Elm St", "Birch Way",
    "Highland Dr", "Sunset Blvd", "Lakeview Ct", "Pine St",
]
_CITIES = ["Springfield", "Riverside", "Fairview", "Clinton", "Franklin", "Greenville"]
_STATES = ["CA", "TX", "NY", "FL", "IL", "OH", "PA", "GA"]


def _index(seed: int, modulus: int) -> int:
    return seed % modulus


def _synthetic_name(seed: int) -> str:
    first = _FIRST_NAMES[_index(seed, len(_FIRST_NAMES))]
    last = _LAST_NAMES[_index(seed * 7, len(_LAST_NAMES))]
    return f"{first} {last}"


def _synthetic_email(seed: int) -> str:
    name = _synthetic_name(seed).lower().replace(" ", ".")
    return f"{name}.test{seed}@example-test.invalid"


def _synthetic_phone(seed: int) -> str:
    # 555 exchange is reserved for fictional use (North American Numbering
    # Plan) -- never a real, dialable number.
    area = 200 + (seed % 700)
    line = 1000 + (seed % 9000)
    return f"({area}) 555-{line:04d}"


def _synthetic_address(seed: int) -> str:
    number = 100 + (seed % 9800)
    street = _STREET_NAMES[_index(seed * 3, len(_STREET_NAMES))]
    city = _CITIES[_index(seed * 5, len(_CITIES))]
    state = _STATES[_index(seed * 11, len(_STATES))]
    zipcode = 10000 + (seed * 37) % 89999
    return f"{number} {street}, {city}, {state} {zipcode:05d}"


def _synthetic_ssn_like(seed: int) -> str:
    # "900" is outside the SSA's ever-issued area-number ranges -- this can
    # never collide with a real, issued SSN, by construction, not by luck.
    group = 1 + (seed % 99)
    serial = 1 + (seed % 9999)
    return f"900-{group:02d}-{serial:04d}"


def _synthetic_date(seed: int) -> str:
    base = date(2020, 1, 1)
    return (base + timedelta(days=seed % 2000)).isoformat()


def _synthetic_number(seed: int) -> str:
    return str((seed * 2654435761) % 1_000_000)


_GENERATORS = {
    "name": _synthetic_name,
    "email": _synthetic_email,
    "phone": _synthetic_phone,
    "address": _synthetic_address,
    "ssn_like": _synthetic_ssn_like,
    "date": _synthetic_date,
    "number": _synthetic_number,
}

SUPPORTED_FIELD_TYPES = sorted(_GENERATORS)


def generate_synthetic_rows(
    fields: list[tuple[str, FieldType]], count: int
) -> list[dict[str, str]]:
    """`fields` is (field_name, field_type) pairs. Deterministic given the
    same count -- row N always gets the same values across calls, which is
    convenient for reproducible test fixtures (not a security property)."""
    unknown = sorted({ftype for _, ftype in fields if ftype not in _GENERATORS})
    if unknown:
        raise ValueError(f"Unsupported field type(s): {', '.join(unknown)}")

    rows: list[dict[str, str]] = []
    for i in range(count):
        row = {name: _GENERATORS[ftype](i + 1) for name, ftype in fields}
        rows.append(row)
    return rows


def mask_values(values: list[str], salt: str) -> list[str]:
    """Deterministic, salted masking: the same (value, salt) pair always
    produces the same masked output, so referential consistency across a
    dataset is preserved (e.g. the same real customer id masks to the same
    token everywhere it appears in a file) -- but the mapping can't be
    inverted without the salt, and isn't persisted anywhere. Not
    cryptographically reversible-by-design encryption; a masking token,
    not a vault."""
    masked: list[str] = []
    for value in values:
        digest = hmac.new(salt.encode("utf-8"), value.encode("utf-8"), hashlib.sha256).hexdigest()
        masked.append(f"masked_{digest[:16]}")
    return masked
