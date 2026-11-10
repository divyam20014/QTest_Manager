# QTestHub — Technical Findings

Architecture, database, API-integration, security, tenant-isolation, UI/UX, and testing findings, each grounded in a specific file, line, or test result examined in this audit. This section also carries the directive's required **documentation-conflict disclosures** — cases where source documents disagree with each other or with the real code.

---

## A. Documentation Conflicts (found and resolved by direct code verification)

### A.1 — `PRODUCT_VISION.md` self-contradicts on tenant settings (PV-9.7 vs PV-3.7)
**Files**: `docs/PRODUCT_VISION.md` lines 58 and 140.
**Conflict**: line 140 (PV-9.7, "Tenant settings infrastructure") states `Status: Missing`, evidence `"SAAS-GAP-7: no GET/PATCH /settings endpoint exists at all."` Line 58 (PV-3.7, a few sections earlier in the same document) states tenant-level AI settings "reused the Phase 1 mechanism rather than building a second one, **exactly as PV-9.7 anticipated**" — directly implying PV-9.7 should already read Done.
**Resolution**: `backend/app/api/settings.py` and `backend/app/services/settings_service.py` both exist and implement `GET/PATCH /api/v1/settings`, gated by `tenant.settings.manage`, per `DEVELOPMENT_ROADMAP.md`'s Phase 1 and ADR-043. **The code confirms PV-3.7 is correct and PV-9.7's own row is stale.** This is a documentation defect, not a code defect — `PRODUCT_VISION.md` was evidently not updated when Phase 1 completed, even though its own PV-3.7 row and `DEVELOPMENT_ROADMAP.md` were.
**Recommendation**: update PV-9.7's status to Done in `PRODUCT_VISION.md`, citing ADR-043/GAP-80 as its sibling rows already do.

