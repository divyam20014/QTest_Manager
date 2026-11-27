# QTestHub: Database Design

Existing structure is **[V]** from the live schema at `a7c9e1f3b5d8`. All proposals are **[R]**. **No schema change was made.** Column lists are design intent, not migration code.

## 1. Existing conventions to keep [V]

- `tenant_id` + forced RLS with a `USING` and `WITH CHECK` policy; grants to `qtesthub_app`.
- UUID keys; human IDs (`TC_`, `BUG_`, `TASK_`) from `entity_counters`, made immutable by triggers.
- Composite same-project keys, for example `(task_id, project_id) → tasks(id, project_id)`.
- Soft delete (`deleted_at`) on defects, test cases, test runs and tasks, filtered by an ORM hook. Raw SQL and wrapped subqueries must filter explicitly.
- Immutable audit log; `projects.version` for stale-write checks.

Note: 31 policies cast the tenant setting directly and 19 use `NULLIF(...)` first (one more also allows global rows). With no tenant set, the first form raises an error rather than returning rows. Use the `NULLIF` form for new tables.

## 2. Entity classification

| Entity in brief | Existing table(s) | Classification | Change |
|---|---|---|---|
| organizations | `tenants` | **Existing and reusable** | None. Do not add a table. |
| workspaces | none (`tenants.workspace_config` is menu defaults) | **Not required** (v1) | |
| users | `users` | Existing and reusable | Optional weekly capacity (Phase 6). |
| teams | none | **Missing** | `teams`, `team_members`. |
| roles | `roles` | Needs enhancement | New system roles. |
| permissions | `permissions`, `role_permissions` | Needs enhancement | New codes only. |
| projects | `projects` | Needs enhancement | Optional domain, budget, region, dates; key; archive fields. |
| project_members | `project_members` | Needs enhancement | See 5. |
| tasks | `tasks`, `task_statuses` | Needs enhancement | `row_version`, `estimate_hours`, `rank`, `sprint_id`, `milestone_id`, `type`. |
| task_comments | `comments`, `comment_mentions` | **Not required** | Polymorphic comments already cover tasks. |
| milestones | none | **Missing** | |
| sprints | none | **Missing** | |
| requirements | `requirements`, `requirement_versions` | Needs enhancement | `display_id`, `type`, `status`, `priority`, `owner_id`, `row_version`, `deleted_at`; acceptance criteria. |
| user_stories | none | **Not required** | `requirements.type`. |
| test_plans | `test_plans`, `test_plan_runs` | Needs enhancement | Owner, dates, status, exit criteria. |
| test_suites | `test_suites`, `test_suite_cases` | Existing and reusable | |
| test_cases | `test_cases`, `test_case_versions` | Needs enhancement | `row_version`; enforce immutability of executed versions (F-01). |
| test_steps | `test_case_version_steps`, `shared_steps` | Existing and reusable | |
| test_cycles | `test_runs` | **Not required** | See D-5. |
| test_runs | `test_runs` | Needs enhancement | `environment_id`, `build_id` (F-03). |
| execution_results | `test_run_cases`, `execution_steps` | Needs enhancement | Keep; consider attempt history (F-10). |
| defects | `defects`, `defect_links` | Needs enhancement | `row_version`, `target_release_id`; retest link type. |
| defect_history | `audit_logs` | **Not required** | Reuse audit; raise or separate long-text history if recovery is needed. |
| releases | `releases`, `builds` | Needs enhancement | `builds.release_id`; version label, start date, released_at, `row_version`. |
| release_approvals | none | **Missing** | |
| resource_allocations | none | **Missing** | |
| work_logs | none | **Missing** | |
| audit_logs | `audit_logs`, checkpoints | Existing and reusable | New actions only. |
| notifications | `notifications` | Existing, small enhancement | New types; per-user preferences **[U]** (none seen). |

## 3. Integrity changes needed first (no new features)

| Change | Reason | Notes |
|---|---|---|
| Refuse content edits to a version that has any run case, or fork a new version for **every** status | F-01 | Service rule first (no migration). Then consider a database trigger on `test_case_versions` and `test_case_version_steps` as a second line, tested against legitimate approval updates. |
| `row_version integer not null default 1` on `defects`, `test_cases`, `tasks`, `requirements`, `releases` | F-04 | `test_case_versions.version_number` is not enough: draft edits do not change it. Roll out API-optional, then require it. |
| `test_runs.environment_id`, `test_runs.build_id` (nullable, same-project check) | F-03 | Existing runs stay NULL and are shown as "not recorded". **Do not guess values.** |
| Add omitted tables to the tenant export | F-05 | Code only. Add a test that fails when a tenant table is neither exported nor listed as excluded. |

