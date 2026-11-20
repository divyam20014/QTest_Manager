"""Copy the registered documents from the repo's docs/ folder into
backend/app/docs_content/<slug>.md (ADR-089), so the api image -- whose Docker
build context is ./backend only -- carries them for GET /api/v1/docs.

Usage (from backend/ or via `npm run docs:sync` in frontend/):
    python -m scripts.sync_docs          # write missing/stale copies, prune orphans
    python -m scripts.sync_docs --check  # change nothing; exit 1 on drift
"""

import sys
from pathlib import Path

from app.services.docs_service import CONTENT_DIR, REGISTRY

DOCS_DIR = Path(__file__).resolve().parents[2] / "docs"


def _normalize(text: str) -> str:
    return text.replace("\r\n", "\n")


def main(argv: list[str]) -> int:
    check = "--check" in argv
    problems = 0
    CONTENT_DIR.mkdir(exist_ok=True)
    for doc in REGISTRY:
        source = DOCS_DIR / doc.source
        target = CONTENT_DIR / f"{doc.slug}.md"
        if not source.is_file():
            print(f"missing source: docs/{doc.source}")
            problems += 1
            continue
        wanted = _normalize(source.read_text(encoding="utf-8"))
        current = _normalize(target.read_text(encoding="utf-8")) if target.is_file() else None
        if current == wanted:
            continue
        if check:
            print(f"stale: {doc.slug}.md (run python -m scripts.sync_docs)")
            problems += 1
        else:
            target.write_text(wanted, encoding="utf-8", newline="\n")
            print(f"updated {doc.slug}.md")
    known = {f"{d.slug}.md" for d in REGISTRY}
    for extra in sorted(CONTENT_DIR.glob("*.md")):
        if extra.name in known:
            continue
        if check:
            print(f"orphan: {extra.name} is not in the registry")
            problems += 1
        else:
            extra.unlink()
            print(f"removed {extra.name}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
