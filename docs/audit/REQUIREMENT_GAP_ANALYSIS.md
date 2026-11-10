# QTestHub — Requirement Gap Analysis

One row per requirement, across all four ID schemes this project maintains, with no omissions. See `IMPLEMENTATION_STATUS.md` for scheme-level summaries and `TECHNICAL_FINDINGS.md` for architecture-level findings. Status values used: **Implemented**, **Partially Implemented**, **Not Implemented**, **Blocked**, **Not Verifiable** (exactly one per row, per audit instructions).

Verification method key used in the Evidence column: **[E2E]** = traced UI component → `api/*.ts` → FastAPI route → service function → model/migration in this audit; **[Code]** = source file(s) directly opened and read in this audit; **[Doc+Test]** = corroborated via the project's own ADR/test citations plus a direct existence check, not a full independent re-trace (used for the bulk of the 97 BR rows and the long hardening-pass tail, given the scale — full E2E tracing of all 250 rows is not practical, consistent with this audit's own stated method).

---

## Section 1 — BR-NN (original BRD, source: `REQUIREMENT_TRACEABILITY.md`)

| Requirement ID | Module | Requirement Description | Implementation Status | Evidence (File/API/Component) | Gap/Observation |
|---|---|---|---|---|---|
| BR-01 | Auth/Tenancy | Multi-tenant logical isolation | Implemented | [E2E] `tenants` table, RLS on all tenant tables, session-derived `tenant_id` (`app/core/auth.py`), `test_cross_tenant_isolation_on_user_list` (real Postgres). | Traceability doc's own row still says "no frontend yet" — stale; app shell/login flow is fully frontend-complete per Phase 10. Doc defect, not code defect. |
| BR-02 | Auth/RBAC | Role-Based Access Control | Implemented | [Doc+Test] `users`/`roles`/`permissions`, `UsersRoles.tsx`, `test_full_bootstrap_login_and_me`. | None. |
| BR-03 | Dashboard | Portfolio domain breakdown | Implemented | [Code] `Dashboard.tsx` renders `/dashboard/domain-distribution`; `test_domain_distribution_groups_by_domain`. | Same stale "no frontend yet" caveat as BR-01 — contradicted by the row's own Frontend Module column (`Dashboard.tsx`). |
| BR-04 | Project Mgmt | Insurance project budget & dates | Implemented | [Doc+Test] `projects` table, `ProjectsList.tsx`/`ProjectDetail.tsx`. | None. |
| BR-05 | Test Case Mgmt | Step-by-step test case authoring | Implemented | [Doc+Test] `test_cases`/`test_case_versions`/`test_case_version_steps`, `TestCaseForm.tsx`. | None. |
| BR-06 | CSV Import | CSV bulk import with step parsing | Implemented | [Doc+Test] `ImportDialog.tsx`, `/test-cases/import`. | Perf NFR (2.5s/2000 rows) measured flaky on dev hardware — see `KNOWN_GAPS.md` GAP-69, tracked in Technical Findings. |
| BR-07 | Test Case Mgmt | Two-tier test case approval | Implemented | [Doc+Test] `TestCaseDetail.tsx`, `/test-cases/{id}/approve`. | None. |
| BR-08 | Test Execution | Interactive run execution runtime | Implemented | [Doc+Test] `test_runs`/`test_run_cases`, `TestRunDetail.tsx`. | None. |
| BR-09 | Test Execution | Execution timing instrumentation | Implemented | [Doc+Test] `execution_steps.duration_ms`, `ExecutionConsole.tsx`. | None. |
| BR-10 | Execution/Defects | In-run atomic step-defect linking | Implemented | [Doc+Test] `DefectQuickCreateDialog.tsx`, `POST /defects`. | None. |
| BR-11 | Defects | Defect lifecycle tracking | Implemented | [Doc+Test] `defects`, `/defects/{id}/status`. | None. |
| BR-12 | Reporting | Multi-axis BI charts & export | Implemented | [Doc+Test] `Reporting.tsx`, `/reports/aggregate`. | A real "10000% double-percentage" display bug was found and fixed during live verification (Phase 10.7) — resolved, noted here only as audit trail. |
| BR-13 | Audit | Immutable compliance audit logging | Implemented | [Doc+Test] `audit_logs` hash chain, `/audit-logs/verify-chain`. | None. |
| BR-14 | Platform Admin | Platform tenant bootstrap | Implemented | [Doc+Test] ADR-008. | None. |
| BR-15 | Test Execution | Test case version pinning on execution | Implemented | [Doc+Test] ADR-003. | None. |
| BR-16 | Compliance | GDPR pseudonymization flow | Implemented | [Doc+Test] ADR-009. | Full physical erasure not implemented (by design — see GAP-03); pseudonymization only. |
| BR-17 | Auth | MFA challenge lifecycle (real/simulated) | Implemented | [Doc+Test] ADR-011. | Only email-based "real" delivery; no SMS/push/hardware key (GAP-04, by design). |
| BR-18 | Attachments | Attachment storage (filesystem + metadata) | Implemented | [Code] `attachment_service.py`, `attachments` table. | Local filesystem only — blocks horizontal scaling (GAP-07/SAAS-GAP-3, open). |
| BR-19 | Auth | Login requires explicit tenant_id | Implemented | [Doc+Test] ADR-017. | None. |
| BR-20 | Project Mgmt | Team member allocation to projects | Implemented | [Doc+Test] ADR-018. | None. |
| BR-21 | Test Execution | `testrun.finish` sign-off gate | Implemented | [Doc+Test] ADR-022. | None. |
| BR-22 | Test Execution | Only approved test cases bundled into a run | Implemented | [Doc+Test] ADR-025. | None. |
| BR-23 | Defects | Multi-criteria defect filtering | Implemented | [Doc+Test] FR-DEF-002. | None. |
| BR-24 | Defects | Strictly sequential status transitions, no reopen | Implemented | [Doc+Test] ADR-026. | This is also the reason PV-6.3 (reopened-defect analysis) is structurally blocked — a deliberate trade-off, not an oversight. |
| BR-25 | Dashboard | Real-time KPI dashboard cards | Implemented | [Doc+Test] FR-DASH-001. | None. |
| BR-26 | Dashboard | Recent operational activity stream | Implemented | [Doc+Test] FR-DASH-003. | None. |
| BR-27 | Reporting | CSV compliance export | Implemented | [Doc+Test] FR-REP-002. | None. |
| BR-28 | Reporting | Reporting/Dashboard scope + metric definitions | Implemented | [Doc+Test] ADR-027. | None. |
| BR-29 | Security | Full-system cross-tenant RLS isolation sweep | Implemented | [Code] 7 migrations confirmed with `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + `tenant_isolation` policy, including the newest notifications/requirements/comments/AI tables. | None. |
| BR-30 | Audit | Audit hash-chain integrity, cross-module | Implemented | [Doc+Test] extends BR-13. | None. |
| BR-31 | Security | Backend security review | Implemented | [Doc+Test] `Security_Test_Report.md` (73 passing tests). | One finding in that report itself was stale (content-sniffing already fixed, report not updated) — corrected per GAP-70/SAAS-GAP-17. |
| BR-32 | Project Mgmt | `GET /users` directory readable by Manager | Implemented | [Doc+Test] ADR-028. | None. |
| BR-33 | Test Execution | `GET /projects/{id}/test-runs` list endpoint | Implemented | [Doc+Test] — | None. |
| BR-34 | Defects | `GET /defects?test_run_id=` scoped filter | Implemented | [Doc+Test] GAP-20. | None. |
| BR-35 | Audit | `audit.view` permission gating audit endpoints | Implemented | [Doc+Test] ADR-029. | None. |
| BR-36 | QA/Testing | Playwright E2E across BRD Journeys 1-4 + WCAG scan | Implemented | [Doc+Test] Phase 10.9. | Accessibility scan scope was `serious`/`critical` only, not full WCAG certification (GAP-22, explicit scope limit). |
| BR-37 | Security | Rate limiting on login/MFA-verify | Implemented | [Code] `app/core/rate_limit.py`, applied in `app/api/auth.py`. | Scope is narrow — only these 2 endpoints (SAAS-GAP-6, still open as its own SR item). |
| BR-38 | Security | Row-locked MFA attempt-count race fix | Implemented | [Doc+Test] GAP-17. | None. |
| BR-39 | Security | Dependency vulnerability scanning | Implemented | [Doc+Test] GAP-19. | `starlette` CVEs remain (need a `fastapi>=0.140.0` major-version upgrade, deliberately deferred as its own dedicated effort). |
| BR-40 | Infra | Structured backend request logging | Implemented | [Doc+Test] ADR-031. | Plain-text, not JSON; no correlation/request ID (SAAS-GAP-18, still open as its own SR item: SR-6.6). |
| BR-41 | Infra | Docker health checks + restart policy | Implemented | [Doc+Test] ADR-031. | None. |
| BR-42 | Infra/Security | DB credentials externalized via `.env` | Implemented | [Doc+Test] GAP-11. | None. |
| BR-43 | UI | UI shell completion (breadcrumb, bell, profile menu) | Implemented | [Doc+Test] — | Notification bell was, at the time of this BR, an honest empty-state placeholder; since superseded by BR-97/Phase 9's real implementation. |
| BR-44 | Auth | Suspended/Pending tenant enforced at login + per-request | Implemented | [Doc+Test] ADR-032/GAP-23. | None. |
| BR-45 | Auth | Admin-initiated password reset, revokes sessions | Implemented | [Doc+Test] ADR-032/GAP-24. | No self-service reset (deliberate scope decision). |
| BR-46 | Auth | Idle/sliding session timeout | Implemented | [Doc+Test] ADR-032/GAP-25. | None. |
| BR-47 | Auth | Real (SMTP) MFA delivery mode | Implemented | [Doc+Test] ADR-032. | Email only (GAP-04). |
| BR-48 | Platform Admin | Platform Administration frontend screen | Implemented | [Doc+Test] GAP-26. | Success path (create/approve/suspend) not live-click-verified in that session, per the gap's own note — backed by API-level tests instead. |
| BR-49 | Project Mgmt | Project portfolio search/filter/sort/pagination | Implemented | [Doc+Test] ADR-033/GAP-27. | None. |
| BR-50 | Project Mgmt | Project-level metrics (counts) | Implemented | [Doc+Test] ADR-033/GAP-28. | None. |
| BR-51 | Project Mgmt | Broadened project-deletion guard | Implemented | [Doc+Test] ADR-033/GAP-29. | Fixed a genuine pre-existing bug (raw FK IntegrityError) — resolved. |
| BR-52 | Project Mgmt | `manager_user_id` FK alongside `manager_name` | Implemented | [Doc+Test] ADR-033/GAP-30. | `manager_name` free-text kept as-is by design. |
| BR-53 | Test Case Mgmt | Test case repository search/filter/sort/pagination | Implemented | [Doc+Test] ADR-034/GAP-31. | None. |
| BR-54 | Test Case Mgmt | Step reorder + duplicate-step controls | Implemented | [Doc+Test] GAP-32. | None. |
| BR-55 | Test Case Mgmt | Version comparison/diff | Implemented | [Doc+Test] ADR-034/GAP-33. | None. |
| BR-56 | Test Case Mgmt | `description` field, versioned | Implemented | [Doc+Test] ADR-034/GAP-34. | None. |
| BR-57 | Test Case Mgmt | Assignee wired into form/list/filter | Implemented | [Doc+Test] ADR-034/GAP-35. | None. |
| BR-58 | Test Case Mgmt | `deprecated` status reachable via new endpoint | Implemented | [Doc+Test] ADR-034/GAP-36. | None. |
| BR-59 | Attachments | Attachment file-type allowlist | Implemented | [Doc+Test] ADR-034/GAP-37. | Extension-only at this point — later hardened to magic-byte sniffing (GAP-66/BR-87). |
| BR-60 | CSV Import | Duplicate-title detection | Implemented | [Doc+Test] ADR-035/GAP-38. | Scoped to CSV import only, not a DB-level constraint (deliberate). |
| BR-61 | CSV Import | 2,000-row cap enforced server-side | Implemented | [Doc+Test] ADR-035/GAP-39. | Perf NFR under this cap is flaky on dev hardware (GAP-69). |
| BR-62 | CSV Import | Downloadable CSV error report | Implemented | [Doc+Test] ADR-035/GAP-40. | None. |
| BR-63 | CSV Import | File validation (extension/empty/size) | Implemented | [Doc+Test] ADR-035/GAP-41. | None. |
| BR-64 | CSV Import | Test coverage: empty/special-char/concurrent | Implemented | [Doc+Test] GAP-42. | Concurrency test is thread-based against a shared TestClient, not a full multi-process load test — acceptable for current scale per the gap's own note. |
| BR-65 | Test Execution | Execution Console context header | Implemented | [Doc+Test] ADR-036/GAP-43. | None. |
| BR-66 | Test Execution | Live elapsed-time display | Implemented | [Doc+Test] ADR-036/GAP-44. | None. |
| BR-67 | Test Execution | Edit run name/type; add/remove cases pre-execution | Implemented | [Doc+Test] ADR-036/GAP-45. | None. |
| BR-68 | Test Execution | Assign execution responsibility per run case | Implemented | [Doc+Test] ADR-036/GAP-46. | None. |
| BR-69 | Test Execution | Run-level pause/resume | Implemented | [Doc+Test] ADR-036/GAP-47. | None. |
| BR-70 | Test Execution | Keyboard shortcuts + sticky control bar | Implemented | [Doc+Test] GAP-48. | None. |
| BR-71 | Test Execution | Concurrency fix: run-case status rollup race | Implemented | [Doc+Test] ADR-036/GAP-49. | Genuine bug found and fixed via a new concurrency test — resolved. |
| BR-72 | Defects | Fail-time dialog prepopulation + editable title | Implemented | [Doc+Test] ADR-037/GAP-50. | None. |
| BR-73 | Defects | Link-to-existing-defect in Fail-time dialog | Implemented | [Doc+Test] ADR-037/GAP-51. | None. |
| BR-74 | Defects | Actual/Expected Result + Environment fields | Implemented | [Doc+Test] ADR-037/GAP-52. | `Environment` is free text, not a dedicated entity — tracked separately as PV-8.1 (Not Implemented). |
| BR-75 | Defects | Defect history/timeline | Implemented | [Doc+Test] ADR-037/GAP-53. | Reuses generic audit log, not a bespoke timeline — tracked separately as PV-9.3 (Not Implemented). |
| BR-76 | Defects | Execution evidence + version + step link on defect detail | Implemented | [Doc+Test] ADR-037/GAP-54. | None. |
| BR-77 | Defects | Reporter + date-range filters | Implemented | [Doc+Test] ADR-037/GAP-55. | None. |
| BR-78 | Defects | Verification-confirmation checkbox on Close; reverse nav | Implemented | [Doc+Test] ADR-037/GAP-56, GAP-57. | None. |
| BR-79 | Reporting | Report filters (project/domain/assignee/date/priority/status) | Implemented | [Doc+Test] ADR-038/GAP-58. | None. |
| BR-80 | Reporting | Browser print/PDF compliance view | Implemented | [Doc+Test] ADR-027/ADR-038/GAP-59. | No server-generated PDF — browser-print fallback only, matching the spec's own wording (deliberate). |
| BR-81 | Reporting | Pie/Donut toggle + Execution Trends line chart | Implemented | [Doc+Test] ADR-038/GAP-60. | None. |
| BR-82 | Reporting | Dashboard KPI cards expansion | Implemented | [Doc+Test] ADR-038/GAP-61. | None. |
| BR-83 | Reporting | Compliance CSV: period header + detail tables | Implemented | [Doc+Test] ADR-038/GAP-62. | None. |
| BR-84 | Reporting | Assignee-grouping disclosure | Implemented | [Doc+Test] GAP-63. | None. |
| BR-85 | Reporting | Compliance export accuracy tests | Implemented | [Doc+Test] GAP-64. | None. |
| BR-86 | Audit/Admin | Audit log detail view, filters, export, My Account, reactivate | Implemented | [Doc+Test] ADR-039/GAP-65. | None. |
| BR-87 | Security | Content-sniffing, idempotency keys, optimistic concurrency | Implemented | [Code] `attachment_service.py` magic-byte checks; `idempotency_keys` table (migration `d8e9f0a1b2c3`, confirmed to exist with RLS). | Optimistic concurrency (`expected_version`) scoped to `projects` only, not replicated to other resources (deliberate, per GAP-68's own note). |
| BR-88 | Infra/SaaS hygiene | Exception handler, `/ready`, responsive UI, a11y, Defects quick-create | Implemented | [Code] `app/main.py:104` (`Exception` handler), `:142` (`/ready`); `AppShell.tsx` collapsed state; `DefectsList.tsx:59` New Defect button — all directly confirmed. | None. |
| BR-89 | SaaS Governance | Tenant self-service settings | Implemented | [Code] `backend/app/api/settings.py`, `backend/app/services/settings_service.py` confirmed present; ADR-043. | Scope is narrow (currency/timezone + later AI fields) — not a general settings framework (deliberate, see ADR-043's own note on avoiding a speculative JSONB/EAV blob). |
| BR-90 | Requirements Mgmt | Requirement entity + versioning + RTM/coverage | Implemented | [Code] `backend/app/models/requirement.py`, `backend/app/services/requirement_service.py` confirmed present; ADR-044. | No cross-project Requirements overview page and no approval workflow — deliberate scope match to Test Cases' own precedent. |
| BR-91 | AI | AI Test Case Generator | Implemented | [Code] `backend/app/core/ai/` (`base.py`, `gemini_provider.py`, `registry.py`) confirmed present; ADR-045. | Gemini-only provider implementation (abstraction is provider-agnostic, but only one concrete implementation exists). |
| BR-92 | AI | AI Test Case Reviewer | Implemented | [Doc+Test] ADR-046, reuses confirmed `app/core/ai/` layer. | None. |
| BR-93 | AI | AI Requirement Change Analyzer | Implemented | [Doc+Test] ADR-047, reuses confirmed `app/core/ai/` layer and confirmed `requirement.py` model. | None. |
| BR-94 | Defect Intelligence | Root-cause taxonomy, aging/SLA, trend analytics | Implemented | [Doc+Test] ADR-048. | Duplicate-detection and external tracker sync remain separately tracked as PV-6.1/6.6 (Not Implemented). |
| BR-95 | Attachments | Attachment wiring to Defect + ExecutionStep | Implemented | [Doc+Test] ADR-049. | `test_case_version` deliberately left unwired. |
| BR-96 | Collaboration | Comments + explicit @-mentions | Implemented | [Code] `backend/app/api/comments.py` confirmed present; ADR-050. | None. |
| BR-97 | Collaboration | Real notifications (in-app + email) | Implemented | [Code] `backend/app/api/notifications.py`, `backend/app/models/notification.py`, `backend/app/services/notification_service.py`, `frontend/src/api/notifications.ts` all confirmed present; migration `e5f6a7b8c9d0` confirmed with RLS; ADR-051. | 3 bounded trigger events only (mention, assignment, defect closure), not a generic rules engine (deliberate). |

**BR section total: 97/97 Implemented (100%).**

---

## Section 2 — PV-N (AI/SaaS vision, source: `PRODUCT_VISION.md`)

| Requirement ID | Module | Requirement Description | Implementation Status | Evidence (File/API/Component) | Gap/Observation |
|---|---|---|---|---|---|
| PV-1.1 | Requirements Mgmt | Requirement entity (create/edit/version) | Implemented | [Code] `backend/app/models/requirement.py` confirmed present. | None. |
| PV-1.2 | Requirements Mgmt | Requirement → Test Case mapping | Implemented | [Doc+Test] `RequirementTestCaseLink`, ADR-044. | None. |
| PV-1.3 | Requirements Mgmt | RTM / coverage % | Implemented | [Doc+Test] `GET /projects/{id}/requirements/coverage`. | None. |
| PV-1.4 | Requirements Mgmt | `REQUIREMENT_TRACEABILITY.md` as a product feature | Not Verifiable | [Doc+Test] — this is a scope-clarification note in the source document, not an actual requirement to implement (that file is an internal delivery-tracking document, not a user-facing feature). | Not a real gap; flagged as Not Verifiable rather than invented a verdict for a non-requirement. |
| PV-3.1 | AI | AI Test Case Generator | Implemented | [Code] `app/core/ai/`, `POST /requirements/{id}/generate-test-cases`; ADR-045. | None. |
| PV-3.2 | AI | AI Test Case Reviewer | Implemented | [Doc+Test] `POST /test-cases/{id}/ai-review`; ADR-046. | None. |
| PV-3.3 | AI | Requirement Change Analyzer | Implemented | [Doc+Test] `POST /requirements/{id}/analyze-change`; ADR-047. | None. |
| PV-3.4 | AI | AI QA Assistant (chat-style helper) | Not Implemented | [Code] grep for assistant/chat-style AI endpoints found none. | Deliberately unscheduled — user's own note only committed to 3 of 5 original AI capabilities; needs its own future proposal. |
| PV-3.5 | AI | AI Defect Assistant | Not Implemented | [Code] same grep. | Same — deliberately unscheduled. |
| PV-3.6 | AI | Provider SDK / credential storage / usage metering | Implemented | [Code] `gemini_provider.py` (REST via `httpx`, no vendor SDK); `app/core/crypto.py` Fernet encryption (referenced); `ai_usage_logs` table (migration `b2c3d4e5f6a7`, confirmed RLS). | None. |
| PV-3.7 | AI | Tenant-level AI settings | Implemented | [Code] extends `settings.py`/`settings_service.py` (confirmed present). | None. |
| PV-5.1 | Automation | Webhook endpoints (inbound result ingestion) | Not Implemented | [Code] no webhook routes found in `backend/app/api/`. | Fully greenfield; `DEVELOPMENT_ROADMAP.md` Phase 12, not started. |
| PV-5.2 | Automation | CI tool integration | Not Implemented | [Code] no integration code found. | Same, Phase 12. |
| PV-5.3 | Automation | Machine-to-machine auth plane | Not Implemented | [Code] only session-cookie and platform-admin Basic auth exist — confirmed, no API-key/service-token mechanism. | Most structurally significant item in Release 2 — needs its own security review before any webhook work can start (correctly sequenced first in the roadmap). |
| PV-6.1 | Defect Intelligence | Duplicate defect detection (similarity) | Not Implemented | [Code] only a manual `duplicate_of` tag on `DefectLink`; no similarity algorithm in `defect_service.py`. | Not scheduled in any phase yet. |
| PV-6.2 | Defect Intelligence | Defect aging / SLA-breach tracking | Implemented | [Doc+Test] `age_days`/`sla_breached` on `DefectOut`; ADR-048. | None. |
| PV-6.3 | Defect Intelligence | Reopened-defect analysis | Blocked | [Code] `defect_service.py` enforces ADR-026's strictly-forward status sequence — no "reopened" state exists in the schema. | Structural block: requires an explicit schema/design decision to reverse a prior deliberate design choice, not just an analytics addition. `DEVELOPMENT_ROADMAP.md` Phase 13, pending approval. |
| PV-6.4 | Defect Intelligence | Root cause categorization | Implemented | [Doc+Test] `Defect.root_cause`, ADR-048. | None. |
| PV-6.5 | Defect Intelligence | Defect trend analytics | Implemented | [Doc+Test] `GET /reports/defect-trend`, ADR-048. | None. |
| PV-6.6 | Defect Intelligence | External tracker sync (Jira/ADO) | Not Implemented | [Code] no integration code found. | Not scheduled. |
| PV-7.1 | QA Manager Intel | Release-readiness score / rule engine | Not Implemented | [Code] no `readiness`/`release_risk` logic in `reporting_service.py`. | `DEVELOPMENT_ROADMAP.md` Phase 15, pending Phase 14. |
| PV-7.2 | QA Manager Intel | Assignee-wise workload reporting | Partially Implemented | [Code] generic Aggregate Report groupby covers it as a slice, not a purpose-built view. | A dedicated workload/capacity view would need new UI/queries, not just reuse. |
| PV-7.3 | QA Manager Intel | Module/folder-level quality rollups | Blocked | [Code] `TestCase` has no module/folder/tag field — confirmed, test cases are flat per-project. | Needs a schema addition (`DEVELOPMENT_ROADMAP.md` Phase 14) before any rollup reporting can exist. |
| PV-7.4 | QA Manager Intel | Flaky-test / regression-stability analytics | Not Implemented | [Code] only `get_execution_trend` (30-day pass/fail) exists; no run-over-run stability detection. | Phase 15, pending Phase 14. |
| PV-8.1 | Test Assets | Environment entity | Not Implemented | [Code] `environment` is a free-text `String` on `Defect`; no dedicated entity. | `DEVELOPMENT_ROADMAP.md` Phase 11. |
| PV-8.2 | Test Assets | Build/Release tracking entity | Not Implemented | [Code] no `Build`/`Release` model found. | Phase 11. |
| PV-8.3 | Test Assets | Test data repository / masking / synthetic data | Not Implemented | [Code] no trace of this capability anywhere. | Largest remaining greenfield item in this module; not scheduled with a concrete phase beyond "Phase 11+". |
| PV-8.4 | Test Assets | Attachments beyond Test Case | Implemented | [Doc+Test] `Defect`/`ExecutionStep` wired per ADR-049. | `test_case_version` deliberately unwired. |
| PV-9.1 | Collaboration | Comments / mentions | Implemented | [Code] `backend/app/api/comments.py` confirmed present; ADR-050. | None. |
| PV-9.2 | Collaboration | Real notifications | Implemented | [Code] confirmed present (see BR-97 evidence); ADR-051. | None. |
| PV-9.3 | Collaboration | Per-entity activity timeline (beyond audit-log reuse) | Not Implemented | [Code] Defect History card is a direct `audit_logs` reuse, not a bespoke timeline. | `DEVELOPMENT_ROADMAP.md` Phase 10, not started. |
| PV-9.4 | Collaboration | Review-request / approval workflow | Not Implemented | [Code] no generic review-request mechanism found. | Not currently scheduled in any phase. |
| PV-9.5 | Collaboration | Tenant-configurable statuses/severities/priorities | Not Implemented | [Code] all are hardcoded `CheckConstraint` enums — confirmed by the status-sequence logic read for BR-24/PV-6.3. | Deliberately sequenced last (Phase 22) — most structurally invasive item in the roadmap. |
| PV-9.6 | Collaboration | Custom fields (EAV/extensibility) | Not Implemented | [Code] `audit_logs.event_metadata` is the only JSONB column anywhere, and it's audit-specific. | Phase 22, same reasoning as PV-9.5. |
| PV-9.7 | Collaboration | Tenant settings infrastructure | Implemented | [Code] `backend/app/api/settings.py` confirmed present; ADR-043. | **Conflict resolved**: `PRODUCT_VISION.md` itself lists this row as `Missing`, contradicting its own PV-3.7 evidence text a few lines earlier. This audit corrects the verdict to Implemented based on direct code read — `PRODUCT_VISION.md` needs a documentation fix. |
| PV-10.1 | Insurance Pack | Domain template library | Not Implemented | [Code] only the fixed 5-value `Project.domain` enum exists; no template library. | Explicitly optional; `DEVELOPMENT_ROADMAP.md` Phase 23, sequenced last. |
| PV-11.1 | Enterprise SaaS | SSO (SAML/OIDC) | Not Implemented | [Code] grep for `saml\|oidc\|sso` found zero matches in application code. | Phase 19, needs a dedicated security review before approval. |
| PV-11.2 | Enterprise SaaS | SCIM provisioning | Not Implemented | [Code] grep for `scim` found zero matches. | Phase 20, depends on Phase 19 (SSO). |
| PV-11.3 | Enterprise SaaS | IP restriction/allowlisting | Not Implemented | [Code] existing IP-keyed rate limiter confirmed to be purely a rate-limit key (`app/core/rate_limit.py`), not a reusable allow/deny mechanism. | Phase 18. |
| PV-11.4 | Enterprise SaaS | Tenant branding | Not Implemented | [Code] `Tenant` model has no logo/custom-domain/white-label field (only name/status/currency/timezone/created_at). | Phase 16, reuses the Phase 1 settings mechanism. |
| PV-11.5 | Enterprise SaaS | Tenant-wide data export | Not Implemented | [Code] only a per-user GDPR-erase action exists — erasure, not export; not tenant-wide. | Phase 17. |
| PV-11.6 | Enterprise SaaS | Data residency readiness | Not Implemented | [Code] no `region`/`geography`/`residency` concept on `Tenant` or deployment config (`Project.region` is unrelated business metadata). | Phase 21, mostly infra/deployment-topology work, not application code. |

**PV section total: 42 rows — 15 Implemented, 1 Partially Implemented, 24 Not Implemented, 2 Blocked, 1 Not Verifiable.**

---

## Section 3 — SR-N.N (SaaS governance scorecard, source: `SAAS_REQUIREMENTS.md`)

| Requirement ID | Module | Requirement Description | Implementation Status | Evidence (File/API/Component) | Gap/Observation |
|---|---|---|---|---|---|
| SR-1.1 | SaaS Architecture | Multiple independent customer organizations | Implemented | [Doc+Test] `Tenant` model, tenant_id-scoped tables; ADR-007. | None. |
| SR-1.2 | SaaS Architecture | Tenant-specific workspaces | Implemented | [Doc+Test] Tenant *is* the workspace by design. | None. |
| SR-1.3 | SaaS Architecture | Tenant-level data isolation | Implemented | [Code] RLS confirmed on 7+ migrations including the newest Phase 1-9 tables. | None. |
| SR-1.4 | SaaS Architecture | Tenant-specific users, roles, permissions | Partially Implemented | [Doc+Test] Users/role-assignment tenant-scoped; roles themselves are a fixed 3-role global seed. | Intentional BRD-scope decision (GAP-05), not a bug; would need a formal change request. |
| SR-1.5 | SaaS Architecture | Centralized platform administration | Implemented | [Doc+Test] `platform.py`, `PlatformAdmin.tsx`; ADR-008. | None. |
| SR-1.6 | SaaS Architecture | Configurable subscription plans | Not Implemented | [Code] grep for `subscription\|plan_id\|tier\|entitlement` across `backend/app/models`/`api` returned zero matches. | F-classified; genuinely open. |
| SR-1.7 | SaaS Architecture | Future billing/payment integration points | Not Implemented | [Code] same grep, zero stub fields found. | L-classified; not authorized to build the integration itself per governing directive. |
| SR-1.8 | SaaS Architecture | Horizontal scaling / cloud deployment readiness | Partially Implemented | [Code] Backend stateless/env-configured (confirmed); `attachment_service.py` writes to local disk only; `frontend/Dockerfile:12` confirmed still `CMD ["npm","run","dev",...]`. | Both blockers (storage, frontend image) remain genuinely open — see SR-6.1/SR-6.5. |
| SR-1.9 | SaaS Architecture | Clear module boundaries | Implemented | [Doc+Test] `backend/app/{models,schemas,services,api,core}` layering. | None. |
| SR-2.1 | Tenant Mgmt | Tenant registration and provisioning | Implemented | [Doc+Test] `POST /platform/tenants`. | Platform-admin-driven, not self-service (deliberate). |
| SR-2.2 | Tenant Mgmt | Tenant activation/suspension/deactivation | Implemented | [Doc+Test] `PATCH /platform/tenants/{id}/status`. | None. |
| SR-2.3 | Tenant Mgmt | Tenant-specific configuration | Implemented | [Code] `backend/app/api/settings.py` confirmed present; ADR-043. | **Updated from source doc's `Missing`** — resolved by Phase 1, which this audit confirmed in code. Scope is narrow (currency/timezone + AI fields), not a general config framework. |
| SR-2.4 | Tenant Mgmt | Tenant-specific user invitations | Not Implemented | [Code] `backend/app/api/users.py` `create_user` is direct admin-set-password creation; no invite-token endpoints found. | Genuinely open; no later phase addresses it. |
| SR-2.5 | Tenant Mgmt | Tenant-specific project and test data | Implemented | [Doc+Test] full FK chain. | None. |
| SR-2.6 | Tenant Mgmt | Tenant-aware file storage | Implemented | [Doc+Test] path-partitioned per tenant. | Shares one physical volume across tenants (acceptable at current scale per SR-1.8/SR-6.5). |
| SR-2.7 | Tenant Mgmt | Strict server-side tenant authorization | Implemented | [Doc+Test] `tenant_id` derived from session only; ADR-015. | None. |
| SR-2.8 | Tenant Mgmt | Database-level tenant isolation via RLS | Implemented | [Code] same RLS confirmation as SR-1.3. | None. |
| SR-3.1 | Subscription | Plan/tier data model | Not Implemented | [Code] zero code (see SR-1.6). | F-classified. |
| SR-3.2 | Subscription | Subscription lifecycle per tenant | Not Implemented | [Code] zero code. | F-classified. |
| SR-3.3 | Subscription | Configurable entitlements | Not Implemented | [Code] zero code. | L-classified. |
| SR-3.4 | Subscription | Configurable limits with enforcement | Not Implemented | [Code] zero code. | L-classified. |
| SR-3.5 | Subscription | Upgrade/downgrade workflow | Not Implemented | [Code] zero code. | E-classified. |
| SR-3.6 | Subscription | Billing history / invoices | Not Implemented | [Code] zero code. | E-classified. |
| SR-3.7 | Subscription | Payment gateway integration | Not Implemented | [Code] zero code. | Explicitly not authorized to build without separate approval. |
| SR-4.1 | UX | Clean, professional interface | Implemented | [Doc+Test] enterprise redesign (dark sidebar, consistent cards/tables). | None. |
| SR-4.2 | UX | Responsive layouts | Implemented | [Code] `AppShell.tsx` confirmed collapsible via `useState`+`localStorage`; table wrappers switched to `overflow-x-auto` per ADR-041. | **Updated from source doc's `Missing`** — resolved by ADR-041, confirmed in code. |
| SR-4.3 | UX | Collapsible sidebar | Implemented | [Code] `AppShell.tsx:81-106` confirmed `COLLAPSE_STORAGE_KEY`/`useCollapsedPreference`. | **Updated from source doc's `Missing`.** |
| SR-4.4 | UX | Workspace switcher | Partially Implemented | [Doc+Test] cross-tenant switcher architecturally N/A (session is tenant-bound by design); cross-project switcher exists. | Correctly scoped as Partial by the source doc — this audit agrees. |
| SR-4.5 | UX | Global search | Not Implemented | [Code] grep found only page-scoped filters, no command palette/cross-entity search. | E-classified, genuinely open. |
| SR-4.6 | UX | Breadcrumb navigation | Implemented | [Doc+Test] `components/Breadcrumbs.tsx`. | None. |
| SR-4.7 | UX | Contextual actions | Implemented | [Code] `DefectsList.tsx:59` confirmed role-gated "New Defect" button. | **Updated from source doc's `Partial`** — resolved by ADR-041, confirmed in code. |
| SR-4.8 | UX | Reusable components | Implemented | [Doc+Test] `components/ui/` primitives. | None. |
| SR-4.9 | UX | Consistent tables/filters/forms | Implemented | [Doc+Test] verified markup pattern. | None. |
| SR-4.10 | UX | Light and dark themes | Partially Implemented | [Code] dark-mode tokens exist, follow OS preference; no manual in-app toggle (confirmed — not addressed by any later ADR). | Genuinely still open (SAAS-GAP-21, E-classified). |
| SR-4.11 | UX | Notifications and activity feeds | Implemented | [Code] `notifications` table/service/API/frontend confirmed present (Phase 9, ADR-051). | **Updated from source doc's `Partial`** — the bell placeholder this row describes was replaced by a real backend after the doc was written. |
| SR-4.12 | UX | Loading/empty/error/success states | Partially Implemented | [Doc+Test] loading/empty/error states consistent; no toast/confirmation system anywhere (confirmed — not addressed by any later ADR). | Genuinely still open (SAAS-GAP-11, L-classified). |
| SR-4.13 | UX | Accessible components | Implemented | [Doc+Test] `accessibility.spec.ts` extended per ADR-041/GAP-70 to cover Test Repository/Test Runs/Execution Console/Audit Logs/Settings. | **Updated from source doc's `Partial`.** Not independently re-run in this audit; corroborated by the new routes existing and by the ADR's specific bug-fix citation (`aria-expanded` on `AuditLogs.tsx`). |
| SR-4.14 | UX | Minimal clicks for common workflows | Implemented | [Doc+Test] quick-create/inline-action patterns measured for test case creation and fail→defect reporting. | Not every workflow was re-measured (acknowledged scope limit in the source doc, carried forward here). |
| SR-5.1 | Platform Admin | Manage tenants (create/list) | Implemented | [Doc+Test] — | None. |
| SR-5.2 | Platform Admin | View tenant status | Implemented | [Doc+Test] — | None. |
| SR-5.3 | Platform Admin | Activate/suspend tenants | Implemented | [Doc+Test] — | None. |
| SR-5.4 | Platform Admin | Configure subscription plans | Not Implemented | [Code] depends on SR-3 (zero code). | F-classified. |
| SR-5.5 | Platform Admin | Monitor platform usage (cross-tenant) | Not Implemented | [Code] no cross-tenant aggregation endpoint found. | L-classified, genuinely open. |
| SR-5.6 | Platform Admin | View system health | Implemented | [Code] `backend/app/main.py:142` confirmed `GET /api/v1/ready` with a real DB check, distinct from liveness-only `/health`. | **Updated from source doc's `Partial`** — resolved by ADR-041, confirmed in code. |
| SR-5.7 | Platform Admin | Monitor background jobs | Not Implemented | [Code] no background job system exists (confirmed — see SR-6.10). | Structurally blocked on SR-6.10. |
| SR-5.8 | Platform Admin | Review platform-level audit events | Partially Implemented | [Doc+Test] `platform_service.py` confirmed `user_id=None` on platform-action audit entries (GAP-13, unresolved). | Genuinely still open — no individual platform-admin attribution. |
| SR-5.9 | Platform Admin | Platform admin authentication strength | Not Implemented | [Code] `app/core/platform_auth.py` — plain HTTP Basic, no session/MFA (GAP-14, unresolved). | Genuinely still open; highest-privilege credential in the system protected the weakest. |
| SR-5.10 | Platform Admin | Tenant Admin: org settings | Implemented | [Code] same evidence as SR-2.3. | **Updated from source doc's `Missing`.** |
| SR-5.11 | Platform Admin | Tenant Admin: invite/manage users | Partially Implemented | [Code] direct-create exists; no invite flow (same as SR-2.4, unresolved). | Genuinely still open. |
| SR-5.12 | Platform Admin | Tenant Admin: assign roles/permissions | Implemented | [Doc+Test] — | None. |
| SR-5.13 | Platform Admin | Tenant Admin: manage projects | Implemented | [Doc+Test] — | None. |
| SR-5.14 | Platform Admin | Tenant Admin: tenant-specific settings | Implemented | [Code] same evidence as SR-2.3. | **Updated from source doc's `Missing`** (duplicate of SR-2.3/SR-5.10). |
| SR-5.15 | Platform Admin | Tenant Admin: view tenant usage/activity | Partially Implemented | [Doc+Test] audit log exists; no distinct usage dashboard (moot without SR-3 limits). | Genuinely still open. |
| SR-5.16 | Platform Admin | Controlled/audited platform-admin support access | Implemented (by stronger means) | [Doc+Test] no code path from platform-admin auth into tenant data at all (RLS + separate auth plane). | Satisfies the underlying intent (no support-driven data exposure) without literally building an audited break-glass mechanism — acceptable per the source doc's own reasoning. |
| SR-6.1 | Cloud Readiness | Dockerized application | Partially Implemented | [Code] `frontend/Dockerfile:12` confirmed `CMD ["npm","run","dev","--","--host","0.0.0.0"]` — no production build stage exists. | Genuinely still open (SAAS-GAP-2, F-classified — no deployable frontend artifact exists today). |
| SR-6.2 | Cloud Readiness | Environment-based configuration | Implemented | [Doc+Test] Pydantic `BaseSettings`. | None. |
| SR-6.3 | Cloud Readiness | Externalized secrets | Implemented | [Doc+Test] `.env`-driven. | None. |
| SR-6.4 | Cloud Readiness | Database migrations | Implemented | [Code] 16+ migrations confirmed in `backend/alembic/versions/`. | None. |
| SR-6.5 | Cloud Readiness | Persistent object storage | Not Implemented | [Code] `attachment_service.py` local filesystem only (GAP-07). | Genuinely still open (SAAS-GAP-3, F-classified). |
| SR-6.6 | Cloud Readiness | Centralized application logging | Partially Implemented | [Doc+Test] structured per-request logging exists but plain-text, no correlation ID (confirmed — not addressed by ADR-041). | Genuinely still open. |
| SR-6.7 | Cloud Readiness | Health and readiness endpoints | Implemented | [Code] same evidence as SR-5.6. | **Updated from source doc's `Partial`.** |
| SR-6.8 | Cloud Readiness | Error monitoring | Not Implemented | [Code] grep for `sentry\|rollbar\|bugsnag` found zero matches in application code. | Genuinely still open. |
| SR-6.9 | Cloud Readiness | Database backup and restore | Not Implemented | [Code] no backup script found anywhere in the repo. | Genuinely still open. |
| SR-6.10 | Cloud Readiness | Background job management | Not Implemented | [Code] no Celery/RQ/task-queue dependency found; CSV import runs synchronously in-request. | Genuinely still open. |
| SR-6.11 | Cloud Readiness | Secure file uploads | Implemented | [Doc+Test] extension allowlist + magic-byte sniffing (GAP-66) + size cap. | None. |
| SR-6.12 | Cloud Readiness | HTTPS deployment | Partially Implemented | [Doc+Test] no TLS/reverse-proxy in dev compose (expected at this layer); session cookie's `Secure` flag is environment-conditional. | Acceptable as-is until a production deployment target is defined. |
| SR-6.13 | Cloud Readiness | Rate limiting | Partially Implemented | [Code] confirmed only `/auth/login` and `/auth/mfa/verify` are limited (`app/core/rate_limit.py`); SAAS_GAP_ANALYSIS.md SAAS-GAP-6 confirms this is still open. | Genuinely still open — most write endpoints unthrottled. |
| SR-6.14 | Cloud Readiness | Secure session management | Implemented | [Doc+Test] idle timeout, absolute expiry, revocation, cookie flags. | None. |
| SR-7.1 | Security | Strong auth/MFA/RBAC/tenant isolation/etc. | Implemented | [Doc+Test] `Security_Test_Report.md` (73 passing tests). | None. |
| SR-7.2 | Security | Rate limiting as a security control | Partially Implemented | [Code] same evidence as SR-6.13. | Genuinely still open. |
| SR-7.3 | Security | Backup and recovery procedures | Not Implemented | [Code] same evidence as SR-6.9. | Genuinely still open. |
| SR-7.4 | Security | Keep security documentation current | Implemented | [Doc+Test] the specific staleness this row names (content-sniffing finding) was corrected per SAAS-GAP-17/GAP-70. | **Updated from source doc's `Partial`** — the correction itself has since been made. |
| SR-8.1 | Governance | BRD remains primary source of truth | Implemented | [Doc+Test] — | None. |
| SR-8.2 | Governance | Additional SaaS requirements tracked separately | Implemented | [Doc+Test] this document + companions. | None. |
| SR-8.3 | Governance | No unapproved billing/payment/SSO/commercial functionality | Implemented | [Code] confirmed via the same greps used for SR-1.6/SR-1.7/PV-11.1 — none exist. | Must stay true going forward. |
| SR-9.1 | Arch Quality | Separation of concerns / modular backend | Implemented | [Doc+Test] — | None. |
| SR-9.2 | Arch Quality | Reusable frontend components | Implemented | [Doc+Test] — | None. |
| SR-9.3 | Arch Quality | API versioning | Partially Implemented | [Doc+Test] static `/api/v1` prefix, no real negotiation mechanism (confirmed, unaddressed). | Genuinely still open; fine until a breaking v2 is needed. |
| SR-9.4 | Arch Quality | Database constraints and indexes | Implemented | [Doc+Test] — | None. |
| SR-9.5 | Arch Quality | Transaction management | Implemented | [Doc+Test] — | None. |
| SR-9.6 | Arch Quality | Automated unit/integration tests | Implemented | [Doc+Test] 163+ backend tests against real Postgres. | None. |
| SR-9.7 | Arch Quality | Tenant isolation tests | Implemented | [Doc+Test] — | None. |
| SR-9.8 | Arch Quality | Centralized exception handling | Implemented | [Code] `backend/app/main.py:104` confirmed `@app.exception_handler(Exception)`. | **Updated from source doc's `Partial`** — resolved by ADR-041, confirmed in code. |
| SR-9.9 | Arch Quality | API documentation | Implemented | [Doc+Test] FastAPI auto-docs + `API_SPECIFICATION.md`. | None. |

**SR section total: 84 rows — 50 Implemented, 14 Partially Implemented, 20 Not Implemented.**

---

## Section 4 — SAAS-GAP-N (remediation list, source: `SAAS_GAP_ANALYSIS.md`)

Each row below is the same underlying fact as its cross-referenced SR row above — reported separately only because the project tracks it under its own ID scheme. Evidence is not repeated verbatim; see the matching SR row for full citation detail.

| Requirement ID | Module | Requirement Description | Implementation Status | Evidence (File/API/Component) | Gap/Observation |
|---|---|---|---|---|---|
| SAAS-GAP-1 | F | No subscription/billing data model | Not Implemented | Same as SR-1.6/SR-3.1-3.2. | Genuinely open. |
| SAAS-GAP-2 | F | Frontend Docker image runs dev server | Not Implemented | Same as SR-6.1. | Genuinely open. |
| SAAS-GAP-3 | F | Local-disk-only attachment storage | Not Implemented | Same as SR-6.5. | Genuinely open; schema already storage-agnostic, so this is a service-layer swap when needed, not a data migration. |
| SAAS-GAP-4 | L | Platform-admin actions not individually attributed | Not Implemented | Same as SR-5.8. | Genuinely open. |
| SAAS-GAP-5 | L | Platform Admin auth has no session/MFA | Not Implemented | Same as SR-5.9. | Genuinely open. |
| SAAS-GAP-6 | L | Rate limiting covers only 2 endpoints | Partially Implemented | Same as SR-6.13/SR-7.2. | Genuinely open. |
| SAAS-GAP-7 | L | No tenant self-service settings | Implemented | Same as SR-2.3. | **Resolved beyond this document's own last-recorded update** — the doc only credits ADR-041's 7 items; this one was separately resolved later by Phase 1/ADR-043, confirmed in code by this audit. |
| SAAS-GAP-8 | L | No user-invite flow | Not Implemented | Same as SR-2.4. | Genuinely open. |
| SAAS-GAP-9 | L | Responsive design not addressed | Implemented | Same as SR-4.2. | Already marked resolved (ADR-041) in the source document; confirmed by this audit. |
| SAAS-GAP-10 | L | No collapsible sidebar | Implemented | Same as SR-4.3. | Already marked resolved (ADR-041); confirmed. |
| SAAS-GAP-11 | L | No toast/success-feedback system | Not Implemented | Same as SR-4.12. | Genuinely open. |
| SAAS-GAP-12 | L | New redesign pages lack a11y coverage | Implemented | Same as SR-4.13. | Already marked resolved (ADR-041); not independently re-run, corroborated via ADR text + route existence. |
| SAAS-GAP-13 | L | No error monitoring integration | Not Implemented | Same as SR-6.8. | Genuinely open. |
| SAAS-GAP-14 | L | No documented/automated DB backup | Not Implemented | Same as SR-6.9/SR-7.3. | Genuinely open. |
| SAAS-GAP-15 | L | No generic/catch-all exception handler | Implemented | Same as SR-9.8. | Already marked resolved (ADR-041); confirmed in code. |
| SAAS-GAP-16 | L | Health endpoint liveness-only | Implemented | Same as SR-5.6/SR-6.7. | Already marked resolved (ADR-041); confirmed in code. |
| SAAS-GAP-17 | L | `Security_Test_Report.md` stale on one finding | Implemented | Same as SR-7.4. | Already marked resolved (ADR-041); doc-only fix. |
| SAAS-GAP-18 | L | Logging unstructured, no correlation ID | Not Implemented | Same as SR-6.6. | Genuinely open. |
| SAAS-GAP-19 | L | Contextual role-gating inconsistent (Defects) | Implemented | Same as SR-4.7. | Already marked resolved (ADR-041); confirmed in code. |
| SAAS-GAP-20 | E | No global/cross-entity search | Not Implemented | Same as SR-4.5. | Genuinely open. |
| SAAS-GAP-21 | E | No manual light/dark theme toggle | Not Implemented | Same as SR-4.10. | Genuinely open. |
| SAAS-GAP-22 | E | Notification bell has no backend | Implemented | Same as SR-4.11/PV-9.2. | **This document's own entry is now stale** — written as an "intentional, honestly-labeled placeholder," since superseded by the real Phase 9/ADR-051 implementation this audit confirmed in code. |
| SAAS-GAP-23 | E | Static `/api/v1` prefix, no negotiation | Not Implemented | Same as SR-9.3. | Genuinely open; not urgent. |
| SAAS-GAP-24 | E | Custom/tenant-defined roles | Not Implemented | Same as SR-1.4. | Intentionally out of BRD scope (GAP-05); needs a formal change request, not a bug fix. |
| SAAS-GAP-25 | E | Tenant usage dashboard | Not Implemented | Depends on SAAS-GAP-1 (subscription limits) existing first. | Correctly sequenced as blocked-on-F-item in the source doc. |
| SAAS-GAP-26 | E | Self-service tenant signup | Not Implemented | No such flow exists; platform-admin-provisioned onboarding only. | Distinct product/commercial decision, not assumed by any current scope document. |
| SAAS-GAP-27 | E | SSO | Not Implemented | Same as PV-11.1. | Named only as a proposed/unapproved plan-table column; not scoped anywhere concretely. |

**SAAS-GAP section total: 27 rows — 8 Implemented, 1 Partially Implemented, 18 Not Implemented.**

---

## Grand total across all four sections

| Status | BR (97) | PV (42) | SR (84) | SAAS-GAP (27) | Total (250) |
|---|---|---|---|---|---|
| Implemented | 97 | 15 | 50 | 8 | 170 |
| Partially Implemented | 0 | 1 | 14 | 1 | 16 |
| Not Implemented | 0 | 24 | 20 | 18 | 62 |
| Blocked | 0 | 2 | 0 | 0 | 2 |
| Not Verifiable | 0 | 1 | 0 | 0 | 1 |
