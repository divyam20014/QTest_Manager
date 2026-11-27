# QTestHub: Implementation Roadmap

All **[R]**. Order follows the brief. Complexity is relative (Low / Medium / High); **no calendar estimates are given**, because team size and velocity are unknown **[U]**. Findings: [Current state §15](QTESTHUB_CURRENT_STATE.md). Tables: [Database design](QTESTHUB_DATABASE_DESIGN.md).

## Rules for every phase

- Additive and backward compatible; each part can ship alone; larger new features behind a tenant switch where practical.
- Server-side authorisation; cross-tenant and permission tests for every new endpoint.
- New tenant tables follow the migration checklist (database design §6).
- Update `docs/` (the source) and then sync; never edit only the served copies.
- Exit: full backend, unit and browser suites green in CI, or each failure recorded and accepted.

## Priority and dependencies

```
Phase 0 + exit gate ─> 1 ─> 2 ─> 3 ─> 4 ─> 5 ─> 6 ─> 7 ─> 8 ─> 9
```

Phase 4 adds the build-to-release links that Phases 5 and 6 rely on. Phase 7 depends on history recorded from Phase 2 onwards.

---

## Phase 0: Assessment and stabilisation

- **Objective:** a trustworthy base. The assessment is these documents; the **exit gate** below removes defects that would undermine everything built on top.
- **Existing dependencies:** all current modules.
- **Required changes (exit gate, in order):**
  1. Sync documentation drift (F-08). **Do this before anyone runs the docs sync.**
  2. Protect executed history (F-01).
  3. Run both full test suites; triage failures; add CI.
  4. Stale-write protection for test cases, defects and approvals (F-04), after reproducing it.
  5. Make release readiness honest (F-02): until Phase 6 scopes it, label it "whole project" and remove the release selector, or scope it where data allows.
  6. Correct the build/environment claim in the user guide (F-03); complete the tenant export (F-05).
- **Frontend:** stale-write dialog; readiness labelling; hide Edit where the server now refuses.
- **Backend:** one "may this version change" rule; `expected_version`; row locks on transitions; export list.
- **Database:** `row_version` columns; optional immutability trigger.
- **API:** 409 for stale writes and protected versions; optional `expected_version` first.
- **Security:** none new; add the generated RLS and route-permission tests.
- **Testing:** reproduce F-01 and F-04 as failing tests first; two-session browser test.
- **Acceptance:** no request can change title, steps or expected result of a version referenced by a run case; a stale save returns 409 and the user's text survives; approval of changed content is refused; readiness never presents project figures as release figures; export test fails on an unlisted table; documentation check passes; CI runs on each change.
- **Complexity:** **Medium**.

## Phase 1: Organization, workspace and project management

- **Objective:** usable by a non-insurance SME; teams; roles that work per project.
- **Dependencies:** tenants, users, roles, projects, project_members. Decisions D-1, D-2, D-3.
- **Required changes:** optional/configurable domain and project fields; project archive; project templates (tabs, task statuses, modules); teams; new system roles; unified project policy (F-06). No workspace layer (D-2).
- **Frontend:** shorter create form; archive and restore; teams screen; add team to project; role pickers.
- **Backend:** policy function used by services; team membership expansion; archive rules (read-only, excluded from active lists).
- **Database:** `teams`, `team_members`; project column changes; archive fields.
- **API:** team CRUD; project archive/restore; relaxed project schema.
- **Security:** F-06 changes permission behaviour: record a before/after permission matrix and get it approved; no user may gain access silently.
- **Testing:** full role × action × project-override matrix; archived-project writes refused; reports with empty domain and budget.
- **Acceptance:** create a project with only a name; a project override changes both route **and** service behaviour; teams never grant more than their role; insurance tenants see no loss.
- **Complexity:** **High** (policy unification).

## Phase 2: Tasks, boards, milestones and sprints

