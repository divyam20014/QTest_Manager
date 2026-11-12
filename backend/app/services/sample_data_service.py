"""Pass 2 / ADR-064: lightweight sample-project auto-seed for self-serve
signup (item 2 of the onboarding/billing pass).

Deliberately much smaller than `scripts/seed_demo_tenant.py` (Pass 1) --
a signup request shouldn't hang on seeding a full test run with execution
history. One sample project, three sample test cases, clearly labeled as
example content a new admin can delete, created same-request so a brand
new tenant never lands in a completely empty app.
"""

from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.db import set_tenant_context
from app.schemas.project import ProjectCreateRequest
from app.schemas.test_case import StepIn, TestCaseCreateRequest
from app.services import project_service, test_case_service

SAMPLE_PROJECT_NAME = "Sample Project — Getting Started"

_SAMPLE_CASES = [
    (
        "Example: logging in works",
        "Medium",
        [
            StepIn(action="Go to the login page", expected="The login form is displayed"),
            StepIn(
                action="Enter valid credentials and submit",
                expected="You land on the Dashboard",
            ),
        ],
    ),
    (
        "Example: creating a test case",
        "Medium",
        [
            StepIn(
                action="From a project, click 'New Test Case'",
                expected="The test case form opens",
            ),
            StepIn(
                action="Fill in the required fields and save",
                expected="The new test case appears in the repository as a draft",
            ),
        ],
    ),
    (
        "Example: reporting a defect",
        "Low",
        [
            StepIn(
                action="Open a test run and fail a step",
                expected="A defect quick-create dialog opens, pre-filled with context",
            ),
        ],
    ),
]


def seed_sample_project(db: Session, tenant_id: UUID, admin_user_id: UUID) -> None:
    """Idempotent in spirit (only ever called once, at signup) but not
    specifically guarded against re-invocation -- a brand-new tenant has
    no project named SAMPLE_PROJECT_NAME yet by construction."""
    set_tenant_context(db, str(tenant_id))
    project = project_service.create_project(
        db,
        tenant_id,
        admin_user_id,
        ProjectCreateRequest(
            name=SAMPLE_PROJECT_NAME,
            domain="Property",
            priority="Low",
            manager_name="You",
            manager_user_id=admin_user_id,
            start_date=date.today(),
            end_date=date.today() + timedelta(days=90),
            budget=Decimal(0),
            region="Not specified",
        ),
    )

    for title, priority, steps in _SAMPLE_CASES:
        set_tenant_context(db, str(tenant_id))
        test_case_service.create_test_case(
            db,
            tenant_id,
            "admin",
            admin_user_id,
            project.id,
            TestCaseCreateRequest(
                title=title,
                description="Sample content -- delete this test case whenever you're ready.",
                priority=priority,
                steps=steps,
            ),
        )
