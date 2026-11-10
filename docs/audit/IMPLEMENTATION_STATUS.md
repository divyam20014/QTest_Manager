# QTestHub — Implementation Status Audit

**Audit date:** 2026-11-10
**Auditor role:** Independent read-only implementation audit (Senior Architect / BA / QA Auditor posture)
**Scope:** Entire repository — backend (FastAPI/SQLAlchemy/Alembic/PostgreSQL), frontend (React/Vite/TS), docs, tests.
**Method:** No code was modified. Findings are based on (a) direct reading of source files, migrations, and tests; (b) cross-reference against the project's own requirement-tracking documents; (c) resolution of conflicts between documents and between documents and code, via direct code inspection. See `REQUIREMENT_GAP_ANALYSIS.md` for the full per-requirement evidence trail.

## How to read this audit

This codebase deliberately tracks requirements in **four separate, never-merged ID schemes**, each with its own source document:

| Scheme | Source document | What it covers |
|---|---|---|
| `BR-NN` | `docs/REQUIREMENT_TRACEABILITY.md` | Original BRD (`BRD-QTH-INS-2026-V2.4`, condensed in `docs/MASTER_SPEC.md`) scope: the core test-management product. |
| `PV-N.N` | `docs/PRODUCT_VISION.md` | The newer, separately-approved "AI-Powered QA Operations & Quality Intelligence Platform" vision — phased roadmap in `docs/DEVELOPMENT_ROADMAP.md`. |
| `SR-N.N` | `docs/SAAS_REQUIREMENTS.md` | SaaS-platform governance/hygiene scorecard (multi-tenancy architecture, platform admin, cloud readiness, security, arch quality). |
| `SAAS-GAP-N` | `docs/SAAS_GAP_ANALYSIS.md` | The prioritized remediation list derived from the SR scorecard — heavily overlapping SR by design (it is SR's "companion" document), not an independent requirement set. |

**Important finding before the numbers**: `SAAS_REQUIREMENTS.md` and `SAAS_GAP_ANALYSIS.md` and `PRODUCT_VISION.md` were all written at an earlier point in this project's history and were **not updated** after several later hardening passes (ADR-041, "SaaS gap-analysis fix batch") and the AI/SaaS vision roadmap (Phases 1–9, ADR-043 through ADR-051) closed a number of items those documents still list as `Missing`/`Partial`. This audit independently re-verified every such candidate against the actual current code (see `REQUIREMENT_GAP_ANALYSIS.md`'s "Verification Method" column) before updating its own verdict — the stale labels are not trusted at face value, nor are they silently left uncorrected; they are called out explicitly as conflicts in `TECHNICAL_FINDINGS.md`.

Because `SR-*` and `SAAS-GAP-*` describe substantially the same underlying facts under two different ID schemes (the documents say so themselves), the two are reported **separately** below and must not be added together into one combined "SaaS requirement" count.

---

## Summary table

| Requirement Scheme | Total | Implemented | Partially Implemented | Not Implemented | Blocked | Not Verifiable | Overall Completion % |
|---|---|---|---|---|---|---|---|
| BR (original BRD) | 97 | 97 | 0 | 0 | 0 | 0 | **100%** |
| PV (AI/SaaS vision) | 42 | 15 | 1 | 24 | 2 | 1 (PV-1.4, scope-clarification row, not a real requirement) | **~37%** (weighting Partial as ½) |
| SR (SaaS governance scorecard) | 84 | 50 | 14 | 20 | 0 | 0 | **~68%** |
| SAAS-GAP (remediation list) | 27 | 8 | 1 | 18 | 0 | 0 | **~31%** |

**Blended figure across all 250 tracked rows** (for reference only — see caveat above on SR/SAAS-GAP overlap): Implemented 170, Partial 16, Not Implemented 63, Blocked 2, Not Verifiable 1 → **(170 + 8)/250 ≈ 71%**. This number is **not** a meaningful single "% of the product is done" figure — it is dominated by the fact that the original BRD product (BR) is fully done while the newer AI/SaaS commercialization vision (PV) and the SaaS-platform hygiene backlog (SR/SAAS-GAP) are each about a third to two-thirds complete. Treat the four scheme-level percentages as the real signal.

---

## Module-wise completion (BR / original BRD scope)

All ten BRD-scoped functional areas are at 100% per `REQUIREMENT_TRACEABILITY.md`, independently spot-verified against running code (models, services, API routers, migrations, and representative tests all present and consistent):

