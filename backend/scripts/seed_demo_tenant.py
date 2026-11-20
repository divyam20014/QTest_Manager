"""Seeds a realistic demo tenant for showing off QTestHub.

Pass 1 (ops polish engagement): a prior dev session's live click-through
testing left genuinely junk data behind ("weeqe", "aasdasa" test case
titles, "asdadsad" defect) -- cleaned up separately by direct SQL, not by
this script. This script instead gives a fresh environment one
believable, fully-populated tenant to demo from immediately.

Idempotent: re-running it is safe. It looks up the tenant by name first;
if it already exists, every create step below is skipped individually
(matched by name/title), so running this twice never produces duplicates
and a partially-completed prior run can be resumed by re-running.

Usage:
    python -m scripts.seed_demo_tenant
"""

from datetime import date, timedelta

from sqlalchemy import select

from app.core.db import SessionLocal, set_tenant_context
from app.core.security import hash_password
from app.models.identity import Role, User
from app.models.tenant import Tenant
from app.schemas.defect import DefectCreateRequest
from app.schemas.execution import TestRunCreateRequest
from app.schemas.platform import TenantCreateRequest
from app.schemas.project import ProjectCreateRequest
from app.schemas.requirement import RequirementCreateRequest
from app.schemas.test_asset import (
    BuildCreateRequest,
    EnvironmentCreateRequest,
    ReleaseCreateRequest,
)
from app.schemas.test_case import StepIn, TestCaseCreateRequest
from app.services import (
    defect_service,
    execution_service,
    project_service,
    requirement_service,
    template_service,
    test_asset_service,
    test_case_service,
)
from app.services.platform_service import create_tenant_with_admin

TENANT_NAME = "Meridian Auto Insurance"
ADMIN_EMAIL = "admin@meridianauto.demo"
ADMIN_PASSWORD = "DemoAdmin!2026"
TESTER_EMAIL = "tester@meridianauto.demo"
TESTER_PASSWORD = "DemoTester!2026"

REQUIREMENTS = [
    (
        "Claims — First Notice of Loss intake",
        "The system must allow a policyholder or agent to submit a First "
        "Notice of Loss (FNOL) for an auto claim, capturing policy number, "
        "incident date/location, a description of the loss, and at least "
        "one photo or document.",
    ),
    (
        "Claims — adjudication workflow",
        "A claims adjuster must be able to review an FNOL, request "
        "additional documentation, assign a reserve amount, and move the "
        "claim through Open -> Under Review -> Approved/Denied -> Closed.",
    ),
    (
        "Underwriting — risk assessment on new policy",
        "When a new auto policy application is submitted, the system must "
        "compute a risk score from driver history, vehicle type, and "
        "coverage region before a rate can be quoted.",
    ),
    (
        "Policy Admin — mid-term endorsement",
        "A policyholder must be able to request a mid-term endorsement "
        "(e.g. adding a vehicle or driver) without canceling and "
        "re-issuing the policy, with the premium recalculated pro-rata.",
    ),
]

