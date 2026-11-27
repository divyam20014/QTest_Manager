# QTestHub: Product Blueprint

Everything here is **[R] recommended** unless marked **[V]**. It extends the current product; see [Current state](QTESTHUB_CURRENT_STATE.md).

## 1. Positioning

Unified project and test management for small and medium software teams. The difference to build on: **delivery work and quality evidence are one chain**, so a release can be judged from the requirements, tasks, test results and defects inside it.

That claim is **not yet true** [V]: release readiness ignores the release (F-02) and executed history can change (F-01). Both must be fixed before it is advertised.

## 2. Structure

```
Organization (existing tenant)
 ├─ People: users, roles, teams (new)
 └─ Project
     ├─ Planning: milestones (new), sprints (new), backlog (new view), releases
     ├─ Tasks and sub-tasks ── requirements (stories, acceptance criteria)
     ├─ Test: cases → versions → suites → plans → runs (cycles) → results
     ├─ Defects
     └─ Release: scope → test plans → readiness → QA sign-off (new)
```

### Decisions to confirm before Phase 1

| ID | Question | Recommendation | Why |
|---|---|---|---|
| D-1 | New `organizations` table? | No. The tenant is the organization. | A second root would duplicate isolation. |
| D-2 | Workspace layer between organization and project? | **Not in v1.** | Every query, policy and permission would gain a level, for a need SMEs rarely have. Revisit on demand. Do not reuse the word for something else. |
| D-3 | Keep insurance domains? | Make domain optional and tenant-configurable; keep the insurance pack as an optional template set. Make budget, region and dates optional. | F-07 blocks the new market. **Product-owner decision**: the master spec defines an insurance product [V]. |
| D-4 | Separate user stories table? | No. A requirement gets a type (`requirement`, `story`) and acceptance criteria. | Reuses versions, links, coverage and AI. |
| D-5 | Separate test cycle table? | No. A test run is a cycle; a plan groups cycles. Use the label "Test cycle" only if users ask. | Avoids a second execution model. |
| D-6 | Move to JWT? | No. Keep server-side sessions. | They work, can be revoked at once, and the cookie is `HttpOnly` [V]. |
| D-7 | Add Redis and Celery? | No, not yet. | The database queue meets current needs [V]. See the architecture triggers. |
| D-8 | What does "N/A" mean in results? | Present the existing `ignored` as "N/A" if the meaning matches; otherwise add a value. | Ask users who record results. |
| D-9 | A requirement on more than one task? | Keep one owning task; add "related tasks" only if asked. | ADR-128 made the task the owner [V]. |

## 3. Modules and scope

| Module | In scope | Out of scope (v1) |
|---|---|---|
| Administration | Teams; project roles that work; project templates | Departments, workspaces, multiple organizations per sign-up |
| Project management | Existing tasks and boards; milestones; sprints; backlog ordering; finish-to-start dependencies; estimates | Gantt editing, critical path, portfolio finance, configurable workflow engines |
| Requirements | Project list, type, owner, status, priority, acceptance criteria, Excel import | Parsing BRD/SRS documents automatically (files stay attachments); approval chains |
| Test management | History integrity; environment and build on runs; plan details | A second case model; script execution engine |
| Defects | Safe editing; target release; retest linked to the defect | Two-way sync with external trackers |
| Resources | Allocation by project and period; capacity and workload from estimates; manual time entries | Payroll, billing, timesheet approval |
| Releases | Scope, builds in releases, readiness from that scope, checklist, sign-off, snapshot | Deployment automation |
| Reporting | Correct release and sprint reports; role presets | A separate analytics database |
| AI | Existing features plus summaries; always optional and reviewed | Autonomous changes to records |

## 4. User roles

Existing [V]: Admin, Manager, Tester, custom roles, project role override (route-level only, F-06), and a separate platform administrator.

| Role (proposed system roles) | Main job | Can | Cannot |
|---|---|---|---|
| Admin (existing) | Organization | Everything in the tenant | Other tenants |
| Manager (existing; shown as "Project Manager") | Delivery | Projects, planning, members, reports | Tenant security settings |
| QA Lead (new) | Quality | Approve cases, own plans, QA sign-off | Tenant administration |
| Tester (existing) | Execution | Write and run tests, raise and retest defects | Approve own work by default, sign off |
| Developer (new) | Build and fix | Work tasks, update assigned defects | Edit test results, close or sign off |
| Viewer (new) | Stakeholder | Read permitted projects and dashboards | Change anything |

Rules: permissions are enforced on the server; a project role must apply in **service rules too**, not only at the route (fix F-06 before adding project-specific roles). Seat and licence implications of Developer and Viewer are **[U]**.

## 5. Core workflows

1. **Plan:** create a project (name only required) → add members or a team → backlog → milestone or sprint.
2. **Define:** requirement or story with acceptance criteria on a task → link or draft test cases → approve.
3. **Build and test:** sprint tasks → test plan for the release → runs against a named **environment and build** → results with evidence.
4. **Defect loop:** failed step → defect (version and step stored) → developer fixes → "Fixed in build" → retest run linked to the defect → verified or reopened.
5. **Release:** set scope (tasks, requirements) → readiness **for that scope** → checklist → QA sign-off by an authorised person → snapshot kept → released.

Gate rules (configurable, off by default): block sign-off with open critical defects in scope, untested requirements in scope, or failed results without a linked defect. A permitted user may override with a recorded reason.

## 6. Navigation and screens

Keep the current sidebar and project tabs [V]. Place new items inside them:

| New feature | Where |
|---|---|
| Backlog, sprints, milestones | **Tasks** tab: views `Hierarchy / List / Board / Backlog / Sprint`; milestones in **Planning** |
| Requirements list | A view of the **Tasks** tab ("Requirements"), not a restored tab |
| Release scope, checklist, sign-off | **Planning > Releases & builds**, one page per release |
| Teams and allocation | **Admin** (teams); project **Team** tab (allocation); one **Resources** report |
| My tasks | **My Work** (built [V]) |

Dashboards: one dashboard engine [V] with role presets (management, project, QA) built from existing widgets, instead of three new screens.
