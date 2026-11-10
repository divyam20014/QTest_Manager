# QTestHub — Test Strategy

This formalizes the testing approach already established and used throughout this
project's history (every module to date was implemented under this discipline,
documented module-by-module in `docs/IMPLEMENTATION_STATUS.md`). It is written up
now, as a Phase 0 deliverable, so every future phase in `docs/DEVELOPMENT_ROADMAP.md`
is held to the same bar explicitly rather than by convention alone.

## 1. Backend: integration-style tests against real PostgreSQL

`backend/tests/` runs `pytest` against a **real PostgreSQL instance with Row-Level
Security enabled** — never mocked or substituted with SQLite — because RLS, the
hash-chained audit log, and tenant-context GUC behavior cannot be faithfully tested
any other way. Each test module exercises the actual `set_tenant_context` /
`app.current_tenant` session mechanism, the same path production traffic uses.

Standing checks run on every change:
- `ruff check app tests` (lint)
- `mypy app` (types)
- `pytest -q` (full suite; 227/227 passing as of the last full regression)

Test categories already in place, to be extended (never replaced) by new phases:
- **Functional/CRUD** per module (projects, test cases, executions, defects, users,
  audit log).
- **Tenant isolation**: every new table/endpoint gets a cross-tenant-access test
  (confirm a second tenant's token/session cannot read or write tenant-A data) —
  this is non-negotiable per the BRD's core invariants and is re-verified for every
  new entity introduced by the roadmap (`Requirement`, `Environment`, `Build`,
  comments, API keys, etc.).
- **Security hardening** (`test_security_hardening.py`): a route-discovery sweep
  over `app.routes` that asserts every route requires either authentication or an
  explicit, named exemption (`_PUBLIC_OR_SEPARATE_AUTH_PREFIXES`) — new routes are
  caught automatically if they're accidentally left open; magic-byte file-upload
  validation; IDOR/broken-access-control checks.
- **Reliability** (`test_reliability.py`): idempotency-key dedup, optimistic-
  concurrency (`expected_version`) conflict detection, concurrent-update races,
  transaction-rollback correctness.
- **Performance** (lightweight, pytest-timed, not k6/load-tooling): step-toggle
  latency, search latency, CSV-export timing at realistic row counts, dashboard
  aggregation timing — budgets documented in `docs/Performance_Test_Report.md`,
  re-run whenever a phase touches a budgeted path.

## 2. Frontend: typecheck + lint + unit + E2E

Standing checks on every change:
- `npm run typecheck`
- `npm run lint`
- `npm run test -- --run` (component/unit tests, Vitest)
- `npm run build`

Then, after a Docker rebuild (`docker compose up --build -d` — the `web` service
has no source volume mount, so this step is mandatory, not optional):
- **Playwright E2E** (`frontend/e2e/`) against the rebuilt stack and the real
  persistent demo tenant (never a freshly-created one) — journeys covering
  authentication/MFA, test authoring, execution, defect creation, reporting, and
  reliability scenarios (refresh/network-interruption/concurrent-edit).
- **Accessibility** (`accessibility.spec.ts`, `@axe-core/playwright`): WCAG 2.1 A/AA
  scan of every page. Every new page a phase introduces must be added to this scan,
  not just the ones the phase itself is about — this is how the `AuditLogs.tsx`
  `aria-expanded`-on-`<tr>` bug was actually found, by extending coverage, not by
  the phase that built the page.

## 3. Live verification (manual-equivalent, screenshot-backed)

No module is considered complete on the strength of automated tests alone. The
established pattern — followed for every module delivered so far — is:
1. Rebuild Docker, confirm the stack is healthy (`/api/v1/ready`, not just `/health`).
2. Drive the actual feature through the real browser (Playwright, scripted, not
   just typed-and-hoped) against the real tenant credentials, screenshot the
   result, and look at the screenshot — not just assert on DOM state. (This is
   also how the pie-chart animation artifact was correctly identified as a
   screenshot-timing issue, not a real bug, by re-screenshotting later.)
3. Clean up scratch verification specs/screenshots afterward — they are not part
   of the committed test suite.
4. Remove `.env` at the end of the session (dev secrets are never left on disk
   between sessions).

## 4. New-module-specific requirements this roadmap introduces

- **AI phases (Phase 3–5)**: every AI phase ships an explicit **"AI disabled"**
  regression test — the full existing test-management/execution/reporting/
  traceability suite must pass unchanged with the AI feature flag off. This is the
  direct test-level enforcement of the user's own requirement that AI never become
  a dependency for core functionality. AI phases additionally need:
  - A **no-auto-mutation invariant** test: AI suggestions must never silently
    alter a test case, requirement, or defect — only a human action does.
  - A **prompt-injection resistance** check on any user-authored text (requirement
    descriptions, test case text) that gets fed to a model.
  - **Usage/token metering accuracy** tests, since this feeds tenant-level cost
    tracking.
- **Phase 12 (Automation/CI, new machine-auth plane)** and **Phase 19 (SSO)**: both
  introduce new authentication surfaces. Each gets the same route-discovery
  security-hardening sweep applied to the existing human-auth and platform-admin
  planes, extended to cover the new plane, plus a dedicated security review before
  that phase's approval gate — not folded into the phase's regular functional
  tests.
- **Phase 13 (reopened-defect analysis)** and **Phase 22 (tenant-configurable
  enums)**: both change existing constraints (`ck_defects_status`,
  `ck_*` enums elsewhere). Each needs a **migration-safety test**: existing data
  under the old constraint must remain valid and correctly interpreted after the
  migration, not just new data going forward.
- **Phase 11 (Environment/Build entities)**: needs a backfill-correctness test —
  existing free-text `Defect.environment` values must be preserved/migrated, not
  dropped, when the dedicated entity is introduced.

## 5. What does not change

This document does not introduce load/stress tooling (k6 etc.) — the project's
established choice (confirmed earlier, via explicit user decision: "Lightweight
pytest timing," no k6) stands unless a future phase's scale requirements
genuinely demand it, in which case that phase's own test plan should say so
explicitly rather than silently expanding scope.
