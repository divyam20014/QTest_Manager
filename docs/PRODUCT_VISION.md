# QTestHub — Product Vision (AI-Powered QA Operations & Quality Intelligence Platform)

## Status of this document

This captures the **proposed** expanded vision presented to the team: QTestHub as a
commercially marketable, AI-enabled SaaS QA platform, covering modules A–K plus an
optional Insurance QA Pack. It is **not** an approved extension of the BRD.

Per the directive's own governance rule (its Section 1 / "Source Documents"):
`BRD-QTH-INS-2026-V2.4` (captured in `docs/MASTER_SPEC.md`) remains the sole approved
scope baseline. Nothing in this document authorizes new implementation on its own —
each phase in `docs/DEVELOPMENT_ROADMAP.md` still requires explicit approval before
work starts, per the directive's Phase Execution Control rules.

IDs in this document use the prefix **PV-N** (Product Vision), a scheme kept
deliberately separate from `BR-NN` (BRD traceability, in `REQUIREMENT_TRACEABILITY.md`)
and `SR-N.N` / `SAAS-GAP-N` (SaaS governance, in `SAAS_REQUIREMENTS.md` /
`SAAS_GAP_ANALYSIS.md`). The three schemes are never merged, to keep "what the BRD
requires," "what SaaS-platform hygiene requires," and "what this new commercial/AI
vision proposes" independently auditable.

Status values: **Done** (already implemented and in production use), **Partial**
(some structural support exists but the capability is not usable end-to-end),
**Missing** (zero implementation — confirmed by direct grep/read against the repo,
not inferred).

---

## PV-1: Requirements Management

| ID | Item | Status | Evidence |
|---|---|---|---|
| PV-1.1 | Requirement entity (create/edit/version) | Done | Phase 2 (ADR-044): `Requirement`/`RequirementVersion` models, `backend/app/models/requirement.py`, mirroring `TestCase`'s shape (no draft/approved workflow — every edit forks a new version). |
| PV-1.2 | Requirement → Test Case mapping | Done | Phase 2 (ADR-044): `RequirementTestCaseLink` join table + `POST/DELETE /requirements/{id}/test-cases`. |
| PV-1.3 | Requirement Traceability Matrix (RTM) / coverage % | Done | Phase 2 (ADR-044): `GET /projects/{id}/requirements/coverage`, computed in `requirement_service.py`. |
| PV-1.4 | `docs/REQUIREMENT_TRACEABILITY.md` as a product feature | N/A (clarify) | This file is an **internal delivery-tracking document** (BRD-requirement → implementation mapping, used by this team), not a product feature exposed to QTestHub users. The vision's "Requirements Management" module is a distinct, user-facing capability that does not exist yet. |

**Dependency**: fully greenfield. No existing schema or UI to extend.

## PV-2: Test Management (existing, BRD-scoped)

Already implemented per BRD and extensively verified throughout this project's
history (test case authoring/versioning, step editor, execution console, defect
linkage, dashboards, reporting, audit log, multi-tenant RLS). Not re-audited in
Phase 0 — treated as the stable foundation the new modules build on top of. See
`docs/IMPLEMENTATION_STATUS.md` for the full narrative history.

## PV-3: AI-Powered QA Intelligence

| ID | Item | Status | Evidence |
|---|---|---|---|
| PV-3.1 | AI Test Case Generator | Done | `app/core/ai/` (provider-agnostic interface + Gemini implementation), `app/services/ai_service.py`, `POST /requirements/{id}/generate-test-cases` (AI/SaaS roadmap Phase 3, ADR-045, GAP-72). |
| PV-3.2 | AI Test Case Reviewer | Done | `app/services/ai_service.py::review_test_case`, `POST /test-cases/{id}/ai-review` (AI/SaaS roadmap Phase 4, ADR-046, GAP-72). Reuses Phase 3's `AIProvider` interface (`GeminiProvider.review_test_case`); suggestions-only, never mutates the test case. |
| PV-3.3 | Requirement Change Analyzer (AI-assisted impact analysis) | Done | `app/services/ai_service.py::analyze_requirement_change`, `POST /requirements/{id}/analyze-change` (AI/SaaS roadmap Phase 5, ADR-047, GAP-72). Reuses the `AIProvider` interface (`GeminiProvider.analyze_requirement_change`); compares current vs. prior version, flags linked test cases needing re-review, suggestion-only. Completes all three AI capabilities committed to in Release 1. |
| PV-3.4 | AI QA Assistant (chat-style helper) | Missing | Not yet scheduled in any phase, per the user's own note (only the first three AI capabilities are committed). |
| PV-3.5 | AI Defect Assistant | Missing | Same — not yet scheduled. |
| PV-3.6 | AI provider SDK / credential storage / usage metering | Done | `app/core/ai/gemini_provider.py` (REST calls via `httpx`, no vendor SDK dependency — see ADR-045 for why), `app/core/crypto.py` (Fernet-encrypted credential storage), `app/models/ai_usage.py` + `GET /ai/usage` (token metering). |
| PV-3.7 | Tenant-level AI settings (enable/disable, provider credentials) | Done | Extended `GET/PATCH /api/v1/settings` (built in Phase 1) with `ai_enabled`/`ai_provider`/`ai_api_key` fields on the existing `tenants` table — reused the Phase 1 mechanism rather than building a second one, exactly as PV-9.7 anticipated. |

