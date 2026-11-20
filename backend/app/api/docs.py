from typing import Any

from fastapi import APIRouter, Depends, Path, Request, Response

from app.core.auth import SessionContext, get_current_context
from app.core.errors import ForbiddenError, NotFoundError
from app.core.rate_limit import limiter, scaled
from app.core.responses import envelope
from app.services import docs_service

router = APIRouter(prefix="/docs", tags=["docs"])

# ADR-089: document text is read-only and may be sensitive; never let a shared
# cache or the browser's disk cache keep it after sign-out.
NO_STORE = "private, no-store"


def _summary(doc: docs_service.DocEntry) -> dict[str, Any]:
    return {
        "slug": doc.slug,
        "title": doc.title,
        "description": doc.description,
        "group": doc.group,
        "audience": doc.audience,
        # The level a caller needs: "everyone" (any signed-in user) or "admin".
        "min_level": doc.audience,
        "source": doc.source,
    }


@router.get("")
@limiter.limit(scaled(60))
def list_documents(
    request: Request,
    response: Response,
    ctx: SessionContext = Depends(get_current_context),
) -> dict:
    """The documents this user may open, plus the display groups."""
    response.headers["Cache-Control"] = NO_STORE
    docs = docs_service.list_for(ctx.permissions)
    return envelope({"groups": docs_service.GROUPS, "documents": [_summary(d) for d in docs]})


@router.get("/{slug}")
@limiter.limit(scaled(120))
def get_document(
    request: Request,
    response: Response,
    slug: str = Path(pattern=r"^[a-z0-9][a-z0-9-]{0,63}$"),
    ctx: SessionContext = Depends(get_current_context),
) -> dict:
    """One document's Markdown. 404 for an unknown slug, 403 when the caller's
    role may not read it. The slug is matched against the registry only, never
    used to build a path from user input."""
    response.headers["Cache-Control"] = NO_STORE
    doc = docs_service.find(slug)
    if doc is None:
        raise NotFoundError("Document not found")
    if not docs_service.can_view(ctx.permissions, doc):
        raise ForbiddenError("You do not have access to this document")
    return envelope({**_summary(doc), "content": docs_service.read_text(doc)})
