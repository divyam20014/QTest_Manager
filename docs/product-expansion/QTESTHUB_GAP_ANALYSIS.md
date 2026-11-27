# QTestHub: Gap Analysis

Baseline and marks as in [Current state](QTESTHUB_CURRENT_STATE.md). Finding IDs (F-01 …) are defined there. Every status is **[V]** unless marked otherwise; the "Gap or note" column includes recommendations where marked **[R]**.

Statuses: **Implemented**, **Partial**, **Missing**, **Investigate**, **Not required**.

## A. Organization and administration

| Capability | Status | Gap or note |
|---|---|---|
| Organizations | Implemented | A tenant *is* the organization. Created by signup or the platform console. |
| Workspaces | Not required (v1) [R] | No layer exists between tenant and project. "Workspace" currently names tenant menu defaults. |
| Departments | Not required (v1) [R] | Can later be an attribute of a team. |
| Teams | Missing | Only per-project membership exists. |
| Users | Implemented | Invites, deactivation, erasure, SCIM. |
| Roles and permissions | Partial | 3 system roles, custom roles, 41 codes. Project override is route-level only (F-06). No developer or read-only stakeholder role. |
| Audit logs | Implemented | Hash-chained, append-only for the app role. Values truncated (F-10). |
| Organization settings | Implemented | Branding, security, SSO, fields, integrations, data, task statuses, environments. Primary domain list is insurance-only. |

## B. Project management

| Capability | Status | Gap or note |
|---|---|---|
| Project creation and configuration | Partial | Insurance-specific and many mandatory fields (F-07). No archive. A project that has had a task cannot be deleted. Fixed status list. |
| Project members | Implemented | With role override (see F-06). |
| Project dashboard | Implemented | Configurable widgets. |
| Tasks and sub-tasks | Implemented | Five levels, tenant statuses in fixed categories, per-project display IDs, protected "Unassigned requirements" task. |
| Assignments, priorities, statuses | Implemented | One assignee per task. |
| Kanban board | Implemented | Task board. No configurable columns or work-in-progress limits. |
| List view | Implemented | Hierarchy and flat list. Tree capped at 2,000. |
| Milestones | Missing | |
| Dependencies | Missing | |
| Sprint planning | Missing | A task can point to a release, not to a sprint. |
| Backlog | Missing | No ordering (rank) field. |
| Comments and attachments | Implemented | Tasks included. Mentions exist. |
| Time tracking | Missing | Tasks have no estimate or logged effort. |

## C. Requirements management

| Capability | Status | Gap or note |
|---|---|---|
| Repository | Partial | Requirements live on tasks (ADR-128). **No project-wide requirement list.** |
| BRD/SRS upload | Partial | Files attach to a requirement or task. No parsing or requirement extraction. |
| Excel import | Missing | Standard import covers test cases and defects only. |
| User stories | Missing | No type field. |
| Acceptance criteria | Missing | Only a free-text description. |
| Ownership | Missing | Only `created_by`. No owner, status or priority. |
| Versioning | Implemented | `requirement_versions`. |
| Traceability to test cases | Partial | Many-to-many, with a matrix screen. A link does not record which requirement version the case covers. |
| Coverage reports | Implemented | Project coverage and task roll-ups. |

## D. Test management

| Capability | Status | Gap or note |
|---|---|---|
| Repository | Implemented | Modules (hierarchical), per-project and all-projects lists. |
| Test plans | Partial | Name, description, optional release, linked runs, roll-up. No scope, dates, owner or entry and exit criteria. |
| Test suites | Implemented | Flat, cross-module. |
| Test cases, steps, preconditions, expected results, test data | Implemented | Standard field set, shared steps, data sets, custom fields. |
| Versioning | **Partial** | Versions exist and runs pin them. **Broken for deprecated cases (F-01).** |
| Test cycles | Partial | A run is the cycle; a plan groups runs. No separate entity needed [R]. |
| Execution | Implemented | Step-level verdicts, timing, pause, block, reopen, assignment, due dates. |
| Pass / Fail / Blocked / Not Run / N/A | Partial | Run case: pending (Not Run), in progress, passed, failed, blocked, ignored. Step: pass, fail, ignore. **No "N/A" label**; decide whether "ignored" means it [R]. |
| Evidence | Implemented | Attachments and comments on steps; actual result required on failure (setting). |
| Execution history | Partial | Per case and run. Run lacks environment, build and release (F-03). Verdict changes overwrite (F-10). |
| Regression | Implemented | Run types, suites, re-run failed, original-run link. |
| Requirement coverage | Implemented | See C. |

## E. Defect management

