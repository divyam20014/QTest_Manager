"""The guard on every API route, recorded in `route_permissions.txt`.

A new route, or a changed or removed guard, fails here until the file is updated, so
the change is seen in review. The file records what each route checks today. It is
not by itself a statement that the check is the right one, and checks made inside
services (project access, ownership) are not shown.

After an intended change, regenerate it (from backend/):
    UPDATE_ROUTE_PERMISSIONS=1 python -m pytest tests/test_route_permissions.py
"""

import os
from pathlib import Path

from fastapi.routing import APIRoute

from app.main import app

RECORD = Path(__file__).with_name("route_permissions.txt")

# Dependencies that supply data and guard nothing.
_NOT_GUARDS = {"get_db", "get_identify_db", "defect_filters"}

# Routes with no guard dependency at all: anyone can call them. Each needs a reason.
PUBLIC_ROUTES = {
    "GET /api/v1/health": "liveness probe",
    "GET /api/v1/ready": "readiness probe",
    "POST /api/v1/public/leads": "marketing enquiry form (rate limited)",
    "POST /api/v1/auth/signup": "self-service signup",
    "POST /api/v1/auth/identify": "finds a user's organization before sign-in",
    "POST /api/v1/auth/login": "sign-in",
    "POST /api/v1/auth/mfa/verify": "second sign-in step; needs the pending session",
    "POST /api/v1/users/invite/{token}/accept": "the invitation token is the credential",
    "GET /api/v1/auth/sso/{tenant_id}/status": "whether to offer single sign-on",
    "GET /api/v1/auth/sso/{tenant_id}/login": "starts single sign-on",
    "GET /api/v1/auth/sso/{tenant_id}/callback": "return from the identity provider",
    "POST /api/v1/platform/auth/login": "platform administrator sign-in",
    "GET /api/v1/platform/auth/me": "checks the platform session inside the handler",
    "POST /api/v1/platform/auth/logout": "ends a platform session if there is one",
    "POST /api/v1/platform/auth/password/reset": "needs the emailed reset code",
}


def _describe(call) -> str | None:
    name = getattr(call, "__qualname__", type(call).__name__)
    if name in _NOT_GUARDS:
        return None
    values = {}
    if getattr(call, "__closure__", None):
        values = {
            free: cell.cell_contents
            for free, cell in zip(call.__code__.co_freevars, call.__closure__, strict=True)
        }
    name = name.removesuffix(".<locals>._checker")
    if name == "get_current_context":
        return "signed-in"
    for key in ("code", "codes", "rule_names", "scope"):
        if key in values:
            value = values[key]
            text = value if isinstance(value, str) else "|".join(sorted(value))
            resource = values.get("resource_type")
            return f"{name}({text}{', ' + resource if resource else ''})"
    return name


def _guards(dependant) -> set[str]:
    found: set[str] = set()
    for child in dependant.dependencies:
        description = _describe(child.call)
        if description:
            found.add(description)
        found |= _guards(child)
    return found


def _current() -> dict[str, str]:
    routes = {}
    for route in app.routes:
        # Only the application's own routes: other tests attach probe routes to `app`.
        if not isinstance(route, APIRoute) or not route.endpoint.__module__.startswith("app."):
            continue
        guards = _guards(route.dependant)
        # A permission check already implies a signed-in user.
        if len(guards) > 1:
            guards.discard("signed-in")
        for method in sorted(route.methods):
            routes[f"{method} {route.path}"] = ", ".join(sorted(guards)) or "none"
    return routes


def _render(routes: dict[str, str]) -> str:
    return "".join(f"{route}  ->  {guard}\n" for route, guard in sorted(routes.items()))


def test_every_route_has_the_recorded_guard() -> None:
    current = _render(_current())
    if os.environ.get("UPDATE_ROUTE_PERMISSIONS"):
        RECORD.write_text(current, encoding="utf-8", newline="\n")
    recorded = RECORD.read_text(encoding="utf-8").replace("\r\n", "\n")
    now, before = set(current.splitlines()), set(recorded.splitlines())
    assert now == before, (
        "Route guards differ from route_permissions.txt.\n"
        + "".join(f"  now:      {line}\n" for line in sorted(now - before))
        + "".join(f"  recorded: {line}\n" for line in sorted(before - now))
    )


def test_only_the_listed_routes_are_open_to_anyone() -> None:
    unguarded = {route for route, guard in _current().items() if guard == "none"}
    assert unguarded == set(PUBLIC_ROUTES)
