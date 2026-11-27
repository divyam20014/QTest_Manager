# QTestHub: Risk Register

Likelihood and impact: **H / M / L**. Ratings are judgement **[R]**. "Basis" says whether the underlying fact is verified **[V]**, or the risk is anticipated **[R]** or uncertain **[U]**. Phase numbers refer to the [Roadmap](QTESTHUB_IMPLEMENTATION_ROADMAP.md).

| ID | Type | Risk | L | I | Basis | Mitigation | Phase |
|---|---|---|---|---|---|---|---|
| R-01 | Functional / compliance | Executed test history is rewritten after deprecating a case; audit evidence becomes unreliable. Editing steps crashes | M | **H** | [V] reproduced (F-01) | Block or fork on every edit of an executed version; trigger backstop; search audit logs for `testcase.updated` after `testcase.deprecated` to find records already affected | 0 |
| R-02 | Functional | A release is approved from figures that describe the whole project | **H** | **H** | [V] F-02 | Relabel now; scoped readiness and sign-off later | 0, 6 |
| R-03 | Functional / data | Users silently overwrite each other; unseen content is approved. Grows with team size | **H** | H | [V] code; [U] not reproduced (F-04) | `row_version`, 409, row locks, form keeps opened copy | 0 |
| R-04 | Operational / docs | The docs sync overwrites recent documentation and decision records | M | M | [V] F-08 | Copy served edits back to `docs/` first; run the sync check in CI | 0 |
| R-05 | Quality | Hidden regressions: full suites not run to completion, no CI found, some tests flaky or time-sensitive, failures under low memory | **H** | H | [V] | Run both suites, fix or quarantine with owners, add CI before feature work | 0 |
| R-06 | Compliance | A "full" data export or a data subject request misses data | M | H | [V] F-05 | Complete the export; coverage test | 0 |
| R-07 | Security | A new table ships without RLS, grants or isolation tests | M | **H** | [R]; current exceptions [V] | Generated schema test; migration checklist; review of existing exceptions | all |
| R-08 | Security | A reference to another tenant's record is accepted because keys do not include the tenant and a service check is missed | L | **H** | [V] design; [U] no exploit attempted | Composite or trigger checks on new tables; API tests using foreign IDs | 0 onward |
| R-09 | Security | Project role override gives different results at route and service level, especially once project-specific roles are sold | M | H | [V] F-06 | Unify policy before new roles; approved permission matrix | 1 |
| R-10 | Security | Cross-site request forgery on the tenant plane if cookie rules are weakened or a sibling subdomain is hostile | L | M | [V] no token or origin check found | Origin / fetch-metadata check | 0–1 |
| R-11 | Security | Malicious uploaded files reach users | M | H | [V] no scanner found | Scanning; confirm download headers | 9 (earlier if files are shared externally) |
| R-12 | Security | Rate limits multiply with more processes or servers | M | M | [V] in-memory store | Proxy limits or shared store | 9 |
| R-13 | Security / AI | AI context includes records the user may not see, or text in a record steers the model | M | H | [R]; [U] current scoping not audited | Permission-scoped context, injection tests, human review | 8 (audit current features earlier) |
| R-14 | Migration | Making project fields optional breaks reports, exports or screens that assume values | **H** | M | [V] fields mandatory; [U] impact not traced | Trace every use; test with empty values | 1 |
| R-15 | Migration | Renamed or removed keys in saved layouts, views or widgets break reads; a rejected project layout stops the project loading | M | H | [V] ADR-130, ADR-131 | Translate old keys; test with stored old documents | all |
| R-16 | Migration | Back-filling run environment/build or link versions with guesses falsifies history | M | H | [R] | Leave NULL and show "not recorded" | 3, 4 |
| R-17 | Migration | Running tests or migrations against a server with other role passwords locks the application out | L | H | [V] F-11; browser runner handles it, backend tests do not | Make backend tests use the stack's passwords; use a separate server in CI | 0 |
| R-18 | Migration | Failed or irreversible migration in production | M | H | [U] production stack not exercised | Backup, rehearsal on a copy, expand/contract, written rollback | all |
| R-19 | Recovery | Backups cannot be restored, or attachments are not restored with the database | M | **H** | [V] scripts in two places; [U] no drill seen | One script set; scheduled restore drills; stated targets | 0 for the drill, 9 |
| R-20 | Deployment | The production compose, proxy or content security policy fails on first real use | M | H | [U] not run here | Build and test it in CI or staging | 0–1 |
| R-21 | Performance | Backlog, boards, trees, readiness and sprint reports slow down as projects grow | M | M | [V] known limits; [U] no load test now | Agree targets; paginate from the start; load tests per phase | 2, 6, 7 |
| R-22 | Product | Scope grows into a general work-management suite and the testing strength weakens | **H** | H | [R] | Keep the out-of-scope list; every project feature must serve the trace chain | all |
| R-23 | Product | Insurance wording and defaults confuse the new market, or removing them upsets existing insurance users | M | M | [V] F-07, master spec | Decision D-3; domain as optional configuration; keep the insurance pack | 1 |
| R-24 | Product | Features are built that nobody uses. In the current development data many advanced features have no records, but the data is too small to judge | M | M | [V] counts on 2026-11-26; weak evidence | Interview target SMEs before Phases 2 and 6; switches per tenant | 1–6 |
| R-25 | Product / UX | More modules make navigation heavy again | M | M | [R] | Place features inside current tabs; role presets | all |
| R-26 | Data | Sprint, readiness and utilisation history cannot be rebuilt if not recorded from the start | M | H | [R] | History and snapshot tables in the phase that introduces the feature | 2, 6 |
| R-27 | Privacy | Time logs and utilisation are sensitive personal data in some places | M | M | [U] legal needs unknown | Restrict visibility; confirm purpose and retention; allow turning off | 6 |
| R-28 | Maintainability | Very large screens and service files slow changes and cause regressions | M | M | [V] | Split when a phase changes them, not as a separate rewrite | all |
| R-29 | Delivery | Team size, hosting, customers and deadlines are unknown, so phase sizing may be wrong | M | M | [U] | Confirm before planning dates | 0 |

## Status after 2026-11-27

- **R-01:** fixed in the service (ADR-135). Direct database changes are not blocked.
- **R-04:** documentation reconciled; the backend tests include the sync check.
- **R-02:** reduced. Figures are labelled whole-project (ADR-137); per-release readiness is still missing.
- **R-03:** reduced for test cases, defects and approval (ADR-136). Tasks, requirements and releases remain.
- **R-06:** export completed, with a coverage test (ADR-138). Large-tenant memory use is unmeasured.
- **R-07:** reduced by the schema isolation and route guard tests.
- **R-30 (new, security, L likelihood, M impact, [V] code reading):** AI test case generation does not require `testcase.create` (F-12). Mitigation: require it on the route and test it.
- **R-05:** partly reduced. Backend and frontend suites have been run; the browser suite has not, and CI has not yet run.

## Top five

R-02, R-01, R-03, R-05, R-07. The first three affect whether the product's evidence can be trusted.
