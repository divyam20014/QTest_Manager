# Phase 1E: Project roles and new roles (for approval)

Status: **approved by the product owner and built on 2026-11-27** (ADR-143), with all five recommendations. Sections 1 and 2 describe the earlier behaviour. Marks as in [Current state](QTESTHUB_CURRENT_STATE.md): **[V]** verified, **[R]** recommended, **[U]** unknown.

## 1. How access is decided today [V]

1. **Permission check on the route**, from the person's role.
2. **Tier checks inside services**, which look for `admin`, `manager` or `tester`. A custom role counts as `manager` if it has `project.view.all`, otherwise as `tester`.

A **project role override** changes only step 1, and only on some routes. Of the state-changing routes recorded in `backend/tests/route_permissions.txt`:

| Kind of route | Count | Does the override apply? |
|---|---|---|
| Project-aware permission check (including the defect check) | 33 | Yes |
| Organization-role permission check, many of them on project records | 115 | **No** |
| Signed-in only; any further check is inside the service | 31 | **No** |
| Execution recording check | 4 | **No** |

The tier checks (step 2) never use the override.

## 2. Problems this causes

All from reading the code. **[U] Not yet reproduced with tests; each would be reproduced before it is fixed.**

| ID | Problem | Example |
|---|---|---|
| P-1 | **A restrictive override does not restrict** | A Manager given the Tester role on a project can still edit, archive or delete it and change its members (`PATCH /projects/{id}`, `/archive`, `/members` use the organization role). That includes changing their own override |
| P-2 | **A permissive override works only in part** | A Tester given the Manager role passes some routes and is refused by others, or by a tier check inside the service |
| P-3 | **An override is not limited to what the assigner holds** | Any active system or tenant role, including Admin, can be assigned by someone who may manage that project's members |
| P-4 | AI test case generation does not require `testcase.create` (F-12) | The route needs only sign-in, and it saves test cases |
| P-5 | A read-only role cannot exist yet | Commenting, attaching files to some records and similar writes need only the right to see the record |
| P-6 | A retest result needs only `defect.change_status` | A developer role with that permission could record that their own fix passed |

## 3. Proposed rules [R]

| Rule | Effect |
|---|---|
| R-1 | **One decision.** For anything belonging to a project, both the permissions and the tier come from the project role if there is one, otherwise from the organization role. Routes and services ask the same function |
| R-2 | **Organization actions ignore project roles:** users, teams, roles, organization settings, SSO, integrations, task statuses, custom fields, environments, access rules, audit log, creating projects |
| R-3 | A project role grants **only project permissions**; the organization ones in R-2 are never gained through it |
| R-4 | **You cannot give what you do not have:** assigning a project role needs every project permission in that role. Nobody changes their own project role, except an organization Admin |
| R-5 | An organization **Admin cannot be restricted** by a project role |
| R-6 | New permission `record.contribute` for comments, attachments, custom field values and AI actions on records. **Every existing system and custom role gets it**, so nobody loses access |
| R-7 | AI test case generation also needs `testcase.create` |
| R-8 | Recording a retest result also needs `testcase.execute` |

## 4. Before and after

| Person and situation | Today | After |
|---|---|---|
| Any role, no project role | as now | **No change**, except R-7 and R-8 for custom roles that lack the extra permission |
| Manager with a Tester project role | Still manages that project through many routes | Tester on that project |
| Tester with a Manager project role | Manager on some actions only | Manager on that project, for project actions |
| Tester with a Manager project role, on organization actions | Refused | Refused (R-2, R-3) |
| Assigned Manager giving someone an Admin project role | Allowed | Refused (R-4) |
| Custom role without `testcase.create`, AI on | Can generate and save test cases | Refused |
| Custom role with `defect.change_status` but not `testcase.execute` | Can record a retest result | Refused |

**Who is affected in your development database [V, read-only query]:** no project roles are set (0 of 884 memberships) and there is 1 custom role. **[U]** Other deployments, and whether that custom role has `testcase.create` and `testcase.execute`. A report of affected people would be produced before the change is applied.

## 5. Roles

Admin, Manager and Tester keep exactly their current permissions plus `record.contribute`. The last three columns are **new**.