| Module | BR IDs | Status |
|---|---|---|
| Multi-tenant auth, RBAC, MFA, sessions | BR-01, BR-02, BR-14, BR-17, BR-19, BR-37, BR-38, BR-44–BR-48 | Done |
| Project Management | BR-04, BR-20, BR-49–BR-52 | Done |
| Test Case Management + Versioning + Approval | BR-05, BR-07, BR-53–BR-59 | Done |
| CSV Bulk Import/Export | BR-06, BR-60–BR-64 | Done |
| Test Execution Engine | BR-08, BR-09, BR-15, BR-65–BR-71 | Done |
| Defect Management | BR-10, BR-11, BR-23, BR-24, BR-34, BR-72–BR-78 | Done |
| Dashboard + Reporting + Compliance Export | BR-03, BR-12, BR-25–BR-28, BR-79–BR-85 | Done |
| Audit Logging / Administration | BR-13, BR-29, BR-30, BR-35, BR-86 | Done |
| Platform Administration | BR-14, BR-32, BR-48 | Done |
| Hardening (security, concurrency, infra) | BR-16, BR-18, BR-31, BR-36, BR-39–BR-43, BR-87, BR-88 | Done |
| AI/SaaS vision Phases 1–9 (tenant settings, Requirements Mgmt, 3x AI capabilities, Defect Intelligence analytics, attachment wiring, Comments, Notifications) | BR-89–BR-97 | Done |

**Minor documentation defect found** (not a code defect): `REQUIREMENT_TRACEABILITY.md` rows BR-01 and BR-03 still carry a stale `"(backend; no frontend yet)"` suffix even though the same document's own §"Current overall status" and Phase 10 narrative confirm all ten frontend screens, including the Dashboard that satisfies BR-03, were completed. See `TECHNICAL_FINDINGS.md` for detail.

## Module-wise completion (PV / AI-SaaS vision)

| Module | PV IDs | Implemented | Partial | Not Implemented / Blocked |
|---|---|---|---|---|
| Requirements Management | PV-1.1–1.3 | 3/3 | — | — |
| AI-Powered QA Intelligence | PV-3.1–3.7 | 5/7 | — | PV-3.4 (AI QA Assistant), PV-3.5 (AI Defect Assistant) — deliberately unscheduled |
| Automation & CI/CD | PV-5.1–5.3 | 0/3 | — | all 3 — fully greenfield, needs new machine-auth plane |
| Defect Intelligence | PV-6.1–6.6 | 3/6 | — | PV-6.1 (dup detection), PV-6.6 (external sync) missing; PV-6.3 (reopened-defect) structurally blocked by ADR-026 |
| QA Manager Intelligence | PV-7.1–7.4 | 0/4 | 1/4 (PV-7.2) | PV-7.1, PV-7.4 missing; PV-7.3 structurally blocked (no module/folder schema) |
| Test Assets | PV-8.1–8.4 | 1/4 | — | PV-8.1, 8.2, 8.3 missing (Environment/Build entities, test-data repository) |
| Collaboration & Workflow | PV-9.1–9.7 | 3/7 | — | PV-9.3, 9.4, 9.5, 9.6 missing. **PV-9.7 is a documentation-vs-code conflict — see below.** |
| Insurance QA Pack (optional) | PV-10.1 | 0/1 | — | missing, explicitly optional |
| Enterprise SaaS (beyond SAAS_GAP_ANALYSIS) | PV-11.1–11.6 | 0/6 | — | all 6 missing (SSO, SCIM, IP allowlist, branding, data export, data residency) |

**Resolved conflict — PV-9.7 ("Tenant settings infrastructure")**: `PRODUCT_VISION.md` line 140 lists this as `Missing` ("SAAS-GAP-7: no GET/PATCH /settings endpoint exists at all"), while the same document's PV-3.7 row (line 58) says AI settings "reused the Phase 1 mechanism... exactly as PV-9.7 anticipated" — an internal contradiction. Direct code verification resolves it: `backend/app/api/settings.py` and `backend/app/services/settings_service.py` exist and implement `GET/PATCH /api/v1/settings`, gated by `tenant.settings.manage`, per `DEVELOPMENT_ROADMAP.md` Phase 1 / ADR-043 / `KNOWN_GAPS.md` GAP-80. **Corrected status: Done.** `PRODUCT_VISION.md`'s PV-9.7 row itself needs a documentation fix (not a code fix).

## Module-wise completion (SR / SaaS governance scorecard)

| Module | SR IDs | Implemented | Partial | Not Implemented |
|---|---|---|---|---|
| SaaS Architecture | SR-1.1–1.9 | 5 | 2 | 2 (subscription plans, billing schema room) |
| Tenant Management | SR-2.1–2.8 | 7 | 0 | 1 (user invite flow) |
| Subscription Architecture | SR-3.1–3.7 | 0 | 0 | 7 (entire module missing — by design, not yet authorized) |
| SaaS User Experience | SR-4.1–4.14 | 10 | 3 | 1 (global search) |
| Platform Administration | SR-5.1–5.16 | 9 | 3 | 4 (subscription config, cross-tenant usage monitoring, background-job monitoring, platform-admin auth strength) |
| Cloud Readiness | SR-6.1–6.14 | 6 | 4 | 4 (object storage, error monitoring, backup/restore, background job queue) |
| Security and Compliance | SR-7.1–7.4 | 2 | 1 | 1 (backup/recovery procedures) |
| Scope/BRD Governance | SR-8.1–8.3 | 3 | 0 | 0 |
| Architecture Quality | SR-9.1–9.9 | 8 | 1 | 0 |