- **Objective:** plan and track delivery.
- **Dependencies:** tasks, task statuses, board, releases, My Work, task reports.
- **Required changes:** estimates, rank, task type; milestones; sprints with backlog; dependencies (finish-to-start, warn rather than block); sprint history.
- **Frontend:** backlog and sprint views inside Tasks; sprint start/close dialog (unfinished work: backlog or next sprint); milestone list in Planning; dependency picker; keyboard ordering.
- **Backend:** sprint state rules; rank updates safe under concurrency; cycle detection.
- **Database:** `milestones`, `sprints`, `sprint_task_history`, `task_dependencies`; task columns.
- **API:** sprint and milestone CRUD, add/remove tasks, reorder, dependencies.
- **Security:** new permission codes for sprint and milestone management; composite same-project keys.
- **Testing:** cycle attempts through API and concurrent requests; sprint close; board and backlog at agreed scale (above the 2,000 tree cap).
- **Acceptance:** one backlog order everyone sees; closing a sprint preserves what was planned, added, removed and done; no cross-project links; existing task features unchanged.
- **Complexity:** **High**.

## Phase 3: Requirements management and traceability

- **Objective:** requirements that can be owned, imported and traced.
- **Dependencies:** requirements, versions, links, matrix, standard import wizard, attachments, AI generation.
- **Required changes:** project requirements view; display ID, type, status, priority, owner; acceptance criteria per version; Excel/CSV import through the **existing** wizard; link records the requirement version and flags "changed since linked".
- **Frontend:** requirements view under Tasks; criteria editor; suspect-link markers; import kind.
- **Backend:** import validators; suspect-link rule; coverage including status.
- **Database:** requirement columns, criteria table, link version column.
- **API:** project requirement list with filters; import template/preview/commit.
- **Security:** `requirement.manage` and the task import rule; upload limits unchanged. Documents remain attachments (no parsing).
- **Testing:** import errors and permissions; version change marks links; matrix at scale.
- **Acceptance:** every requirement listed per project with owner and status; criteria preserved per version; a changed requirement shows which tests need review; old links shown as "version not recorded".
- **Complexity:** **Medium**.

## Phase 4: Test management enhancement

- **Objective:** results that say what was tested, where.
- **Dependencies:** Phase 0 integrity; runs, plans, environments, builds, releases.
- **Required changes:** environment and build on runs; build belongs to a release; plan owner, dates, status, exit criteria; N/A decision (D-8); bulk assign and due date in a run; searchable pickers in Planning; decide whether re-recorded verdicts need attempt history (F-10).
- **Frontend:** run creation and header fields; plan page; bulk toolbar.
- **Backend:** defaults on re-run; CI webhook accepts build and environment.
- **Database:** `test_runs.environment_id`, `build_id`; `builds.release_id`; plan columns.
- **API:** additive run, plan, build and CI fields.
- **Security:** environment access rules continue to apply [V rules exist].
- **Testing:** old runs without values; CI payloads with and without new fields; exports.
- **Acceptance:** each new run shows environment and build (required only if the tenant says so); old runs say "not recorded"; no existing CI integration breaks.
- **Complexity:** **Medium**.

## Phase 5: Defect management

- **Objective:** a closed, provable fix-and-retest loop.
- **Dependencies:** defects, lifecycle, links, re-run, Phase 4 builds.
- **Required changes:** target release; fixed-in build; retest result linked to the defect it verifies; developer role view; defect Task column and legacy import parity as needed; conditional access rules applied on import (known limit, ADR-129).
- **Frontend:** "retest" action that creates or opens the verifying run case; verification panel.
- **Backend:** suggest status from retest outcome (a person confirms); optional rule: verify before close.
- **Database:** `target_release_id`; link type for verification.
- **API:** retest and verification endpoints.
- **Security:** developers cannot record test results or verify their own fix by default.
- **Testing:** lifecycle with each role; concurrent status changes.
- **Acceptance:** from a closed defect one can open the failing result, the fix build and the passing retest; reopened defects keep earlier attempts.
- **Complexity:** **Medium**.

## Phase 6: Resource and release management