TEST_CASES = [
    # (module, title, priority, steps[(action, expected)], scenario_id, scenario_description)
    (
        "Claims",
        "FNOL submission with valid policy number is accepted",
        "High",
        [
            (
                "Log in as a policyholder and navigate to File a Claim",
                "The FNOL form loads with policy number pre-filled",
            ),
            (
                "Enter incident date, location, and a loss description, then submit",
                "A new claim is created with status 'Open' and a claim number is displayed",
            ),
        ],
        "SCN-CLM-001",
        "Happy-path FNOL intake for an active policy.",
    ),
    (
        "Claims",
        "FNOL submission is rejected for an expired policy",
        "High",
        [
            (
                "Submit an FNOL using a policy number that lapsed before the incident date",
                "The system rejects the submission with a clear 'policy not active on this date' message, and no claim record is created",
            ),
        ],
        "SCN-CLM-002",
        "Guards against claims being filed against lapsed coverage.",
    ),
    (
        "Claims",
        "Adjuster can move a claim from Open to Under Review",
        "Medium",
        [
            (
                "As a claims adjuster, open a claim with status 'Open'",
                "The claim detail page shows an 'Advance to Under Review' action",
            ),
            (
                "Click 'Advance to Under Review' and confirm",
                "Claim status updates to 'Under Review' and the change is recorded in the claim's history",
            ),
        ],
        "SCN-CLM-003",
        "Core adjudication status-transition flow.",
    ),
    (
        "Underwriting",
        "Risk score is computed for a standard new application",
        "High",
        [
            (
                "Submit a new auto policy application with a clean driving record, a mid-size sedan, and a suburban coverage region",
                "A risk score in the 'Standard' tier is returned, and a quote is generated",
            ),
        ],
        "SCN-UW-001",
        "Baseline risk-scoring path for a typical applicant.",
    ),
    (
        "Underwriting",
        "High-risk driver history triggers manual review",
        "High",
        [
            (
                "Submit a new application for a driver with two at-fault accidents in the past 3 years",
                "The application is routed to manual underwriting review instead of receiving an automatic quote",
            ),
        ],
        "SCN-UW-002",
        "Confirms the manual-review threshold is honored, not silently auto-approved.",
    ),
    (
        "Policy Admin",
        "Adding a second vehicle via endorsement recalculates premium",
        "Medium",
        [
            (
                "Open an active policy and start a 'Add Vehicle' endorsement",
                "The endorsement form requests the new vehicle's VIN, year, make, and model",
            ),
            (
                "Submit the endorsement with a valid VIN",
                "The policy now lists two vehicles and the premium is recalculated pro-rata for the remaining term",
            ),
        ],
        "SCN-PA-001",
        "Mid-term policy change without a full re-issue.",
    ),
]

DEFECTS = [
    (
        "FNOL form allows future-dated incident date",
        "Critical",
        "Submitting an FNOL with an incident date set several days in the future is accepted instead of rejected.",
        "1. Open the FNOL form.\n2. Set Incident Date to a date after today.\n3. Submit.",
        "The form should reject a future incident date with a validation error.",
        "The claim is created successfully with the future date accepted.",
    ),
    (
        "Risk score not recalculated after driver history update",
        "High",
        "Updating a driver's history mid-application does not trigger a re-computation of the risk score shown on the quote screen.",
        "1. Start a new application and reach the quote screen.\n2. Go back and add an at-fault accident to the driver's history.\n3. Return to the quote screen.",
        "The quote screen should show an updated risk score and premium reflecting the new driver history.",
        "The quote screen still shows the original, now-stale risk score.",
    ),
]


def _get_or_create_role_id(db, tenant_id, code):
    return db.execute(
        select(Role.id).where(Role.tenant_id.is_(None), Role.code == code)
    ).scalar_one()