**This is the module the user's own trailing note explicitly constrains**: *"don't
implement every AI capability in one phase. Start with test generation, then test
review, then requirement impact analysis. Each should have its own testing and
approval criteria,"* and *"Make the core application valuable even when AI is
disabled. AI should enhance QTestHub, not become a dependency for basic test
management, execution, reporting or traceability."* Both constraints are carried
forward unchanged into `docs/DEVELOPMENT_ROADMAP.md`'s phase sequencing.

**Dependency**: fully greenfield (provider SDK, credential storage, usage metering)
and gated on PV-9 (tenant settings) for the credential-storage piece specifically.
PV-3.3 (Requirement Change Analyzer) additionally depends on PV-1 existing.

## PV-4: Test Execution Engine (existing, BRD-scoped)

Already implemented (3-panel Execution Console, step-by-step execution, status
transitions, defect creation from a failed step). Not re-audited — stable
foundation.

## PV-5: Automation & CI/CD Integration

| ID | Item | Status | Evidence |
|---|---|---|---|
| PV-5.1 | Webhook endpoints (inbound result ingestion) | Missing | Zero webhook routes anywhere in `backend/app/api/`. |
| PV-5.2 | CI tool integration (Jenkins/GitHub Actions/etc. result push) | Missing | No integration code. |
| PV-5.3 | Machine-to-machine auth plane (API keys/service tokens) | Missing | Only human session-cookie auth and a separate HTTP-Basic platform-admin auth exist — no API-key or service-account authentication mechanism at all. |

**Dependency**: fully greenfield, and specifically needs a new auth plane before any
endpoint design — this is **foundational** work, not incremental.

## PV-6: Defect Intelligence

| ID | Item | Status | Evidence |
|---|---|---|---|
| PV-6.1 | Duplicate defect detection (similarity-based) | Missing | `DefectLink.link_type` has a `duplicate_of` enum value — a human can manually tag a duplicate — but no similarity-matching/auto-suggestion algorithm exists in `defect_service.py`. |
| PV-6.2 | Defect aging / SLA-breach tracking | Done | `defect_service.py::compute_aging` (fixed per-severity SLA budget), `age_days`/`sla_breached` on every `DefectOut`, `GET /reports/defect-aging` (AI/SaaS roadmap Phase 6, ADR-048, GAP-77). |
| PV-6.3 | Reopened-defect analysis | Missing, structurally blocked | `defect_service.py` line 32: `# ADR-026: strictly sequential, no skipping, no reopening.` The `ck_defects_status` check constraint only allows a strictly forward `New→Open→Fixed→Verified→Closed` sequence — there is no "reopened" state in the data model. This needs a model/constraint change, not just a new report. |
| PV-6.4 | Root cause categorization | Done | `Defect.root_cause` (fixed 7-value taxonomy), `PATCH /defects/{id}/root-cause`, new `defect_root_cause` aggregate-report metric (Phase 6, ADR-048, GAP-77). |
| PV-6.5 | Defect trend analytics (opened-vs-closed over time, beyond severity/status counts) | Done | `GET /reports/defect-trend` (Phase 6, ADR-048, GAP-77), mirrors `get_execution_trend`'s shape. |
| PV-6.6 | External defect tracker sync (Jira/ADO) | Missing | No integration code found. |

