"""ADR-089: the in-app Documentation viewer's document registry and reader.

The Markdown files live once, in the repo's docs/ folder. `scripts/sync_docs.py`
copies the registered ones into `app/docs_content/<slug>.md` so the api image
(whose build context is ./backend only) carries them; `--check` detects drift.
The API serves them behind a signed-in session; the front-end bundle no longer
contains any document text.
"""

from dataclasses import dataclass
from pathlib import Path

from app.core.errors import NotFoundError

CONTENT_DIR = Path(__file__).resolve().parent.parent / "docs_content"

# Permission that marks the "admin" audience. Same permission the web app's
# `isAdmin()` / the /settings route gate use, so the viewer and the rest of the
# admin UI agree on who is an Admin (custom roles included).
ADMIN_PERMISSION = "tenant.settings.manage"

EVERYONE = "everyone"
ADMIN = "admin"

GROUPS: list[dict[str, str]] = [
    {"id": "product", "title": "Product guides"},
    {"id": "administration", "title": "Administration and operations"},
    {"id": "engineering", "title": "Architecture and engineering"},
    {"id": "diagrams", "title": "Architecture diagrams"},
]


@dataclass(frozen=True)
class DocEntry:
    slug: str
    title: str
    description: str
    audience: str  # EVERYONE (any signed-in user) | ADMIN (needs ADMIN_PERMISSION)
    group: str
    source: str  # path relative to the repo's docs/ folder


def _d(slug: str, title: str, description: str, audience: str, group: str, source: str) -> DocEntry:
    return DocEntry(slug, title, description, audience, group, source)


