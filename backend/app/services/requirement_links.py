"""ADR-150: which test case links need to be reviewed after a requirement changed.

One definition, used by lists, the requirement page, coverage, the matrix and the test case page.
"""

from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import ColumnElement, and_, func, select
from sqlalchemy.orm import Session

from app.models.requirement import Requirement, RequirementTestCaseLink
from app.models.test_case import TestCase

# The wording the case was agreed to cover, or for an older link the wording when recording
# began, is no longer current. A retired requirement asks for no review.
NEEDS_REVIEW: ColumnElement[bool] = and_(
    Requirement.status != "retired",
    func.coalesce(
        RequirementTestCaseLink.requirement_version_id,
        RequirementTestCaseLink.unrecorded_baseline_version_id,
    )
    != Requirement.current_version_id,
)


def review_counts(db: Session, requirement_ids: Sequence[UUID]) -> dict[UUID, int]:
    """For each requirement, how many of its live linked test cases need review."""
    if not requirement_ids:
        return {}
    rows = db.execute(
        select(RequirementTestCaseLink.requirement_id, func.count(RequirementTestCaseLink.id))
        .join(Requirement, Requirement.id == RequirementTestCaseLink.requirement_id)
        .join(TestCase, TestCase.id == RequirementTestCaseLink.test_case_id)
        .where(RequirementTestCaseLink.requirement_id.in_(requirement_ids), NEEDS_REVIEW)
        .group_by(RequirementTestCaseLink.requirement_id)
    )
    return {requirement_id: count for requirement_id, count in rows}