**Items this audit independently updated from the source document's stale label to `Done`, after direct code verification** (all genuinely resolved by later hardening passes the source document predates):
- SR-2.3, SR-5.10, SR-5.14 (tenant settings) — `backend/app/api/settings.py` confirmed to exist (ADR-043).
- SR-4.2, SR-4.3 (responsive layout, collapsible sidebar) — `frontend/src/routes/AppShell.tsx` confirmed to contain a `localStorage`-persisted `collapsed` state and `md:w-16`/`md:w-60` responsive classes (ADR-041).
- SR-4.7 (Defects contextual actions) — `frontend/src/routes/defects/DefectsList.tsx:59` confirmed to contain a role-gated "New Defect" quick-create button (ADR-041).
- SR-4.11 (notification bell) — `backend/app/api/notifications.py`, `backend/app/models/notification.py`, `backend/app/services/notification_service.py`, `frontend/src/api/notifications.ts` all confirmed to exist (Phase 9, ADR-051).
- SR-4.13 (accessibility coverage) — `frontend/e2e/accessibility.spec.ts` extended per ADR-041 (per `KNOWN_GAPS.md` GAP-70; not independently re-run in this audit, but the extended page list is corroborated by the ADR text and by the new routes themselves existing).
- SR-5.6, SR-6.7 (readiness endpoint) — `backend/app/main.py:142` confirmed to define `GET /api/v1/ready` distinct from the liveness-only `/health` at line 134.
- SR-9.8 (generic exception handler) — `backend/app/main.py:104` confirmed to register `@app.exception_handler(Exception)`.
- SR-7.4 (stale security report) — the specific staleness SR-7.4 flagged (an already-fixed finding still reported as open in `Security_Test_Report.md`) was itself corrected per `KNOWN_GAPS.md` GAP-70/`SAAS_GAP_ANALYSIS.md` SAAS-GAP-17.

**Confirmed still genuinely open** (re-verified, not just copied from the stale doc): SR-1.6/1.7/SR-3.* (no subscription/billing code anywhere — `grep` for `subscription|stripe|billing|tenant_subscriptions` across `backend/app/models` and `backend/app/api` returned zero matches), SR-6.1 (`frontend/Dockerfile:12` still `CMD ["npm","run","dev",...]`, no production build stage), SR-6.5/SR-6.8/SR-6.9/SR-6.10 (no object storage, error monitoring SDK, backup script, or job queue found), SR-5.4/5.5/5.7/5.9, SR-2.4/5.11 (no invite flow), SR-6.6/6.13/7.2 (logging still unstructured; rate limiting still only on `/auth/login` and `/auth/mfa/verify`), SR-9.3 (static `/api/v1` prefix only).

## Module-wise completion (SAAS-GAP / remediation list)

| Classification | Total | Resolved | Open |
|---|---|---|---|
| F — SaaS foundation | 3 | 0 | 3 (subscription schema, production frontend Docker image, object-storage readiness) |
| L — pre-launch | 16 | 8 | 7 (platform-admin attribution/auth strength, invite flow, toast system, error monitoring, backup, structured logging) + 1 Partial (rate limiting) |
| E — future enhancement | 8 | 0 | 8 |

This audit confirms **SAAS-GAP-7** (tenant self-service settings) as additionally resolved beyond the document's own last-recorded update (which only credits ADR-041's 7 items) — resolved instead by the later Phase 1/ADR-043 work, confirmed by the same code check as SR-2.3 above.

---

## Fully Implemented Modules
Multi-tenant auth/RBAC/MFA/sessions, Project Management, Test Case Management + Versioning + Approval, CSV Bulk Import/Export, Test Execution Engine, Defect Management (core lifecycle), Dashboard + Reporting + Compliance Export, Audit Logging, Platform Administration (tenant lifecycle), Requirements Management (PV-1), all three committed AI capabilities (generation/review/impact-analysis), Attachment wiring across Test Case/Defect/ExecutionStep, Comments, Notifications, Tenant self-service settings.

## Partially Implemented Modules
SaaS cloud-readiness operational hygiene (logging, rate limiting, Dockerization, health/readiness split now Done but backup/monitoring still open), QA Manager Intelligence (only a generic groupby slice exists, no purpose-built workload view), Defect Intelligence beyond Phase 6's additive analytics (no duplicate detection, no external tracker sync, reopened-defect analysis structurally blocked).

## Completely Missing Modules
Subscription/Billing (SR-3, SAAS-GAP-1), Automation & CI/CD integration incl. machine-to-machine auth (PV-5), Insurance QA Pack (PV-10), Enterprise SaaS items beyond the gap analysis — SSO/SCIM/IP-allowlisting/branding/data export/data residency (PV-11), AI QA Assistant and AI Defect Assistant (PV-3.4/3.5, deliberately deferred), Test Assets beyond attachments — Environment/Build entities, test-data repository (PV-8.1–8.3), tenant-configurable enums/custom fields (PV-9.5/9.6), per-entity activity timelines and review-request workflow (PV-9.3/9.4).