| Capability | Status | Gap or note |
|---|---|---|
| Creation, severity, priority, assignment | Implemented | Standard fields, create from a failed step. |
| Lifecycle | Implemented | Fixed transition rules, resolutions, tenant labels. |
| Comments and attachments | Implemented | |
| Failed test to defect | Implemented | Run case, run, version and step are stored. One primary run case; more through `defect_links`. |
| Retesting and reopening | Partial | Retest and Reopened statuses, reopen count, re-run failed. A retest result is not recorded as the verification of a specific defect [R: link it]. |
| Reports | Implemented | Trends, leakage, aging, SLA notice, export. |
| Safe concurrent editing | Missing | F-04. |

## F. Resource management

| Capability | Status | Gap or note |
|---|---|---|
| Team allocation, project allocation | Missing | Membership has no allocation percentage or dates. |
| Workload | Partial | Tester workload widget and My Work counts (test and defect items). |
| Capacity planning | Missing | |
| Estimated against actual effort | Missing | Execution step durations exist; they are not task effort. |
| Utilization | Missing | |

## G. Release management

| Capability | Status | Gap or note |
|---|---|---|
| Release planning | Partial | Name, date, notes, status. |
| Versions and builds | Partial | Builds belong to a project, **not to a release**. |
| Scope; associated requirements and tasks | Partial | `tasks.release_id` only. Requirements reach a release only through their task. No scope view or freeze. |
| Test cycle association | Partial | Through `test_plans.release_id`. |
| Open defect tracking | Partial | `fixed_in_release_id`, `found_in_build_id`. No target release. |
| QA sign-off | Missing | |
| Readiness checklist | Missing | |
| Release readiness | **Partial, misleading** | Report ignores the release (F-02). |
| History | Missing | No snapshot of readiness at the time of release. |

## H. Reports and analytics

| Capability | Status | Gap or note |
|---|---|---|
| Management dashboard | Partial | Organization dashboard and domain distribution (insurance-oriented). No delivery view across projects. |
| Project dashboard | Implemented | |
| QA dashboard | Partial | QA manager and quality metric cards in Reports. |
| Task progress | Implemented | Roll-ups, report builder source. |
| Sprint reports | Missing | Needs sprints. |
| Execution, coverage, defect analytics | Implemented | |
| Team workload | Partial | See F. |
| Release readiness | Partial | F-02. |
| Report builder, saved and scheduled reports, PDF/XLSX/CSV | Implemented | Builder sources include test cases, runs and tasks. |
| Three pass-rate definitions | Partial | Step, case and run-case rates are labelled; one per-tester table is still unlabelled. |

## I. AI and automation

| Capability | Status | Gap or note |
|---|---|---|
| Test case generation | Implemented | Creates cases that still need approval. |
| Requirement analysis | Partial | Change-impact analysis. No quality or ambiguity check [U: not seen]. |
| Coverage analysis, risk-based insights | Missing (AI) | Rule-based coverage reports exist. |
| Defect analysis | Partial | Root-cause suggestion; non-AI analytics. |
| Project and QA summaries | Partial | An assistant answers questions; no scheduled or one-click summary. |
| Optional, configurable, human-reviewed | Implemented | Per tenant, off until configured, usage logged. One provider. |
| Automation intake | Implemented | CI results webhook; automation status field; quarantine. |

## Traceability required by the brief

| Mapping | Status | Detail [V] |
|---|---|---|
| Requirement → task | Partial | `requirements.task_id`: many requirements per task, **one task per requirement** |
| Requirement → test case | Implemented | Many-to-many; no requirement version on the link |
| Test case → execution | **Partial** | Run case and each step pin the version; F-01 lets the pinned version change |
| Execution → defect | Implemented | `defects.test_run_case_id`, version and step; `defect_links` |
| Defect → release | Partial | Fixed-in release; found-in build, which has no release; no target release |
| Sprint → task | Missing | |
| Project → release | Implemented | `releases.project_id` |
| Release → test cycle → sign-off | Partial / Missing | Through plans; no sign-off |

## UI and UX (specific problems only)

A navigation and layout pass finished on 2026-11-26 (flat sidebar, eight project tabs, compact headers, phone bar, aligned Test Cases pages). **[R] Do not redesign it.** Open, specific problems:

| Problem | Basis |
|---|---|
| No warning before overwriting another user's work | F-04 |
| Release readiness looks per-release but is not | F-02 |
| Project creation asks for insurance domain, budget and region | F-07 |
| No project-wide requirements view | C |
| Run cases are assigned and dated one row at a time | [V] run page |
| Activity entries do not name the record changed | [V] screenshots, 2026-11-26 |
| Planning uses plain checkbox lists for cases and runs | [V] screenshots, 2026-11-26 |
| A test case's action buttons fill much of a phone screen | [V] screenshot, 2026-11-26 |
| Role-based dashboards: one dashboard filtered by permission, no role presets | [V] |
| Unified search covers test cases, defects, requirements and tasks; other record types are reached through navigation | [V] search service (projects and runs **[U]** in the palette) |
| Accessibility: many targets under 24 px were reported, not failed, in the last full sweep | [V] sweep output, before the latest navigation changes |