def main() -> None:
    with SessionLocal() as db:
        existing = db.execute(select(Tenant).where(Tenant.name == TENANT_NAME)).scalar_one_or_none()
        if existing is not None:
            tenant = existing
            print(
                f"Tenant '{TENANT_NAME}' already exists ({tenant.id}) -- resuming/skipping creates as needed."
            )
            set_tenant_context(db, str(tenant.id))
            admin = db.execute(
                select(User).where(User.tenant_id == tenant.id, User.email == ADMIN_EMAIL)
            ).scalar_one()
        else:
            tenant, admin = create_tenant_with_admin(
                db,
                TenantCreateRequest(
                    tenant_name=TENANT_NAME,
                    admin_name="Jordan Price",
                    admin_email=ADMIN_EMAIL,
                    admin_password=ADMIN_PASSWORD,
                ),
            )
            db.flush()
            print(f"Created tenant '{TENANT_NAME}' ({tenant.id}) with admin {ADMIN_EMAIL}")

        set_tenant_context(db, str(tenant.id))

        tester = db.execute(
            select(User).where(User.tenant_id == tenant.id, User.email == TESTER_EMAIL)
        ).scalar_one_or_none()
        if tester is None:
            tester_role_id = _get_or_create_role_id(db, tenant.id, "tester")
            tester = User(
                tenant_id=tenant.id,
                email=TESTER_EMAIL,
                name="Sam Rivera",
                role_id=tester_role_id,
                password_hash=hash_password(TESTER_PASSWORD),
            )
            db.add(tester)
            db.flush()
            db.flush()
            print(f"Created tester {TESTER_EMAIL}")

        set_tenant_context(db, str(tenant.id))
        project = (
            project_service.get_project_by_name(db, tenant.id, "Auto Insurance Claims Platform")
            if hasattr(project_service, "get_project_by_name")
            else None
        )
        if project is None:
            from app.models.project import Project

            project = db.execute(
                select(Project).where(
                    Project.tenant_id == tenant.id, Project.name == "Auto Insurance Claims Platform"
                )
            ).scalar_one_or_none()
        if project is None:
            project = project_service.create_project(
                db,
                tenant.id,
                admin.id,
                ProjectCreateRequest(
                    name="Auto Insurance Claims Platform",
                    domain="Motor",
                    priority="High",
                    manager_name="Jordan Price",
                    manager_user_id=admin.id,
                    start_date=date.today() - timedelta(days=120),
                    end_date=date.today() + timedelta(days=240),
                    budget=250000,
                    region="North America",
                ),
            )
            db.flush()
            print(f"Created project '{project.name}' ({project.id})")
        else:
            print(f"Project '{project.name}' already exists ({project.id})")

        set_tenant_context(db, str(tenant.id))
        req_titles_existing = (
            {
                r.title
                for r in db.execute(
                    select(requirement_service.Requirement).where(
                        requirement_service.Requirement.project_id == project.id
                    )
                ).scalars()
            }
            if hasattr(requirement_service, "Requirement")
            else set()
        )
        created_reqs = 0
        for title, description in REQUIREMENTS:
            if title in req_titles_existing:
                continue
            # Every create_* service function in this codebase commits
            # internally at the end of its own call (it's written assuming
            # one call = one request = one transaction). The RLS tenant
            # GUC is transaction-local (`set_config(..., true)`), so each
            # of those internal commits resets it -- re-assert it before
            # every single service call in a loop, not just once before
            # the loop, or only the first iteration ever sees it.
            set_tenant_context(db, str(tenant.id))
            requirement_service.create_requirement(
                db,
                tenant.id,
                "admin",
                admin.id,
                project.id,
                RequirementCreateRequest(title=title, description=description),
            )
            created_reqs += 1
        print(
            f"Requirements: {created_reqs} created, {len(REQUIREMENTS) - created_reqs} already present"
        )

        set_tenant_context(db, str(tenant.id))
        from app.models.test_case import TestCase, TestCaseVersion

        existing_titles = {
            v.title
            for v in db.execute(
                select(TestCaseVersion)
                .join(TestCase, TestCase.id == TestCaseVersion.test_case_id)
                .where(
                    TestCase.project_id == project.id,
                    TestCase.current_version_id == TestCaseVersion.id,
                )
            ).scalars()
        }

        created_cases = []
        for module_name, title, priority, steps, scenario_id, scenario_description in TEST_CASES:
            if title in existing_titles:
                continue
            set_tenant_context(db, str(tenant.id))
            module = template_service._get_or_create_module(  # noqa: SLF001 -- reusing the exact helper the template-import path itself uses
                db, tenant.id, "admin", admin.id, project.id, module_name
            )
            set_tenant_context(db, str(tenant.id))
            case = test_case_service.create_test_case(
                db,
                tenant.id,
                "admin",
                admin.id,
                project.id,
                TestCaseCreateRequest(
                    title=title,
                    module_id=module.id if module else None,
                    description=f"Verifies: {title.lower()}.",
                    priority=priority,
                    steps=[StepIn(action=a, expected=e) for a, e in steps],
                    scenario_id=scenario_id,
                    scenario_description=scenario_description,
                ),
            )
            set_tenant_context(db, str(tenant.id))
            test_case_service.submit_for_review(db, tenant.id, "admin", admin.id, case.id)
            set_tenant_context(db, str(tenant.id))
            test_case_service.approve_test_case(db, tenant.id, "admin", admin.id, case.id)
            created_cases.append(case)
        print(f"Test cases: {len(created_cases)} created, {len(existing_titles)} already present")

        set_tenant_context(db, str(tenant.id))
        env_exists = db.execute(
            select(test_asset_service.Environment).where(
                test_asset_service.Environment.tenant_id == tenant.id,
                test_asset_service.Environment.name.ilike("Staging"),
            )
        ).scalar_one_or_none()
        if not env_exists:
            test_asset_service.create_environment(
                db,
                tenant.id,
                admin.id,
                EnvironmentCreateRequest(
                    name="Staging", description="Pre-production staging environment"
                ),
            )
            print("Created Environment 'Staging'")

        set_tenant_context(db, str(tenant.id))
        build_exists = db.execute(
            select(test_asset_service.Build).where(
                test_asset_service.Build.project_id == project.id,
                test_asset_service.Build.name == "2026.11.1",
            )
        ).scalar_one_or_none()
        if not build_exists:
            test_asset_service.create_build(
                db,
                tenant.id,
                admin.id,
                project.id,
                BuildCreateRequest(name="2026.11.1", built_at=date.today() - timedelta(days=3)),
            )
            print("Created Build '2026.11.1'")

        set_tenant_context(db, str(tenant.id))
        release_exists = db.execute(
            select(test_asset_service.Release).where(
                test_asset_service.Release.project_id == project.id,
                test_asset_service.Release.name == "Q4 2026 Release",
            )
        ).scalar_one_or_none()
        if not release_exists:
            test_asset_service.create_release(
                db,
                tenant.id,
                admin.id,
                project.id,
                ReleaseCreateRequest(
                    name="Q4 2026 Release", release_date=date.today() + timedelta(days=14)
                ),
            )
            print("Created Release 'Q4 2026 Release'")

        # Import a couple of real Insurance QA Pack templates to show that
        # feature off, in addition to the hand-written cases above.
        set_tenant_context(db, str(tenant.id))
        all_templates = template_service.list_templates()
        underwriting_templates = [t.id for t in all_templates if t.category == "Underwriting"][:2]
        if underwriting_templates:
            already_imported = (
                db.execute(
                    select(TestCaseVersion.title)
                    .join(TestCase, TestCase.id == TestCaseVersion.test_case_id)
                    .where(TestCase.project_id == project.id)
                )
                .scalars()
                .all()
            )
            template_titles = {t.title for t in all_templates if t.id in underwriting_templates}
            if not template_titles.issubset(set(already_imported)):
                template_service.import_templates(
                    db, tenant.id, "admin", admin.id, project.id, underwriting_templates
                )
                db.flush()
                print(f"Imported {len(underwriting_templates)} Insurance QA Pack templates")
            else:
                print("Insurance QA Pack templates already imported")

        # A run with real execution history, built from whichever approved
        # cases exist for this project now (created-this-run or pre-existing).
        set_tenant_context(db, str(tenant.id))
        from app.models.execution import TestRun

        existing_run = db.execute(
            select(TestRun).where(
                TestRun.project_id == project.id, TestRun.name == "Sprint 42 Regression"
            )
        ).scalar_one_or_none()
        if existing_run is None:
            approved_case_ids = [
                row[0]
                for row in db.execute(
                    select(TestCase.id).where(
                        TestCase.project_id == project.id, TestCase.status == "approved"
                    )
                ).all()
            ][:5]
            if approved_case_ids:
                run = execution_service.create_test_run(
                    db,
                    tenant.id,
                    "admin",
                    admin.id,
                    project.id,
                    TestRunCreateRequest(
                        name="Sprint 42 Regression",
                        run_type="Regression",
                        test_case_ids=approved_case_ids,
                    ),
                )
                set_tenant_context(db, str(tenant.id))

                run_cases = (
                    db.execute(
                        select(execution_service.TestRunCase).where(
                            execution_service.TestRunCase.test_run_id == run.id
                        )
                    )
                    .scalars()
                    .all()
                )
                verdict_pattern = ["pass", "pass", "fail", "pass"]
                for i, run_case in enumerate(run_cases):
                    set_tenant_context(db, str(tenant.id))
                    steps = (
                        db.execute(
                            select(execution_service.ExecutionStep).where(
                                execution_service.ExecutionStep.test_run_case_id == run_case.id
                            )
                        )
                        .scalars()
                        .all()
                    )
                    for step in steps:
                        set_tenant_context(db, str(tenant.id))
                        execution_service.open_step(db, tenant.id, "admin", admin.id, step.id)
                        verdict = verdict_pattern[i % len(verdict_pattern)]
                        set_tenant_context(db, str(tenant.id))
                        execution_service.record_verdict(
                            db, tenant.id, "admin", admin.id, step.id, verdict
                        )
                print(
                    f"Created test run 'Sprint 42 Regression' with real execution history ({len(run_cases)} cases)"
                )
            else:
                print(
                    "No approved test cases available yet to build a run from -- skipped run creation"
                )
        else:
            print("Test run 'Sprint 42 Regression' already exists")

        # Realistic defects.
        set_tenant_context(db, str(tenant.id))
        from app.models.defect import Defect

        existing_defect_titles = {
            d[0]
            for d in db.execute(select(Defect.title).where(Defect.project_id == project.id)).all()
        }
        created_defects = 0
        for title, severity, description, steps_to_reproduce, expected, actual in DEFECTS:
            if title in existing_defect_titles:
                continue
            set_tenant_context(db, str(tenant.id))
            defect_service.create_defect(
                db,
                tenant.id,
                "admin",
                admin.id,
                DefectCreateRequest(
                    project_id=project.id,
                    title=title,
                    severity=severity,
                    priority="High",
                    description=description,
                    steps_to_reproduce=steps_to_reproduce,
                    expected_result=expected,
                    actual_result=actual,
                ),
            )
            created_defects += 1
        if created_defects:
            db.flush()
        print(f"Defects: {created_defects} created, {len(existing_defect_titles)} already present")

        # One commit at the very end, not after every step -- this
        # project's recurring bug class is the RLS tenant-context GUC
        # resetting on every COMMIT (it's set via `set_config(..., true)`,
        # transaction-local by design). Committing mid-script and then
        # relying on a fresh `set_tenant_context` call for the *next*
        # statement works for a single simple read, but this script chains
        # many service calls together and re-triggered the exact same bug
        # class other services in this codebase have hit before. Flushing
        # (not committing) between steps keeps everything in one
        # transaction, so the GUC never resets until this final commit.
        db.commit()
        _enrich(db, tenant, admin)
        db.commit()
        print("\nDemo tenant ready.")
        print(f"  Tenant ID: {tenant.id}")
        print(f"  Admin login: {ADMIN_EMAIL} / {ADMIN_PASSWORD}")
        print(f"  Tester login: {TESTER_EMAIL} / {TESTER_PASSWORD}")


