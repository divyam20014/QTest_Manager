# QTestHub — Development Roadmap (Phase 0 output)

## Status of this document

This is our proposed phase sequencing for the modules described in
`docs/PRODUCT_VISION.md`, produced as part of the Phase 0 assessment the directive
asked for. It is a **synthesis against the directive's own stated rules** (phase
gating, incremental AI rollout, core-app-independent-of-AI), not a verbatim
transcription of the directive's phase list — this document is itself one of the
items requiring approval before Phase 1 work starts. If the stakeholder's original
phase numbering needs to be matched exactly, say so and we'll reconcile.

**Hard rules carried forward from the directive and the user's own trailing note,
unchanged, into every phase below:**
- Each phase ships with its own tests and its own approval gate. No phase starts
  implementation before the prior phase's tests pass and the user has explicitly
  approved moving on — this document does not grant that approval in advance.
- AI capabilities are NOT delivered as one phase. Order is fixed:
  **test generation → test review → requirement impact analysis**, each with
  independent testing/approval criteria, each gated on its own.
  "AI QA Assistant" and "AI Defect Assistant" were in the original vision but are
  **not sequenced yet** — the user's note only commits to the first three AI
  capabilities; the remaining two wait for a later approval decision.
- The AI layer is additive, never a dependency. Every AI phase below is scoped so
  that with it turned off (feature-flagged), test management, execution, reporting,
  and traceability work exactly as they do today, unchanged.

---

## Release 1 — Foundation hardening + first AI capability

### Phase 0 — Assessment (this document and its companions)
Read-only. No code changes. Deliverables: `docs/PRODUCT_VISION.md`,
`docs/DEVELOPMENT_ROADMAP.md` (this file), `docs/TEST_STRATEGY.md`, `KNOWN_GAPS.md`
GAP-71 onward, `ARCHITECTURE_DECISIONS.md` ADR-042. **Status: complete, pending
approval to start Phase 1.**

### Phase 1 — Tenant settings infrastructure
**Why first**: gates both the AI-settings story (Phase 4) and tenant branding
(Release 3). Building it once now avoids building two settings mechanisms later.
- `GET/PATCH /api/v1/settings` (tenant-admin-only), `tenant_settings` table (or
  JSONB column on `Tenant`, decided during design), real `Settings.tsx` UI
  replacing the current stub.
- **Tests**: ownership/tenant-isolation (cross-tenant settings must be unreachable,
  same RLS pattern as everywhere else), permission checks, a Playwright flow for
  the settings UI.
- **Approval gate**: settings persist correctly, are tenant-isolated, and the UI
  round-trips — before Phase 2 starts. **Status: complete (ADR-043).**

### Phase 2 — Requirements Management (foundation)
**Why second**: fully greenfield (PV-1), and Phase 3's Requirement Change Analyzer
depends on it existing. No AI involved in this phase.
- `Requirement` model (versioned, like `TestCase`), requirement↔test-case mapping
  table, RTM/coverage computation, CRUD API + UI. (Built directly in
  `requirement_service.py` rather than `reporting_service.py` — see ADR-044 for
  why.)
- **Tests**: coverage computation correctness, tenant isolation, requirement
  versioning (mirroring the existing `TestCaseVersion` pattern), RTM report
  accuracy.
- **Approval gate**: RTM is computed correctly against real data, before any AI
  layer is allowed to read requirements. **Status: complete (ADR-044).**