# Classification rule: anything describing how the system is deployed, secured,
# configured or built internally (admin/ops guides, schema, API inventory, ADRs,
# known gaps, security configuration, runbooks) is ADMIN. User-facing and
# product documents, requirement traceability and the diagrams are EVERYONE.
REGISTRY: list[DocEntry] = [
    _d(
        "user-guide",
        "User Guide",
        "Day-to-day use of QTestHub for Testers, Managers and Admins.",
        EVERYONE,
        "product",
        "USER_GUIDE.md",
    ),
    _d(
        "product-vision",
        "Product Vision",
        "Where the product is going, and what is built versus planned.",
        EVERYONE,
        "product",
        "PRODUCT_VISION.md",
    ),
    _d(
        "master-spec",
        "Master Spec",
        "Condensed product specification for the insurance test management platform.",
        EVERYONE,
        "product",
        "MASTER_SPEC.md",
    ),
    _d(
        "data-residency",
        "Data Residency",
        "What data residency readiness covers today, and what it does not.",
        EVERYONE,
        "product",
        "DATA_RESIDENCY.md",
    ),
    _d(
        "requirement-traceability",
        "Requirement Traceability",
        "Each business requirement mapped to its code, tests and status.",
        EVERYONE,
        "product",
        "REQUIREMENT_TRACEABILITY.md",
    ),
    _d(
        "administrator-guide",
        "Administrator Guide",
        "Provisioning tenants, users, roles and settings.",
        ADMIN,
        "administration",
        "ADMINISTRATOR_GUIDE.md",
    ),
    _d(
        "production-deployment-guide",
        "Production Deployment Guide",
        "Deploying and operating QTestHub in production.",
        ADMIN,
        "administration",
        "PRODUCTION_DEPLOYMENT_GUIDE.md",
    ),
    _d(
        "security-configuration",
        "Security Configuration",
        "Security-relevant settings and how to harden them.",
        ADMIN,
        "administration",
        "deployment/SECURITY_CONFIGURATION.md",
    ),
    _d(
        "backup-and-restore",
        "Backup and Restore",
        "Backup and restore runbook.",
        ADMIN,
        "administration",
        "deployment/BACKUP_AND_RESTORE.md",
    ),
    _d(
        "known-gaps",
        "Known Gaps",
        "Open and resolved gaps against the requirements.",
        ADMIN,
        "administration",
        "KNOWN_GAPS.md",
    ),
    _d(
        "architecture",
        "Architecture",
        "Module boundaries and the request lifecycle.",
        ADMIN,
        "engineering",
        "ARCHITECTURE.md",
    ),
    _d(
        "architecture-decisions",
        "Architecture Decisions",
        "The numbered architecture decision records (ADRs).",
        ADMIN,
        "engineering",
        "ARCHITECTURE_DECISIONS.md",
    ),
    _d(
        "saas-architecture",
        "SaaS Architecture",
        "Recommended SaaS topology against what is implemented.",
        ADMIN,
        "engineering",
        "SAAS_ARCHITECTURE.md",
    ),
    _d(
        "database-schema",
        "Database Schema",
        "Tables, columns and tenant isolation.",
        ADMIN,
        "engineering",
        "DATABASE_SCHEMA.md",
    ),
    _d(
        "api-specification",
        "API Specification",
        "Endpoint inventory with the permission each one needs.",
        ADMIN,
        "engineering",
        "API_SPECIFICATION.md",
    ),
    _d(
        "test-strategy",
        "Test Strategy",
        "How the platform itself is tested.",
        ADMIN,
        "engineering",
        "TEST_STRATEGY.md",
    ),
    _d(
        "design-system",
        "Design System",
        "Tokens and shared components for the signed-in app.",
        ADMIN,
        "engineering",
        "DESIGN_SYSTEM.md",
    ),
    _d(
        "architecture-overview",
        "Architecture Overview",
        "High-level view of the system.",
        EVERYONE,
        "diagrams",
        "architecture/ARCHITECTURE_OVERVIEW.md",
    ),
    _d(
        "system-architecture",
        "System Architecture",
        "Components and how they connect.",
        EVERYONE,
        "diagrams",
        "architecture/SYSTEM_ARCHITECTURE.md",
    ),
    _d(
        "data-flow-diagrams",
        "Data Flow Diagrams",
        "How data moves through the platform.",
        EVERYONE,
        "diagrams",
        "architecture/DATA_FLOW_DIAGRAM.md",
    ),
    _d(
        "entity-relationship",
        "Entity Relationship Diagrams",
        "How the database tables relate.",
        EVERYONE,
        "diagrams",
        "architecture/ENTITY_RELATIONSHIP_DIAGRAM.md",
    ),
    _d(
        "process-flows",
        "Process Flow Diagrams",
        "Login, approval, permission and error-handling flows.",
        EVERYONE,
        "diagrams",
        "architecture/PROCESS_FLOW_DIAGRAMS.md",
    ),
    _d(
        "sequence-diagrams",
        "Sequence Diagrams",
        "Request-by-request order of the major workflows.",
        EVERYONE,
        "diagrams",
        "architecture/SEQUENCE_DIAGRAMS.md",
    ),
    _d(
        "use-cases",
        "Use Case Diagrams",
        "What each role can do.",
        EVERYONE,
        "diagrams",
        "architecture/USE_CASE_DIAGRAMS.md",
    ),
]

_BY_SLUG = {d.slug: d for d in REGISTRY}


def find(slug: str) -> DocEntry | None:
    return _BY_SLUG.get(slug)


def can_view(permissions: set[str] | list[str], doc: DocEntry) -> bool:
    return doc.audience == EVERYONE or ADMIN_PERMISSION in permissions


def list_for(permissions: set[str] | list[str]) -> list[DocEntry]:
    """The documents this caller may open (sensitive ones are not even listed)."""
    return [d for d in REGISTRY if can_view(permissions, d)]


def read_text(doc: DocEntry) -> str:
    # `doc` comes from the registry, never from user input, so the path is fixed.
    path = CONTENT_DIR / f"{doc.slug}.md"
    if not path.is_file():
        raise NotFoundError("Document not found")
    return path.read_text(encoding="utf-8")