def _ctx(db, tenant):
    set_tenant_context(db, str(tenant.id))


def _sentence_case(title: str) -> str:
    """Lower-cases the first letter for mid-sentence use, but leaves acronyms (NCD, FNOL, API) alone."""
    if len(title) > 1 and title[1].isupper():
        return title
    return title[0].lower() + title[1:]


def _ensure_team(db, tenant):
    """Fictional QA team so activity, assignments and authorship look like a real org."""
    from scripts.demo_dataset import TEAM, TEAM_PASSWORD

    team = {}
    for name, email, role_code in TEAM:
        _ctx(db, tenant)
        user = db.execute(
            select(User).where(User.tenant_id == tenant.id, User.email == email)
        ).scalar_one_or_none()
        if user is None:
            user = User(
                tenant_id=tenant.id,
                email=email,
                name=name,
                role_id=_get_or_create_role_id(db, tenant.id, role_code),
                password_hash=hash_password(TEAM_PASSWORD),
            )
            db.add(user)
            db.flush()
            print(f"Created team member {name} ({role_code})")
        team[email] = (user, role_code)
    return team


def _ensure_member(db, tenant, project, user):
    from app.models.project import ProjectMember

    _ctx(db, tenant)
    exists = db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id, ProjectMember.user_id == user.id
        )
    ).first()
    if exists is None:
        db.add(ProjectMember(project_id=project.id, user_id=user.id))
        db.flush()


