"""ADR-070: soft-delete filtering for test runs and defects (ADR-115 adds test cases).

A single ``do_orm_execute`` hook adds ``deleted_at IS NULL`` to every ORM
SELECT that touches ``Defect`` or ``TestRun`` -- including joins, subqueries
and relationship loads -- so lists, counts, dashboards and reports exclude
deleted rows without touching each of the ~80 query sites. Opt out per
statement with ``.execution_options(include_deleted=True)`` (used by the
tenant data export and by the delete/restore paths).

Raw SQL (``text()``) is not covered; none of the code touches these two
tables that way (verified by grep when this was added).
"""

from sqlalchemy import event
from sqlalchemy.orm import Session, with_loader_criteria

from app.models.defect import Defect
from app.models.execution import TestRun
from app.models.task import Task
from app.models.test_case import TestCase


@event.listens_for(Session, "do_orm_execute")
def _exclude_soft_deleted(state) -> None:  # type: ignore[no-untyped-def]
    if not state.is_select or state.execution_options.get("include_deleted", False):
        return
    state.statement = state.statement.options(
        with_loader_criteria(Defect, Defect.deleted_at.is_(None), include_aliases=True),
        with_loader_criteria(TestRun, TestRun.deleted_at.is_(None), include_aliases=True),
        with_loader_criteria(TestCase, TestCase.deleted_at.is_(None), include_aliases=True),
        with_loader_criteria(Task, Task.deleted_at.is_(None), include_aliases=True),
    )