| Permission | Admin | Manager | Tester | QA Lead | Developer | Viewer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| *Projects* | | | | | | |
| `project.view.all` (see every project) | Y | Y | | Y | | |
| `project.create` | Y | Y | | | | |
| `project.edit` | Y | Y | | | | |
| `project.delete` (also archive and restore) | Y | Y | | | | |
| `project.members.manage` | Y | Y | | | | |
| *Work* | | | | | | |
| `task.manage` | Y | Y | | Y | | |
| `task.transition` | Y | Y | Y | Y | Y | |
| `requirement.manage` | Y | Y | | Y | | |
| *Test cases and runs* | | | | | | |
| `testcase.create` | Y | Y | Y | Y | | |
| `testcase.edit` | Y | Y | Y | Y | | |
| `testcase.approve` | Y | Y | | Y | | |
| `testcase.deprecate` | Y | Y | | Y | | |
| `testcase.delete` | Y | Y | | Y | | |
| `testcase.execute` | Y | Y | Y | Y | | |
| `executionstep.record` | Y | Y | Y | Y | | |
| `testcase.export` | Y | Y | Y | Y | | |
| `testcase.bulk_import_export` | Y | Y | Y | Y | | |
| `testrun.create` | Y | Y | Y | Y | | |
| `testrun.finish` | Y | Y | | Y | | |
| `testrun.delete` | Y | Y | | Y | | |
| *Defects* | | | | | | |
| `defect.create` | Y | Y | Y | Y | Y | |
| `defect.edit` | Y | Y | Y | Y | Y | |
| `defect.change_status` | Y | Y | Y | Y | Y | |
| `defect.assign` | Y | Y | | Y | | |
| `defect.close` (also reopen) | Y | Y | | Y | | |
| `defect.delete` | Y | Y | | Y | | |
| `defect.export` | Y | Y | | Y | Y | |
| `defect.import` | Y | Y | Y | Y | | |
| *Reports and contribution* | | | | | | |
| `report.view` | Y | Y | Y | Y | Y | Y |
| `report.compliance_export` | Y | Y | | Y | | |
| `record.contribute` (new) | Y | Y | Y | Y | Y | |
| *Organization* | | | | | | |
| `environment.manage` (also releases and builds today) | Y | Y | | Y | | |
| `field_customization.manage` | Y | Y | | | | |
| `access_rule.manage`, `audit.view`, `integration.manage`, `report.schedule_manage`, `sso.manage`, `task_status.manage`, `tenant.settings.manage`, `user.erase`, `user.manage` | Y | | | | | |

What this means for the new roles:

- **QA Lead** counts as the manager tier, so sees all projects. It cannot create, edit, delete or staff projects. QA sign-off comes with release management (Phase 6). `environment.manage` is organization-wide and also covers releases and builds [V]; remove it if a QA Lead should not manage those.
- **Developer** and **Viewer** count as the tester tier: only their own projects. The organization's tester restrictions ("assigned test cases only", "hide reports") therefore apply to them too.
- **Developer** can update any defect in their projects, not only ones assigned to them: permissions cannot express "assigned only". They cannot close or reopen, run tests, or record a retest result (R-8).
- **Viewer** reads. It also keeps personal things (own saved views, dashboards, notifications).

## 6. How it would be built [R]

1. Tests that reproduce P-1 to P-6.
2. One policy function (user, project, action) and a full **role × action × project role** test, written from section 5 before the services change.
3. Move the tier checks to it module by module (about 40 places [V]).
4. Move the project routes to the project-aware check; the route record test shows every change for review.
5. Add `record.contribute` and the three roles in one migration that grants the new code to all existing roles.
6. A script listing the people whose access changes, to run before upgrading.

Complexity **High**: it touches most write paths.

## 7. Decisions needed

| # | Question | Recommendation |
|---|---|---|
| 1 | Approve rules R-1 to R-8? | Yes |
| 2 | Approve the three new roles as in section 5? | Yes |
| 3 | Should QA Lead see **all** projects? The alternative is only assigned ones, but then tester restrictions would apply to them | All projects |
| 4 | Should QA Lead keep `environment.manage` (environments, releases, builds)? | Yes |
| 5 | Fix P-4 (AI generation) now, ahead of the rest? It is small and separate | Yes |

## 8. As built

- The decision is made once per request instead of moving each service rule (section 6, steps 3 and 4). Routes that name the project outside the address ask explicitly.
- R-8 covers recording a retest result. **Open:** a Developer can still set a defect to Verified through the status workflow, which needs only `defect.change_status`. Closing that needs a further decision.
- The interface still chooses buttons from the organization role; the server applies the project role.