def _backdate(db, model, row_id, **values):
    from sqlalchemy import update

    db.execute(update(model).where(model.id == row_id).values(**values))


def _enrich(db, tenant, admin):
    """Idempotent: every object is matched by name/title before creation, and
    timestamps are only backdated on rows created in this pass."""
    import hashlib
    from datetime import UTC, datetime

    from app.models.defect import Defect
    from app.models.execution import ExecutionStep, TestRun, TestRunCase
    from app.models.project import Project
    from app.models.requirement import Requirement
    from app.models.test_case import TestCase, TestCaseVersion
    from scripts.demo_dataset import PROJECTS, RUNS, TEAM

    def stable(*parts) -> int:
        return int(hashlib.sha256("|".join(map(str, parts)).encode()).hexdigest()[:8], 16)

    now = datetime.now(UTC)
    team = _ensure_team(db, tenant)
    managers = [team[e][0] for _, e, r in TEAM if r == "manager"]
    testers = [team[e][0] for _, e, r in TEAM if r == "tester"]
    sam = db.execute(
        select(User).where(User.tenant_id == tenant.id, User.email == TESTER_EMAIL)
    ).scalar_one_or_none()
    if sam is not None:
        testers.append(sam)

    for p_index, spec in enumerate(PROJECTS):
        _ctx(db, tenant)
        project = db.execute(
            select(Project).where(Project.tenant_id == tenant.id, Project.name == spec["name"])
        ).scalar_one_or_none()
        if project is None:
            manager = managers[p_index % len(managers)]
            project = project_service.create_project(
                db,
                tenant.id,
                admin.id,
                ProjectCreateRequest(
                    name=spec["name"],
                    domain="Motor",
                    priority=spec["priority"],
                    status=spec["status"],
                    manager_name=manager.name,
                    manager_user_id=manager.id,
                    start_date=date.today() - timedelta(days=90 + 15 * p_index),
                    end_date=date.today() + timedelta(days=120 + 30 * p_index),
                    budget=spec["budget"],
                    region=spec["region"],
                ),
            )
            db.flush()
            print(f"Created project '{project.name}'")
        for user in managers + testers:
            _ensure_member(db, tenant, project, user)

        _ctx(db, tenant)
        release_name = spec["release"]
        if not db.execute(
            select(test_asset_service.Release).where(
                test_asset_service.Release.project_id == project.id,
                test_asset_service.Release.name == release_name,
            )
        ).scalar_one_or_none():
            _ctx(db, tenant)
            test_asset_service.create_release(
                db,
                tenant.id,
                admin.id,
                project.id,
                ReleaseCreateRequest(
                    name=release_name, release_date=date.today() + timedelta(days=10 + 7 * p_index)
                ),
            )

        # -- test cases -------------------------------------------------
        _ctx(db, tenant)
        existing = {
            v.title: v.test_case_id
            for v in db.execute(
                select(TestCaseVersion)
                .join(TestCase, TestCase.id == TestCaseVersion.test_case_id)
                .where(
                    TestCase.project_id == project.id,
                    TestCase.current_version_id == TestCaseVersion.id,
                )
            ).scalars()
        }
        cases_by_module: dict[str, list] = {}
        created = 0
        for m_index, (module_name, (persona, cases)) in enumerate(spec["modules"].items()):
            _ctx(db, tenant)
            module = template_service._get_or_create_module(  # noqa: SLF001
                db, tenant.id, "admin", admin.id, project.id, module_name
            )
            for c_index, (title, priority, expected) in enumerate(cases):
                if title in existing:
                    cases_by_module.setdefault(module_name, []).append(existing[title])
                    continue
                author = managers[(m_index + c_index) % len(managers)]
                reviewer = managers[(m_index + c_index + 1) % len(managers)]
                _ctx(db, tenant)
                case = test_case_service.create_test_case(
                    db,
                    tenant.id,
                    "manager",
                    author.id,
                    project.id,
                    TestCaseCreateRequest(
                        title=title,
                        module_id=module.id if module else None,
                        description=f"Verifies that {_sentence_case(title)}.",
                        priority=priority,
                        assignee_id=testers[(m_index * 3 + c_index) % len(testers)].id,
                        steps=[
                            StepIn(
                                action=f"Sign in as a {persona} and open the {module_name} area",
                                expected=f"The {module_name} screen loads without errors",
                            ),
                            StepIn(
                                action="Set up the scenario data described in the preconditions",
                                expected="Scenario data is available and valid",
                            ),
                            StepIn(
                                action=f"Perform the action under test: {_sentence_case(title)}",
                                expected=expected,
                            ),
                        ],
                        scenario_id=f"SCN-{p_index + 1:02d}{m_index + 1}-{c_index + 1:03d}",
                        prerequisite=f"An active {persona} account with access to {module_name}",
                    ),
                )
                # Last case per module stays a draft, second-to-last in review, rest approved.
                if c_index < len(cases) - 2 or (c_index == len(cases) - 2 and m_index % 2 == 0):
                    _ctx(db, tenant)
                    test_case_service.submit_for_review(
                        db, tenant.id, "manager", author.id, case.id, reviewer_id=reviewer.id
                    )
                    if c_index < len(cases) - 2:
                        _ctx(db, tenant)
                        test_case_service.approve_test_case(
                            db, tenant.id, "manager", reviewer.id, case.id
                        )
                _ctx(db, tenant)
                _backdate(
                    db,
                    TestCase,
                    case.id,
                    created_at=now - timedelta(days=60 - (m_index * 8 + c_index), hours=c_index),
                )
                cases_by_module.setdefault(module_name, []).append(case.id)
                created += 1
        print(f"  {project.name}: {created} test cases created")

        # -- requirements + traceability -------------------------------
        _ctx(db, tenant)
        existing_reqs = {
            r.title
            for r in db.execute(
                select(Requirement).where(Requirement.project_id == project.id)
            ).scalars()
        }
        for r_index, (module_name, title, description) in enumerate(spec["requirements"]):
            if title in existing_reqs:
                continue
            author = managers[r_index % len(managers)]
            _ctx(db, tenant)
            req = requirement_service.create_requirement(
                db,
                tenant.id,
                "manager",
                author.id,
                project.id,
                RequirementCreateRequest(title=title, description=description),
            )
            _ctx(db, tenant)
            _backdate(db, Requirement, req.id, created_at=now - timedelta(days=75 - r_index * 3))
            # Leave the last requirement of each project unlinked: a real coverage gap.
            if r_index == len(spec["requirements"]) - 1:
                continue
            module_cases = cases_by_module.get(module_name, [])
            start = stable(title) % max(1, len(module_cases))
            for k in range(min(len(module_cases), 2 + stable(title, "n") % 3)):
                _ctx(db, tenant)
                try:
                    requirement_service.link_test_case(
                        db,
                        tenant.id,
                        "manager",
                        author.id,
                        req.id,
                        module_cases[(start + k) % len(module_cases)],
                    )
                except Exception:  # noqa: BLE001 -- already linked on a resumed run
                    db.rollback()

        # -- test runs with dated execution history ---------------------
        _ctx(db, tenant)
        approved = [
            row[0]
            for row in db.execute(
                select(TestCase.id)
                .where(TestCase.project_id == project.id, TestCase.status == "approved")
                .order_by(TestCase.created_at)
            ).all()
        ]
        if not approved:
            continue
        for r_index, (run_name, run_type, days_ago, pass_rate, finished) in enumerate(RUNS):
            _ctx(db, tenant)
            if db.execute(
                select(TestRun).where(TestRun.project_id == project.id, TestRun.name == run_name)
            ).scalar_one_or_none():
                continue
            size = (
                10
                if run_type == "Smoke"
                else min(len(approved), 14 + (stable(project.name, run_name) % 6))
            )
            offset = stable(project.name, run_name, "o") % len(approved)
            case_ids = list(
                dict.fromkeys(approved[(offset + i) % len(approved)] for i in range(size))
            )
            owner = managers[r_index % len(managers)]
            _ctx(db, tenant)
            run = execution_service.create_test_run(
                db,
                tenant.id,
                "manager",
                owner.id,
                project.id,
                TestRunCreateRequest(name=run_name, run_type=run_type, test_case_ids=case_ids),
            )
            run_day = now - timedelta(days=days_ago)
            _ctx(db, tenant)
            _backdate(db, TestRun, run.id, created_at=run_day - timedelta(hours=2))
            _ctx(db, tenant)
            run_cases = (
                db.execute(select(TestRunCase).where(TestRunCase.test_run_id == run.id))
                .scalars()
                .all()
            )
            for rc_index, run_case in enumerate(run_cases):
                executor = testers[(rc_index + r_index) % len(testers)]
                _ctx(db, tenant)
                run_case.assigned_to = executor.id
                db.flush()
                db.commit()
                # The in-progress run leaves its tail unexecuted.
                if not finished and rc_index >= int(len(run_cases) * 0.6):
                    continue
                fails = (stable(run.id, rc_index) % 1000) / 1000 >= pass_rate
                _ctx(db, tenant)
                steps = (
                    db.execute(
                        select(ExecutionStep)
                        .where(ExecutionStep.test_run_case_id == run_case.id)
                        .order_by(ExecutionStep.id)
                    )
                    .scalars()
                    .all()
                )
                # Real runs are executed over a few days, not in one sitting.
                span = min(3, days_ago + 1)
                exec_start = min(
                    run_day + timedelta(days=rc_index % span, minutes=12 * (rc_index // span)),
                    now - timedelta(minutes=30),
                )
                for s_index, step in enumerate(steps):
                    verdict = "fail" if fails and s_index == len(steps) - 1 else "pass"
                    _ctx(db, tenant)
                    execution_service.record_verdict(
                        db, tenant.id, "tester", executor.id, step.id, verdict
                    )
                    _ctx(db, tenant)
                    _backdate(
                        db,
                        ExecutionStep,
                        step.id,
                        opened_at=exec_start + timedelta(minutes=3 * s_index),
                        closed_at=exec_start + timedelta(minutes=3 * s_index + 2),
                    )
                _ctx(db, tenant)
                _backdate(
                    db,
                    TestRunCase,
                    run_case.id,
                    started_at=exec_start,
                    completed_at=exec_start + timedelta(minutes=3 * len(steps)),
                )
                db.commit()
            if finished:
                _ctx(db, tenant)
                execution_service.finish_test_run(db, tenant.id, owner.id, run.id)
                _ctx(db, tenant)
                _backdate(db, TestRun, run.id, finished_at=run_day + timedelta(days=2, hours=8))
                db.commit()
            print(f"  {project.name}: run '{run_name}' executed")

        # -- defects across the lifecycle -------------------------------
        _ctx(db, tenant)
        existing_defects = {
            d[0]
            for d in db.execute(select(Defect.title).where(Defect.project_id == project.id)).all()
        }
        flow = ["Open", "Fixed", "Verified", "Closed"]
        for d_index, (title, severity, target_status) in enumerate(spec["defects"]):
            if title in existing_defects:
                continue
            reporter = testers[d_index % len(testers)]
            fixer = managers[d_index % len(managers)]
            linked_case = approved[stable(title) % len(approved)]
            _ctx(db, tenant)
            defect = defect_service.create_defect(
                db,
                tenant.id,
                "tester",
                reporter.id,
                DefectCreateRequest(
                    project_id=project.id,
                    test_case_id=linked_case,
                    title=title,
                    severity=severity,
                    priority="Critical"
                    if severity == "Critical"
                    else ("High" if severity == "High" else "Medium"),
                    description=f"Observed during regression testing: {_sentence_case(title)}.",
                    steps_to_reproduce="1. Prepare the scenario data.\n2. Perform the action described in the linked test case.\n3. Observe the result.",
                    expected_result="Behaviour matches the linked requirement and test case.",
                    actual_result=title + ".",
                    environment="Staging",
                ),
            )
            if target_status != "New":
                for status in flow[: flow.index(target_status) + 1]:
                    _ctx(db, tenant)
                    defect_service.update_status(
                        db,
                        tenant.id,
                        "manager",
                        fixer.id,
                        defect.id,
                        status,
                        verification_confirmed=True,
                    )
            opened = now - timedelta(days=3 + (stable(title) % 26), hours=stable(title, "h") % 9)
            _ctx(db, tenant)
            values = {"created_at": opened}
            if target_status == "Closed":
                values["closed_at"] = min(
                    now - timedelta(hours=6), opened + timedelta(days=2 + stable(title, "c") % 6)
                )
            _backdate(db, Defect, defect.id, **values)
            db.commit()
        print(f"  {project.name}: defects ready")


if __name__ == "__main__":
    main()