- **Objective:** know who is available; release on evidence.
- **Dependencies:** teams (1), estimates (2), builds and plans (4), defect targets (5).
- **Required changes:** allocations; work logs; capacity and workload views; release scope service; scoped readiness; checklist; QA sign-off with snapshot and recorded overrides; release history.
- **Frontend:** release page (scope, readiness, checklist, sign-off); allocation editor; workload view; time entry on a task.
- **Backend:** one scope definition used everywhere; snapshot; over-allocation warnings.
- **Database:** `release_checklist_items`, `release_approvals` (append-only), `resource_allocations`, `work_logs`.
- **API:** scope, readiness (scoped), checklist, sign-off, allocations, work logs.
- **Security:** new `release.signoff` permission, never implied by editing; sign-off audited; no editing of a snapshot; work logs visible only to the owner, their managers and admins (confirm privacy needs **[U]**).
- **Testing:** readiness against hand-calculated fixtures, with other releases' data present; sign-off permissions; immutability.
- **Acceptance:** two releases in one project show different, correct figures; each number opens the records behind it; a signed release shows exactly what was signed.
- **Complexity:** **High**.

## Phase 7: Reports and analytics

- **Objective:** delivery and quality side by side.
- **Dependencies:** history from 2 to 6; dashboard engine, report builder, schedules, exports.
- **Required changes:** role presets (management, project, QA); sprint, workload and release reports; new builder sources; one published definition per metric.
- **Frontend / Backend / API:** widgets and sources on the existing engines; no new reporting stack.
- **Database:** summary tables only where measurement requires.
- **Security:** each widget respects project access and tester scoping; scheduled emails contain only what the schedule owner may see **[U: current rule to verify]**.
- **Testing:** every figure equals its linked list; cross-project leakage tests; performance.
- **Acceptance:** no unlabelled or conflicting metric; figures reconcile to records.
- **Complexity:** **Medium**.

## Phase 8: AI and automation

- **Objective:** optional help, always reviewed.
- **Dependencies:** AI provider interface, usage logs, plan limits, requirements (3), releases (6).
- **Required changes:** project and QA summaries; coverage-gap and risk suggestions that **cite records**; optional second provider only on demand.
- **Frontend:** drafts clearly marked, with sources; accept, edit or discard.
- **Backend:** limits per plan; context built **only from records the requester can open**; time-outs and provider failure handling.
- **Database:** none expected beyond usage actions.
- **Security:** tenant opt-in; state what data is sent; treat record text as untrusted (prompt injection); never let output change data or permissions without a user action.
- **Testing:** permission-scoped context; injection cases; disabled-tenant behaviour; fake provider.
- **Acceptance:** with AI off, nothing is sent and every workflow works; no AI output is saved or sent without review.
- **Complexity:** **Medium**.

## Phase 9: SaaS commercial readiness

- **Objective:** safe to sell and operate.
- **Dependencies:** plans, subscriptions, signup, platform console, production compose, backup scripts.
- **Required changes:** enforce plan limits consistently **[U: current enforcement not audited]**; billing (provider choice open); shared rate limiting; malware scanning; restore drills; monitoring and alerts; tenant offboarding and deletion; privacy and terms review; load and penetration testing.
- **Frontend:** plan, usage and billing screens.
- **Backend:** billing events (verified, idempotent); lifecycle states.
- **Database:** billing references only; no card data.
- **API:** billing webhooks.
- **Security:** independent penetration test; secret rotation; incident process.
- **Testing:** production-stack end to end; restore; upgrade and rollback.
- **Acceptance:** a restore is proven within agreed targets; limits are enforced server-side; no open critical or high findings.
- **Complexity:** **High**.

> Billing introduces an external provider. The brief forbids unnecessary third-party services, so confirm it is needed before choosing one.

## Recommended first step

**The Phase 0 exit gate, items 1 to 3**: reconcile the documentation, protect executed history, and establish full test results in CI. Each is small next to later phases, and every later phase depends on them.