### Phase 3 — AI capability #1: AI Test Case Generator
First AI capability, scoped exactly as the user's note requires — nothing else AI
yet.
- Provider-agnostic AI integration layer (abstraction interface; concrete first
  implementation targets **Google Gemini**, per the user's approval decision),
  tenant-level enable/disable toggle (reusing Phase 1's settings), credential
  storage (encrypted at rest, never logged),
  usage/token metering, "Generate test cases from requirement" action producing
  **draft** test cases a human must review/accept (never auto-published).
- **Tests**: AI-disabled path proven unaffected (core test management works
  identically with the feature flag off), prompt-injection resistance on
  requirement text fed to the model, usage metering accuracy, draft-not-published
  invariant.
- **Approval gate**: demonstrated end-to-end on the real tenant, with AI disabled
  and re-enabled, before Phase 4. **Status: complete (ADR-045).**

### Phase 4 — AI capability #2: AI Test Case Reviewer
- Reuses Phase 3's provider integration. Reviews an existing test case against
  configurable quality heuristics (clarity, missing steps, ambiguous expected
  results), surfaces suggestions a human applies manually — never auto-edits.
- **Tests**: same AI-disabled-path invariant, suggestion accuracy spot-checks,
  no-auto-mutation invariant (the reviewer must never silently alter a test case).
- **Approval gate**: before Phase 5. **Status: complete (ADR-046).**

### Phase 5 — AI capability #3: Requirement Change Analyzer
- Depends on Phase 2 (Requirements Management) and Phase 3/4's provider layer.
  Detects when a requirement's text changes and suggests which linked test cases
  may need review — again, suggestion-only, never auto-modifying test cases or
  requirements.
- **Tests**: change-detection accuracy, no-auto-mutation invariant, AI-disabled
  path invariant.
- **Approval gate**: before Release 2 starts. **AI QA Assistant and AI Defect
  Assistant are explicitly NOT scheduled yet** — they need their own future
  approval decision, per the user's note. **Status: complete (ADR-047). This
  completes Release 1 — all three AI capabilities the user's note committed to
  (generation, review, impact analysis) are implemented, each independently
  gated, tested, and approved.**

---

## Release 2 — Defect/QA intelligence, test assets, automation foundation

These phases are independent of each other and of the AI work (no AI dependency),
so their internal order is flexible; proposed order below minimizes schema churn
by doing additive-only changes first.

### Phase 6 — Defect Intelligence, additive analytics (PV-6.2, 6.4, 6.5)
Defect aging/SLA tracking, root-cause categorization (new field + simple taxonomy),
defect trend analytics. No schema-breaking changes.
- **Tests**: metric-correctness tests against seeded data, reporting-UI tests.
  **Status: complete (ADR-048).**

### Phase 7 — Attachment wiring beyond Test Case (PV-8.4)
Wire the already-designed `owner_type` headroom to `defect`/`execution_step`
(and `test_case_version` if still needed). Cheapest item in the whole roadmap —
no schema change, just service/API wiring + UI.
- **Tests**: reuse the existing attachment test suite pattern, extended to the
  new owner types; access-control parity with the test-case case.

### Phase 8 — Comments (PV-9.1), reusing the Attachment polymorphic pattern
- **Tests**: tenant isolation, permission checks mirroring the entity being
  commented on.

### Phase 9 — Real notifications (PV-9.2)
Replaces the `NotificationBell.tsx` placeholder with a real backend (in-app at
minimum; email optional/deferred to a later phase if infra isn't ready).
- **Tests**: delivery correctness, no cross-tenant leakage.

### Phase 10 — Per-entity activity timelines (PV-9.3)
Builds dedicated timelines (test case, defect, requirement) on top of the existing
audit log rather than the generic reuse pattern.

### Phase 11 — Test Assets: Environment & Build/Release entities (PV-8.1, 8.2)
Promotes `Defect.environment` from free text to a real `Environment` entity;
introduces `Build`/`Release` tracking.
- **Tests**: migration correctness (existing free-text data backfilled, not
  dropped), reporting correctness against the new entities.

### Phase 12 — Automation & CI/CD integration foundation (PV-5)
Most structurally significant phase in this release: new machine-to-machine
auth plane (API keys/service tokens, separate from the human session-cookie and
platform-admin Basic-auth planes), then webhook/result-ingestion endpoints.
- **Tests**: this is a new attack surface — needs the same security-hardening
  sweep pattern already used elsewhere (route-discovery, auth-bypass attempts,
  rate limiting), plus integration tests against a stubbed CI tool.
- **Approval gate**: security review before this phase is considered done, given
  the new auth plane.

### Phase 13 — Reopened-defect analysis (PV-6.3)
Deliberately last in this release: requires reversing ADR-026's forward-only
status constraint, which is a real design decision (does "reopened" become a new
status, or a separate boolean/counter alongside the existing sequence?) that needs
explicit approval before the schema change, not just an analytics addition.
- **Approval gate**: the status-model design decision itself needs sign-off before
  implementation, not after.

---

## Release 3 — QA Manager intelligence, enterprise SaaS, insurance pack

### Phase 14 — Module/folder-level test case grouping (PV-7.3)
Schema addition (`TestCase.module`/folder concept) — needed before module-level
quality rollups can exist.

### Phase 15 — QA Manager Intelligence: release readiness + workload + flaky-test trend (PV-7.1, 7.2, 7.4)
Builds on Phase 14 and the existing `reporting_service.py` aggregate engine.

### Phase 16 — Tenant branding (PV-11.4)
Reuses Phase 1's tenant-settings mechanism.

### Phase 17 — Tenant-wide data export (PV-11.5)
Distinct from the existing per-user GDPR-erase action; a genuine bulk/tenant-wide
export capability.

### Phase 18 — IP restriction/allowlisting (PV-11.3)

### Phase 19 — SSO (SAML/OIDC) (PV-11.1)
Largest single item in this release — a new external-identity-provider
integration touching the auth layer. Recommend its own dedicated security review
before approval, same as Phase 12's new auth plane.

### Phase 20 — SCIM provisioning (PV-11.2)
Depends on Phase 19 (SSO) existing — SCIM is normally paired with an identity
provider integration.

### Phase 21 — Data residency readiness (PV-11.6)
Infrastructure/deployment-config work, likely the least code-heavy but most
operationally significant item in this release (may require per-region deployment
topology, not just application code).

### Phase 22 — Tenant-configurable statuses/severities/priorities + custom fields (PV-9.5, 9.6)
Deliberately last and separated from the rest of Release 2/3: this is the most
structurally invasive change in the whole roadmap (converts hardcoded
`CheckConstraint` enums into tenant-configurable data), and should not be
attempted until everything that depends on today's fixed enums (reporting,
dashboards, the audit log's status-transition assumptions) has stabilized.

### Phase 23 — Insurance QA Pack (PV-10.1, optional)
Template library for claims/underwriting/policy-admin test cases. Most valuable
once Phase 2 (Requirements) and Phase 14 (module grouping) exist to template
against — sequenced last deliberately, and explicitly optional per the original
directive's own framing.

---

## Explicitly out of scope / not yet decided

- **AI QA Assistant, AI Defect Assistant**: named in the original vision, not
  scheduled in any phase above per the user's own note — a future phase needs its
  own proposal and approval once Phases 3–5 have proven out the AI integration
  pattern.
- **Subscription/billing** (`SAAS-GAP-1`, F-classified in `SAAS_GAP_ANALYSIS.md`):
  intentionally not folded into this roadmap — it's tracked as a separate SaaS
  foundation item with its own approval path.
- Exact phase-to-phase time estimates: deliberately omitted. Each phase's own
  approval gate is based on tests passing and live verification, not a calendar
  commitment.

## Decisions confirmed by the user when approving this roadmap (2026-11-10)

- **Roadmap accepted as proposed** — phase order and sequencing above stands.
- **AI provider for Phase 3 (and 4/5): Google Gemini.** Phase 3's integration
  layer must still stay provider-agnostic in its abstraction (an interface the
  rest of the app calls, not direct Gemini SDK calls scattered through service
  code) so a future provider change doesn't require touching every call site —
  but the concrete first implementation targets the Gemini API.
- **Phase 9 (notifications): both email and in-app channels**, not email-only.
- **Phase 20 (SCIM) confirmed needed** — not dropped despite its dependency on
  Phase 19 (SSO) existing first.
