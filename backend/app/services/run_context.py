"""ADR-152: the environment, build and release a test run is run against."""

from collections.abc import Sequence
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.errors import ValidationAppError
from app.models.execution import TestRun
from app.models.tenant import Tenant
from app.models.test_asset import Build, Environment, Release
from app.services import lookups


@dataclass(frozen=True)
class RunContext:
    environment_id: UUID | None
    build_id: UUID | None
    release_id: UUID | None


def required(db: Session, tenant_id: UUID) -> bool:
    return bool(
        db.execute(
            select(Tenant.require_run_environment_build).where(Tenant.id == tenant_id)
        ).scalar_one()
    )


def resolve(
    db: Session,
    tenant_id: UUID,
    project_id: UUID,
    context: RunContext,
    *,
    must_be_complete: bool,
) -> RunContext:
    """Checks the three choices against each other and the project. A build that belongs to a
    release brings that release; naming a different one is refused."""
    errors: dict[str, str] = {}
    if must_be_complete:
        if context.environment_id is None:
            errors["environment_id"] = "This organization requires an environment on every run"
        if context.build_id is None:
            errors["build_id"] = "This organization requires a build on every run"
    if context.environment_id is not None:
        found = db.execute(
            select(Environment.id).where(
                Environment.tenant_id == tenant_id, Environment.id == context.environment_id
            )
        ).scalar_one_or_none()
        if found is None:
            errors["environment_id"] = "environment_id was not found"
    release_id = context.release_id
    if release_id is not None:
        found = db.execute(
            select(Release.id).where(
                Release.tenant_id == tenant_id,
                Release.project_id == project_id,
                Release.id == release_id,
            )
        ).scalar_one_or_none()
        if found is None:
            errors["release_id"] = "release_id was not found in this project"
    if context.build_id is not None:
        build = db.execute(
            select(Build).where(
                Build.tenant_id == tenant_id,
                Build.project_id == project_id,
                Build.id == context.build_id,
            )
        ).scalar_one_or_none()
        if build is None:
            errors["build_id"] = "build_id was not found in this project"
        elif build.release_id is not None:
            if release_id is not None and release_id != build.release_id:
                errors["release_id"] = "That build belongs to a different release"
            release_id = build.release_id
    if errors:
        raise ValidationAppError("Invalid fields: " + ", ".join(errors), fields=errors)
    return RunContext(context.environment_id, context.build_id, release_id)


@dataclass(frozen=True)
class Names:
    environments: dict[UUID, str]
    builds: dict[UUID, str]
    releases: dict[UUID, str]

    def of(self, run: TestRun) -> dict[str, object]:
        env_id = run.environment_id
        build_id = run.build_id
        release_id = run.release_id
        return {
            "environment_id": env_id,
            "environment_name": self.environments.get(env_id) if env_id else None,
            "build_id": build_id,
            "build_name": self.builds.get(build_id) if build_id else None,
            "release_id": release_id,
            "release_name": self.releases.get(release_id) if release_id else None,
        }


def names_for(db: Session, runs: Sequence[TestRun]) -> Names:
    return Names(
        lookups.value_map(db, Environment.id, Environment.name, (r.environment_id for r in runs)),
        lookups.value_map(db, Build.id, Build.name, (r.build_id for r in runs)),
        lookups.value_map(db, Release.id, Release.name, (r.release_id for r in runs)),
    )


def apply_ci_context(
    db: Session,
    tenant_id: UUID,
    run: TestRun,
    environment: str | None,
    build: str | None,
    *,
    service_token_id: UUID,
) -> None:
    """ADR-155: a CI job names the environment and build it ran against. They fill in what the run
    does not record yet and never replace what it does. An unknown name refuses the result."""
    errors: dict[str, str] = {}
    env_id = build_id = None
    if environment and run.environment_id is None:
        env_id = db.execute(
            select(Environment.id).where(
                Environment.tenant_id == tenant_id,
                func.lower(Environment.name) == environment.strip().lower(),
            )
        ).scalar_one_or_none()
        if env_id is None:
            errors["environment"] = f"Unknown environment '{environment}'"
    if build and run.build_id is None:
        build_id = db.execute(
            select(Build.id).where(
                Build.tenant_id == tenant_id,
                Build.project_id == run.project_id,
                func.lower(Build.name) == build.strip().lower(),
            )
        ).scalar_one_or_none()
        if build_id is None:
            errors["build"] = f"Unknown build '{build}' in this run's project"
    if errors:
        raise ValidationAppError("; ".join(errors.values()), fields=errors)
    if env_id is None and build_id is None:
        return
    context = resolve(
        db,
        tenant_id,
        run.project_id,
        RunContext(env_id or run.environment_id, build_id or run.build_id, run.release_id),
        must_be_complete=False,
    )
    run.environment_id = context.environment_id
    run.build_id = context.build_id
    run.release_id = context.release_id
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=None,
        service_token_id=service_token_id,
        action="testrun.context_recorded_via_ci",
        entity_type="test_run",
        entity_id=run.id,
        metadata={
            "environment_id": str(context.environment_id) if context.environment_id else None,
            "build_id": str(context.build_id) if context.build_id else None,
        },
    )