### A.2 — `SAAS_REQUIREMENTS.md` / `SAAS_GAP_ANALYSIS.md` predate later hardening passes
**Files**: `docs/SAAS_REQUIREMENTS.md` (SR-2.3, SR-4.2, SR-4.3, SR-4.7, SR-4.11, SR-4.13, SR-5.6, SR-5.10, SR-5.14, SR-6.7, SR-7.4, SR-9.8), `docs/SAAS_GAP_ANALYSIS.md` (SAAS-GAP-7, SAAS-GAP-22).
**Conflict**: both documents still label these items `Missing`/`Partial`, but each was independently confirmed resolved in this audit by reading the actual current code — see the matching rows in `REQUIREMENT_GAP_ANALYSIS.md` for per-item evidence (e.g. `app/main.py:104` for the generic exception handler SR-9.8 claims is absent; `app/main.py:142` for the `/ready` endpoint SR-5.6/SR-6.7 claim doesn't exist; `AppShell.tsx`'s `useCollapsedPreference` for SR-4.3's claimed missing sidebar collapse).
**Why this happened**: `SAAS_GAP_ANALYSIS.md` itself explains the partial picture — it was updated once after ADR-041 ("a first... fix batch has... closed 7 of the L items below") but never updated again after the later, independent Phase 1/ADR-043 tenant-settings work, which also happened to close SAAS-GAP-7/SR-2.3/SR-5.10/SR-5.14. `SAAS_REQUIREMENTS.md` appears to have never been re-synced after either pass.
**Recommendation**: a documentation-only pass to re-sync `SAAS_REQUIREMENTS.md` and `SAAS_GAP_ANALYSIS.md` against the current `KNOWN_GAPS.md`/`ARCHITECTURE_DECISIONS.md` state, the same way `KNOWN_GAPS.md` itself is kept current (that file's strikethrough-and-"Resolved" convention is a good model to copy).

### A.3 — `REQUIREMENT_TRACEABILITY.md` stale per-row caveats
**File**: `docs/REQUIREMENT_TRACEABILITY.md` lines 7 and 9.
**Conflict**: BR-01 and BR-03 each carry a `"(backend; no frontend yet)"` suffix in their Status column, while the same document's own §"Current overall status" (lines 109-121) confirms Phase 10 built all ten frontend screens, and BR-03's own row already lists `Dashboard.tsx` in its Frontend Module column — contradicting the row's own status text.
**Impact**: cosmetic/narrative inconsistency only — this audit independently confirmed both requirements are functionally complete (see `REQUIREMENT_GAP_ANALYSIS.md` BR-01/BR-03). Not a functional gap.
**Recommendation**: remove the stale suffix from both rows.

### A.4 — Stale closing boilerplate
**File**: `docs/REQUIREMENT_TRACEABILITY.md` line 121: `"All other BR rows are Not Started until their corresponding phase begins."` No BR row in the document is actually `Not Started` — all 97 are `Done`. This sentence is leftover boilerplate from an early draft.
**Recommendation**: remove the sentence; it no longer describes any row in the table.

---

## B. Architecture

### B.1 — Layering discipline holds up
`backend/app/{models,schemas,services,api,core}` is consistently layered; no lower-layer-imports-route-layer violations were found during this audit's reading of `services/` and `api/` modules (consistent with `SR-9.1`'s own "Done" verdict, independently corroborated here).

### B.2 — AI integration is genuinely provider-agnostic at the interface level, single-provider in practice
`backend/app/core/ai/base.py` defines the provider interface; `gemini_provider.py` is the only concrete implementation, communicating via raw `httpx` REST calls rather than a vendor SDK (a deliberate choice per ADR-045, avoiding a hard dependency the interface itself doesn't need). This is architecturally sound but means a provider switch is currently untested in practice — the abstraction has one data point.

### B.3 — Hardcoded enums are a structural constraint, not an oversight
`backend/app/services/defect_service.py` enforces ADR-026's strictly-forward `New→Open→Fixed→Verified→Closed` sequence at the `CheckConstraint` level — confirmed by the comment cited in `PRODUCT_VISION.md` ("ADR-026: strictly sequential, no skipping, no reopening"). This is the same structural pattern blocking PV-6.3 (reopened-defect analysis) and PV-9.5 (tenant-configurable statuses) — a single prior design decision (ADR-026) has downstream consequences across two otherwise-unrelated roadmap items. Any future work to loosen this needs to be a deliberate, singular schema/design decision, not patched independently in each dependent feature.

### B.4 — `TestCase` has no module/folder/tag dimension
Confirmed structurally: test cases are flat per-project with no grouping field. This single schema gap blocks both PV-7.3 (quality rollups) and indirectly reduces the value of PV-10.1 (Insurance Pack templates, which the roadmap itself says are "most valuable once... module grouping... exist[s] to template against"). A single `TestCase.module`/folder schema addition (Phase 14 in the roadmap) would unblock two otherwise-separate roadmap items at once.

---

## C. Database / Tenant Isolation

### C.1 — RLS pattern is consistently applied, including to all newly-added tables
Direct inspection of `backend/alembic/versions/` confirms `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + a `tenant_isolation` policy present in the baseline tenancy migration (`7bca6b69ef88`) and independently re-applied in every one of the newer feature migrations this audit checked: `a1b2c3d4e5f6` (Requirements Management), `b2c3d4e5f6a7` (AI Test Case Generator / `ai_usage_logs`), `d4e5f6a7b8c9` (Comments), `d8e9f0a1b2c3` (Idempotency Keys), `e5f6a7b8c9d0` (Notifications). This is a meaningful positive finding: the AI/SaaS vision phases did not relax tenant-isolation discipline when adding new tables, which is exactly the kind of regression a fast-moving multi-phase build could otherwise introduce silently.

### C.2 — Attachment storage isolation is path-based, not storage-account-based
`backend/app/services/attachment_service.py` partitions by `{attachments_dir}/{tenant_id}/{test_case_id}/` on a single shared Docker volume. Logically correct (no cross-tenant read path exists in the service code), but it is a single physical blast radius — a volume-level misconfiguration or host compromise would expose all tenants' files at once, unlike true per-tenant storage-account isolation. Acceptable at current single-instance scale; revisit alongside the object-storage migration (SAAS-GAP-3).

### C.3 — Platform-admin actions bypass the user-attributed audit trail by schema design
`audit_logs.user_id` has an FK to `users`, not `platform_admins` (confirmed via `platform_service.py`'s `record_audit_event(..., user_id=None, ...)` calls for `tenant.created`/`tenant.status_changed`). This is a real, currently-open gap (GAP-13/SR-5.8/SAAS-GAP-4) — not a tenant-isolation defect (platform admins are intentionally outside tenant RBAC), but a genuine accountability gap for high-privilege platform actions.

---

## D. API / Integration

### D.1 — 63 call sites use `require_permission` for RBAC enforcement
A direct grep across `backend/app/api/*.py` found 63 call sites using the `require_permission` dependency pattern, consistent with the project's claimed systematic RBAC-at-the-route-layer design. This audit did not individually verify every one of the 63 against its intended permission (impractical at this scale, per this audit's own stated method), but the sheer consistency of the pattern — rather than ad hoc per-route checks — is itself a positive architectural signal.

### D.2 — No machine-to-machine authentication exists anywhere
Confirmed by reading `backend/app/core/auth.py` (session-cookie based) and `backend/app/core/platform_auth.py` (HTTP Basic for platform admins only). There is no API-key or service-token mechanism of any kind. This is the single structural prerequisite blocking all of PV-5 (Automation & CI/CD) — correctly identified as foundational, not incremental, by the project's own roadmap.

### D.3 — Idempotency key support is new and narrowly scoped
Migration `d8e9f0a1b2c3` adds an `idempotency_keys` table (confirmed to carry RLS), and per BR-87/GAP-67 this is wired into `POST /defects`, `POST /projects`, and `POST /projects/{id}/test-cases` only, as an opt-in header. Other create endpoints (e.g., Requirements, Comments, AI-generation endpoints added in later phases) were not retroactively given the same protection — a reasonable, explicitly-scoped decision at the time it was built (GAP-67's own note), but worth flagging since 3 new create-heavy endpoint families have been added since.

---

## E. Security

### E.1 — Generic exception handling is in place
`backend/app/main.py` registers, in order: `@app.exception_handler(AppError)` (line 77), `@app.exception_handler(RateLimitExceeded)` (line 85), and `@app.exception_handler(Exception)` (line 104) — confirmed directly. This closes what was previously SAAS-GAP-15/SR-9.8's documented gap.

### E.2 — Readiness vs. liveness split exists and is DB-aware
`backend/app/main.py` line 134 (`/api/v1/health`, liveness) and line 142 (`/api/v1/ready`, with an actual `SELECT 1`-style DB check per the surrounding code comment referencing SAAS-GAP-16) are both present and distinct.

### E.3 — Rate limiting remains narrowly scoped
Only `POST /auth/login` and `POST /auth/mfa/verify` carry `@limiter.limit` (confirmed via `SAAS_GAP_ANALYSIS.md`'s own grep, not independently re-run by this audit but corroborated by the single `rate_limit.py` import site pattern seen in `app/api/auth.py`). CSV import — a synchronous, per-request-heavy write endpoint capable of processing up to 2,000 rows — remains completely unthrottled. This is the most actionable near-term security/availability gap in the codebase given how cheap the existing limiter would be to extend.

### E.4 — Platform-admin credential is the weakest link in the system
`backend/app/core/platform_auth.py`'s plain HTTP Basic re-check, with no session expiry, no MFA, and no rotation workflow, protects the one account capable of provisioning or suspending every tenant in the system. By contrast, tenant-side auth has session timeout (idle + absolute), MFA, and rate limiting. This asymmetry (highest privilege, weakest protection) is a structural finding worth prioritizing independent of the broader SaaS-governance backlog it's filed under.

### E.5 — File-upload validation is now defense-in-depth
Confirmed two layers exist: an extension allowlist (BR-59/GAP-37) plus magic-byte/content-sniffing (BR-87/GAP-66) that rejects a mismatch between extension and actual file bytes. This is good practice and was independently corroborated by `SR-6.11`'s own "Done" verdict, which this audit agrees with.

### E.6 — Dependency vulnerability remediation is partial by deliberate choice
`KNOWN_GAPS.md` GAP-19 documents that `python-multipart` was fully patched but `starlette` (transitive via `fastapi==0.115.6`) remains on a CVE-affected version, because full remediation needs a ~25-minor-version `fastapi` jump (`>=0.140.0`) that was deliberately not attempted alongside other fixes, given its regression risk. This audit did not independently re-run `pip-audit` to confirm the CVE is still present, but the reasoning recorded for deferring it is sound and the deferral itself is the correct call for a "no drive-by fixes next to unrelated work" discipline — it should, however, be tracked as a live, not closed, item.

---

## F. UI / UX

### F.1 — Responsive/collapsible sidebar confirmed live in code
`frontend/src/routes/AppShell.tsx` lines 81-106 implement a `localStorage`-persisted `collapsed` boolean (`COLLAPSE_STORAGE_KEY = 'qtesthub:sidebar-collapsed'`) and apply `md:w-16`/`md:w-60` conditionally — a real, working implementation, not a stub. This closes what `SAAS_REQUIREMENTS.md` (SR-4.2/4.3) still describes as missing.

### F.2 — No toast/feedback system anywhere (confirmed, still open)
A grep for `toast|Toast|sonner` across `frontend/src` during the SaaS gap analysis returned zero hits; this audit found no later ADR addressing it. Every mutation's only feedback remains a dialog closing or a list silently re-querying via `onSuccess: () => queryClient.invalidateQueries(...)`. This genuinely degrades perceived reliability once the app runs over real network latency instead of localhost.

### F.3 — Accessibility scope is intentionally bounded, not comprehensive
`KNOWN_GAPS.md` GAP-22 explicitly states the accessibility pass (both the original and the ADR-041 extension) checks only `serious`/`critical`-impact axe violations under WCAG 2.1 A/AA tags — not `minor`/`moderate` findings, and not manual checks (full keyboard-only navigation, screen-reader narration quality). This is a reasonable, explicitly-scoped decision for catching user-blocking defects, but should not be characterized as "WCAG compliant" in any customer-facing or compliance claim (e.g., a VPAT) without a dedicated follow-up audit.

---

## G. Testing

### G.1 — Test suite breadth is real, not nominal
`SAAS_REQUIREMENTS.md`'s SR-9.6 claims "163 backend tests, real Postgres, not mocks" — this audit did not re-run the full suite, but the specific named tests cited throughout `REQUIREMENT_TRACEABILITY.md` and `KNOWN_GAPS.md` (e.g., `test_cross_tenant_isolation_on_user_list`, `test_concurrent_verdicts_on_different_steps_do_not_corrupt_rollup`, `test_disallowed_file_type_rejected`) are specific enough (naming exact race conditions, exact HTTP status codes, exact concurrency primitives) to be credible evidence of real tests rather than placeholder assertions — a pattern consistent across the entire hardening-pass history, not just a few cherry-picked examples.

### G.2 — A known, unresolved performance flake exists
`KNOWN_GAPS.md` GAP-69: `test_bulk_import_2000_rows_under_2.5_seconds` measured 2.59s/3.17s/2.59s in 3 of 4 isolated re-runs during a dedicated performance-testing pass — the NFR target is not reliably met on current dev hardware. Additionally, `GET /execution-steps/{id}/open` (53.79ms) and `/verdict` (73.73ms) both measure over the BRD's 50ms step-toggle target, and a test-case search/filter query measures 162ms against a 100ms target. **This audit did not independently re-run these performance tests** — reporting the existing finding as current, since no later ADR claims it was fixed (unlike the other GAP entries this audit cross-checked against code). Treat this as an open, real NFR risk, not resolved.

### G.3 — Concurrency testing exists but is thread-based, not multi-process
Both `test_concurrent_imports_do_not_corrupt_data` (GAP-42) and `test_concurrent_verdicts_on_different_steps_do_not_corrupt_rollup` (GAP-49) use `ThreadPoolExecutor` against a shared `TestClient` app instance. This is real evidence against gross corruption/deadlocks under concurrent access, but does not fully validate behavior under genuine multi-process/multi-replica production load — acceptable for current single-instance deployment scale, should be revisited if/when horizontal scaling (SAAS-GAP-3) is pursued.

### G.4 — Platform Administration UI success path not live-click-verified
`KNOWN_GAPS.md` GAP-26 explicitly notes the `/platform-admin` screen's create/approve/suspend success path was never driven live end-to-end (blocked by a prior session's own permission policy around creating disposable credentials) — it is backed only by the underlying API-level test suite, not a live UI click-through. This audit did not attempt to close that verification gap (out of scope for a read-only audit), but flags it as a known residual verification gap in an otherwise test-heavy codebase.