## 4. Proposed new tables

All: `id`, `tenant_id`, `created_at`, RLS (forced) and grants.

| Table (phase) | Key columns | Constraints and indexes |
|---|---|---|
| `teams` (1) | name, lead_user_id | unique (tenant_id, lower(name)) |
| `team_members` (1) | team_id, user_id | unique (team_id, user_id); index user_id |
| `milestones` (2) | project_id, name, due_date, status | unique (id, project_id); unique (project_id, name); index (project_id, due_date) |
| `sprints` (2) | project_id, name, goal, start_date, end_date, state | check start ≤ end; **partial unique: one active sprint per project** [confirm rule]; unique (id, project_id) |
| `sprint_task_history` (2) | sprint_id, task_id, added_at, removed_at, estimate_at_add | needed for honest sprint reports; index (sprint_id), (task_id) |
| `task_dependencies` (2) | task_id, depends_on_task_id, project_id | both composite-FK to the same project; no self-link; unique pair; **cycle check in the service plus a trigger**, as for the task tree [V pattern exists] |
| `requirement_acceptance_criteria` (3) | requirement_version_id, position, text | belongs to a **version**, so history is preserved; unique (version, position) |
| `release_checklist_items` (6) | release_id, label, required, done_by, done_at, note | index release_id |
| `release_approvals` (6) | release_id, decision (`approved`, `rejected`), approver_id, comment, snapshot jsonb, overrides jsonb | **append-only** (no UPDATE/DELETE grant, like `audit_logs`); a new decision is a new row |
| `resource_allocations` (6) | project_id, user_id, percent, start_date, end_date | check 0 < percent ≤ 100; index (user_id, start_date, end_date); overlap is a warning, not a constraint |
| `work_logs` (6) | task_id, user_id, work_date, minutes, note, deleted_at | check minutes > 0; index (task_id), (user_id, work_date) |

Columns added to existing tables: `tasks.sprint_id` and `tasks.milestone_id` with composite same-project foreign keys; `requirement_test_case_links.requirement_version_id` (the version the link was made or last confirmed against; nullable for old links, never back-filled with a guess).

## 5. Relationships and isolation

```
tenants ─< projects ─< tasks ─< requirements ─< requirement_versions ─< acceptance criteria
                     │   │            └─<> test_cases   (requirement_test_case_links)
                     │   └─<> test_cases                (task_test_case_links)
                     ├─< milestones, sprints ─< tasks
                     ├─< releases ─< builds ─< test_runs ─< test_run_cases ─< execution_steps
                     │        ├─< test_plans ─<> test_runs
                     │        └─< checklist, approvals
                     └─< defects ─> test_run_cases, test_case_versions, steps, releases
```

- **New foreign keys within a project must be composite** `(x_id, project_id)`, so the database refuses cross-project links.
- **[R]** For new tables, also guarantee same-tenant references: composite `(x_id, tenant_id)` keys or a constraint trigger. Today this relies mainly on service validation [V].
- `project_members` has no `tenant_id` or RLS [V]. Adding both is sound defence in depth but touches sign-in, SCIM and permission paths: do it as its own migration with isolation tests.
- Review and document the other no-RLS tenant tables (`sessions`, `mfa_challenges`, `user_invites`, `background_jobs`) before changing them.

## 6. Migration rules for this codebase

1. Expand, back-fill, then tighten, in separate releases. New columns nullable or with a safe default.
2. Every new tenant table needs in one change: model, migration with RLS + `FORCE` + policy + grants, tenant export entry, soft-delete hook if used, user-erasure review, audit actions, and a cross-tenant test.
3. Making `domain`, `budget`, `region`, `start_date`, `end_date` optional needs a check of **every** report and export that assumes them (domain distribution, dashboards, compliance) **[U: impact not traced]**.
4. Saved JSON configuration (layouts, views, widgets) must translate renamed keys. A project layout is validated on every read, so a refused key stops the project loading [V, ADR-131].
5. Migrations set role passwords from environment variables and the roles are server-wide [V]. Any second database on a server must be migrated with the real values.
6. Back up before each migration; test upgrade and downgrade on a copy with realistic volume. State where a downgrade loses data.
7. Large indexes on `test_run_cases`, `execution_steps`, `audit_logs`: build concurrently.

## 7. Index review

Many indexes exist [V] (for example 21 on `defects`, 15 on `test_cases`). **[R]** Add indexes only with the query that needs them, checked with `EXPLAIN` on load-test data; `pg_stat_statements` is already enabled [V]. **[U]** Unused or missing indexes were not analysed.
