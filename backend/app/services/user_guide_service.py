"""ADR-114: the tenant-facing User Guide, split into role-based sections.

The source is `docs/USER_GUIDE.md` (bundled as `app/docs_content/user-guide.md`).
Each level-2 heading is a section; the table below maps a heading to a stable
id and to the permission a caller needs to see it. A section the caller may not
open is never returned or listed. Permission codes match the ones the web app
uses for the matching screens (`isManagerOrAbove`, `isAdmin`).
"""

import re
from dataclasses import dataclass

from app.services import docs_service


@dataclass(frozen=True)
class GuideSection:
    id: str
    title: str
    heading: str  # the level-2 heading in USER_GUIDE.md
    permission: str | None  # None: every signed-in tenant user
    audience: str  # human label for the audience


SECTIONS: list[GuideSection] = [
    GuideSection("getting-started", "Getting started", "Getting started", None, "everyone"),
    GuideSection("tester", "For Testers", "For Testers", None, "everyone"),
    # Same permission the UI's isManagerOrAbove() uses for custom roles.
    GuideSection("manager", "For Managers", "For Managers", "project.view.all", "manager"),
    # Same permission as the /settings route gate and isAdmin().
    GuideSection("admin", "For Admins", "For Admins", docs_service.ADMIN_PERMISSION, "admin"),
]

_H2 = re.compile(r"^## (.+?)\s*$", re.MULTILINE)


def _split(markdown: str) -> dict[str, str]:
    """Level-2 heading text -> its body (the heading line itself is dropped)."""
    matches = list(_H2.finditer(markdown))
    out: dict[str, str] = {}
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(markdown)
        out[m.group(1)] = markdown[m.end() : end].strip() + "\n"
    return out


def can_view(permissions: set[str] | list[str], section: GuideSection) -> bool:
    return section.permission is None or section.permission in permissions


def sections_for(permissions: set[str] | list[str]) -> list[dict[str, str]]:
    doc = docs_service.find("user-guide")
    assert doc is not None
    bodies = _split(docs_service.read_text(doc))
    return [
        {
            "id": s.id,
            "title": s.title,
            "audience": s.audience,
            "markdown": bodies.get(s.heading, ""),
        }
        for s in SECTIONS
        if can_view(permissions, s) and s.heading in bodies
    ]