**Dependency**: additive on top of the existing `Defect`/`defect_service.py` layer —
no new foundational infrastructure needed, except PV-6.3 which requires a schema/
constraint change (reversing ADR-026's deliberate forward-only design) before any
reopen-rate analytics can exist.

## PV-7: QA Manager Intelligence

| ID | Item | Status | Evidence |
|---|---|---|---|
| PV-7.1 | Release-readiness score / rule engine | Missing | Zero `readiness`/`release_risk` logic anywhere in `reporting_service.py` or elsewhere. |
| PV-7.2 | Assignee-wise workload reporting (dedicated view) | Partial | The generic Aggregate Report's assignee groupby (`get_aggregate_report`) already resolves and counts by assignee across three source fields — but this is a slice of the generic engine, not a purpose-built workload/capacity view. |
| PV-7.3 | Module/folder/category-level quality rollups | Missing, structurally blocked | `TestCase` has no module/folder/category/tag field at all — test cases are flat per-project. Needs a schema change before any sub-project reporting can exist. |
| PV-7.4 | Historical failure trend / flaky-test / regression-stability analytics | Missing | `get_execution_trend` is the only trend function (30-day pass/fail counts); no run-over-run regression-stability or flaky-test detection exists. |

**Dependency**: PV-7.1 and PV-7.4 are additive analytics on existing data. PV-7.3
needs a `TestCase` schema addition (module/folder concept) first.

## PV-8: Test Assets

| ID | Item | Status | Evidence |
|---|---|---|---|
| PV-8.1 | Environment entity (vs. free-text field) | Missing | `environment` is only a free-text `String` column on `Defect`; no dedicated `Environment` entity. |
| PV-8.2 | Build/Release tracking entity | Missing | No `Build`/`Release` model anywhere. |
| PV-8.3 | Test data repository / masking / synthetic data | Missing | No trace of any test-data-management capability. |
| PV-8.4 | Attachments on entities beyond Test Case | Done | `Defect` and `ExecutionStep` now fully wired (Phase 7, ADR-049, GAP-75); `test_case_version` deliberately stays unwired (no stated product need). |

**Dependency**: PV-8.4 is the cheapest — wiring already-designed headroom, no schema
change. PV-8.1/8.2/8.3 are greenfield new entities. PV-8.3 (test data management) is
the most substantial greenfield effort in this module.

## PV-9: Collaboration & Workflow

| ID | Item | Status | Evidence |
|---|---|---|---|
| PV-9.1 | Comments / mentions on entities | Done | Polymorphic `comments`/`comment_mentions` tables + endpoints for Test Case/Defect/ExecutionStep, reusing the Attachment `owner_type` pattern (Phase 8, ADR-050, GAP-74). |
| PV-9.2 | Real notifications (in-app/email) | Done | Real `notifications` table, three bounded triggers (mention/test case assignment/defect closure), in-app + email via simulated/real SMTP delivery mode (Phase 9, ADR-051, GAP-74). |
| PV-9.3 | Per-entity activity timeline beyond the generic audit log | Done | Dedicated timeline endpoints for Test Case/Defect/Requirement built on top of the existing audit log, not a parallel mechanism (Tier 3, ADR-055's predecessor tier — this row previously said `Missing`, corrected 2026-11-11 after direct code verification). |
| PV-9.4 | Review-request / approval workflow | Done | Reuses the existing `draft → ready_for_review → approved` test-case status machine; a named reviewer, server-enforced approve/request-changes, two bounded notification trigger types (Tier 3 — this row previously said `Missing`, corrected 2026-11-11). |
| PV-9.5 | Tenant-configurable statuses/severities/priorities | Done | Severity/priority fully converted to per-tenant value sets (`field_options` table, service-layer validation replacing the old fixed `CheckConstraint`); status kept as a display-label overlay only, not a value-set conversion — see ADR-055 for why (Tier 5). |
| PV-9.6 | Custom fields (EAV/extensibility mechanism) | Done | `custom_field_definitions`/`custom_field_values` (polymorphic, mirroring the Attachment/Comment `owner_type` pattern) for test cases, defects, and requirements; six field types; values read inline on each entity's GET, written via a dedicated endpoint (Tier 5, ADR-055). |
| PV-9.7 | Tenant settings infrastructure (prerequisite for several items above and for PV-3.7) | Done | `GET/PATCH /api/v1/settings` (`backend/app/api/settings.py`, `backend/app/services/settings_service.py`), gated by `tenant.settings.manage`, built in Phase 1 (ADR-043). This row previously said `Missing` and cited `SAAS-GAP-7`, contradicting PV-3.7's own text above saying AI settings "reused the Phase 1 mechanism... exactly as PV-9.7 anticipated" — corrected 2026-11-10 per the implementation audit (`docs/audit/IMPLEMENTATION_STATUS.md`) after direct code verification. |

**Dependency**: Comments (PV-9.1) can reuse the `Attachment` polymorphic
`owner_type` pattern as a template — cited explicitly as a reusable precedent.
Notifications (PV-9.2), per-entity timelines (PV-9.3), and tenant settings (PV-9.7)
are incremental additions on existing patterns. Tenant-configurable
statuses/severities (PV-9.5) and custom fields (PV-9.6) are the most structurally
invasive — they touch core domain-constraint design (currently hardcoded
`CheckConstraint`s) and should be sequenced last within this module.

## PV-10: Insurance QA Pack (optional)

| ID | Item | Status | Evidence |
|---|---|---|---|
| PV-10.1 | Insurance-domain template library (claims/underwriting/policy-admin test case templates) | Done | Static, in-code template library (`app/data/insurance_templates.py`, ~15 templates across Claims/Underwriting/Policy Admin); import creates real `TestCase` rows via the existing create path, organized into same-named Modules (Tier 5, ADR-055). |

**Dependency**: optional by the directive's own framing; depends on nothing else
listed here being built first, but is most valuable once Test Assets (module
tagging) and Requirements Management exist to template against.

## PV-11: Enterprise SaaS (items not already covered by `SAAS_GAP_ANALYSIS.md`)

`SAAS_GAP_ANALYSIS.md` already covers subscription/billing (SAAS-GAP-1), rate
limiting (SAAS-GAP-6), tenant self-service settings (SAAS-GAP-7), invite flow
(SAAS-GAP-8), and notes SSO only as a named-but-unscoped proposed plan column
(SAAS-GAP-27). This section covers what that document deliberately left open.

| ID | Item | Status | Evidence |
|---|---|---|---|
| PV-11.1 | SSO (SAML/OIDC) | Done (Tier 4, ADR-054) | OIDC only — SAML deliberately out of scope (no real IdP reachable from this sandbox to validate against either protocol; OIDC is simpler and more broadly supported). Tenant-level config, authorization-code login flow, auto-provisioning on first login, MFA bypassed for SSO logins by design. Validated against a stub IdP, not a real production one — a real pre-launch validation pass is a required follow-up. |
| PV-11.2 | SCIM provisioning | Done (Tier 4, ADR-054) | Minimal SCIM 2.0 server, Users only (no Groups/Roles sync), per-tenant bearer token auth, DELETE deactivates rather than hard-deletes. Validated against the spec's documented shapes, not a real IdP's SCIM client — same follow-up caveat as SSO. |
| PV-11.3 | IP restriction/allowlisting | Done (Tier 4, ADR-054) | Tenant-configurable CIDR allowlist, enforced at both login and session resolution; empty/unset means no restriction. Real, documented self-lockout risk if an admin excludes their own network — no in-app recovery path, only a platform administrator can clear it. |
| PV-11.4 | Tenant branding (logo/custom domain/white-label) | Partially Done (Tier 4, ADR-054) | Display name, primary color, and logo upload/download (via the Tier 1 storage abstraction) are done. Custom domain/white-label is not — out of scope for this tier. |
| PV-11.5 | Tenant-wide data export (GDPR portability/offboarding) | Done (Tier 4, ADR-054) | A genuine bulk/tenant-wide export (zip of every entity's raw columns + manifest), run through the Tier 1 background job queue, downloaded via the storage abstraction. Distinct from the existing per-user GDPR-erase action, which is unchanged. Attachment bytes are listed by reference only, not inlined. |
| PV-11.6 | Data residency readiness | Partially Done (Tier 4, ADR-054) | A platform-admin-only `data_region` metadata field now exists on `Tenant`. No per-region deployment topology exists — see `docs/DATA_RESIDENCY.md` for what a real implementation would require; this is readiness metadata, not an implemented capability. |

**Dependency**: all six items are independent of each other and of the AI work,
except that tenant branding (PV-11.4) would naturally live in the same future
tenant-settings mechanism as PV-9.7 and PV-3.7.

---

## Cross-cutting dependency summary

1. **Hard prerequisite, built once, unlocks multiple items**: tenant settings
   infrastructure (PV-9.7) gates AI settings/credentials (PV-3.7) and tenant
   branding (PV-11.4). Build it once, not three times.
2. **Fully greenfield, no existing code to extend**: Requirements Management
   (PV-1), AI (PV-3, except the settings piece), Automation/CI (PV-5, needs a new
   machine-auth plane), Test Data Repositories (PV-8.3).
3. **Additive on existing services, no new foundational infra**: most of Defect
   Intelligence (PV-6, except PV-6.3) and QA Manager Intelligence (PV-7, except
   PV-7.3).
4. **Schema changes required before the analytics can exist**: reopened-defect
   analysis (PV-6.3, reverses ADR-026's forward-only constraint) and module-level
   quality rollups (PV-7.3, needs a `TestCase` module/folder field).
5. **Cheapest, already-designed headroom just needs wiring**: Attachments on
   entities beyond Test Case (PV-8.4).
6. **Independent, additive, no interdependency**: SSO/SCIM/IP-restriction/
   data-export/data-residency (PV-11.1–11.3, 11.5–11.6).

See `docs/DEVELOPMENT_ROADMAP.md` for how this translates into phase sequencing,
and `docs/SAAS_GAP_ANALYSIS.md` / `docs/KNOWN_GAPS.md` (GAP-71 onward) for the
individually tracked gap entries.
