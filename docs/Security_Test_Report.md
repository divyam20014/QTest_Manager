# Security Test Report — QTestHub

**Engagement:** Principal QA Architect / Application Security end-to-end testing pass
**Scope:** Authentication, MFA, tenant isolation, RBAC, cross-tenant access, IDOR, broken access control, privilege escalation, session management, authentication bypass, SQL injection, XSS, CSRF, file upload validation, sensitive data exposure, audit manipulation, unauthorized API access.
**Methodology:** Automated tests against the real backend (FastAPI + SQLAlchemy + PostgreSQL with Row-Level Security), run with `pytest` against the ASGI app and a real Postgres test database (no mocks on the data layer). Source code read directly for every claim — nothing below is inferred without verification. New tests added in `backend/tests/test_security_hardening.py` (73 collected test cases, including 56 parametrized route-enumeration cases); existing coverage drawn from `test_rls_isolation.py`, `test_auth_flow.py`, `test_auth_hardening.py`, `test_audit_integrity.py`, `test_attachments.py`.
**Result:** All 73 new security tests pass. **One genuine, pre-existing gap confirmed and documented** (file upload content-sniffing). No SQL injection surface exists. No privilege-escalation, IDOR, or unauthorized-access vulnerability found.

---

## 1. Cross-tenant access

**Status: PASS — strong, defense-in-depth coverage.**

- `backend/tests/test_rls_isolation.py` exercises cross-tenant isolation at **two layers**: the API layer (every module's list/detail endpoints) and the **database layer** (direct Postgres queries under Row-Level Security policies, bypassing the application entirely) — confirming a compromised or buggy application layer still cannot read another tenant's rows, because Postgres itself enforces the boundary.
- `test_no_tenant_context_denies_all_tenant_scoped_reads`: confirms a query issued with no tenant context set returns nothing, rather than defaulting to "all tenants."
- `test_auth_flow.py::test_cross_tenant_isolation_on_user_list`: confirms the user directory is tenant-scoped.

## 2. IDOR (Insecure Direct Object Reference)

**Status: PASS — no vulnerability found.**

Two new tests specifically target the IDOR class, distinct from mere list-scoping (an object merely not appearing in a filtered list is a different, weaker guarantee than a direct `GET`/`PATCH`/`DELETE` by ID being rejected):

- `test_idor_cross_tenant_mutation_attempts_404_not_leak`: a user in Tenant B issues `PATCH`/`DELETE` against a project, test case, and defect ID that genuinely exist — but belong to Tenant A. Every attempt returns **404**, not 403 and not 200. This is the correct behavior: RLS makes the row invisible to Tenant B's session, so the response doesn't even confirm the resource exists (a 403 would leak "this ID is real, you're just not allowed to touch it"; 404 leaks nothing).
- `test_idor_random_uuid_on_every_get_by_id_route_404s`: a UUID belonging to nobody returns an identical 404 on project/test-case/test-run/defect GET-by-id routes — confirming the 404 behavior above isn't an accident of a found-but-forbidden check, it's the same code path as "this ID was never real."

## 3. Broken access control / RBAC

**Status: PASS — both scattered pre-existing coverage and a new systematic sweep.**

Pre-existing: ~15–18 role-boundary tests distributed across `test_execution.py`, `test_defects.py`, `test_projects.py`, `test_audit_api.py`, `test_reporting.py` (e.g. `test_tester_cannot_approve`, `test_tester_cannot_finish_run`, `test_tester_cannot_close_but_can_advance_earlier_states`, `test_manager_can_list_users_but_tester_cannot`).

New, systematic:
- `test_every_protected_route_is_actually_protected`: confirms the route-enumeration helper actually discovered a non-trivial set of protected routes (56) — a sanity check that the sweep below isn't vacuously trivial.
- `test_no_session_cookie_rejects_every_protected_route` (parametrized × 56): walks every protected route across every router (users, projects, test-cases, execution, defects, reporting, audit, attachments, CSV import) and confirms **every single one** returns 401 with no session cookie at all.
- `test_tester_gets_403_on_a_sample_of_admin_and_manager_only_routes`: confirms a Tester session gets 403 (not 401, not 200) on a sample of Admin/Manager-only routes — user creation, audit export, project delete/create/member-management.

## 4. Privilege escalation

**Status: PASS — no vulnerability found.**

- `test_tester_cannot_self_escalate_to_admin` / `test_manager_cannot_self_escalate_to_admin`: a Tester and a Manager each attempt `PATCH /users/{their own id}` with `{"role": "admin"}`. Both get **403** (`update_user` requires the Admin-only `user.manage` permission regardless of whose record is being edited, including the caller's own). Confirmed via `GET /auth/me` afterward that the role genuinely did not change.

## 5. Session management

**Status: PASS — solid pre-existing coverage.**

- `test_auth_hardening.py::test_idle_session_timeout_expires_session`: a session idle past the configured TTL is rejected.
- `test_auth_hardening.py::test_admin_password_reset_revokes_existing_sessions`: an Admin-initiated password reset revokes every existing session for that user (can't be bypassed by an already-open session after a suspected-compromise reset).
- `test_auth_flow.py::test_logout_revokes_session`, `test_mfa_lockout_after_three_attempts`.
- **Gap noted, not closed this pass:** no test for multiple concurrent sessions for one user (e.g. listing/selectively revoking one session without affecting others) — no such UI/API feature exists to test.

## 6. Authentication bypass

**Status: PASS.**

- Covered by the §3 systematic sweep (56 routes × no-cookie → 401) plus `test_platform_requires_authentication` (platform-tenant-creation endpoint) and `test_no_tenant_context_denies_all_tenant_scoped_reads`.
- `test_auth_flow.py::test_wrong_password_is_generic_error`: login failure returns a generic "Invalid tenant, email, or password" message regardless of whether the tenant, email, or password was wrong — prevents user-enumeration via differential error messages.

## 7. SQL injection

**Status: PASS — no attack surface exists.**

Every raw-SQL call site in `backend/app/` was read directly:
- `app/core/audit.py:35` (`pg_advisory_xact_lock`) — bound `:tenant_id` parameter.
- `app/core/db.py:41` (`set_tenant_context`) — bound parameter.
- `app/services/csv_import_service.py:253` (bulk UPDATE) — bound parameters.

**Zero** f-string-interpolated, `.format()`-interpolated, or `%`-interpolated SQL exists anywhere in `backend/app/`. Everything else is SQLAlchemy ORM/Core query-building, which parameterizes automatically. There is no code path for a classic SQL injection payload to reach the database as executable SQL — not "no test found a hole," but "there is no hole-shaped code to test." No test was added for this item since there is no attack surface to exercise.

## 8. XSS (Cross-Site Scripting)

**Status: PASS (by construction) — low residual risk, not independently test-covered.**

Grep across `frontend/src` for `dangerouslySetInnerHTML` or any raw-innerHTML-equivalent pattern returned **zero hits**. Every user-supplied string (test case titles/descriptions, defect descriptions, project names, etc.) is rendered through ordinary JSX text interpolation, which React auto-escapes by default. No test was added specifically asserting a `<script>`-containing title renders escaped — this is a gap in explicit test coverage, but the code construction itself (no raw-HTML injection point exists anywhere in the frontend) makes a stored-XSS vulnerability structurally absent rather than merely "not yet found."

## 9. CSRF (Cross-Site Request Forgery)

**Status: Documented, accepted design — not a built-and-verified token mechanism.**

- `test_session_cookie_is_httponly_and_samesite_lax`: confirms the session cookie is actually set with `httponly=True` and `samesite="lax"` (read from the real `Set-Cookie` response header after MFA verification, not just from source).
- Source confirmation: `app/core/auth.py::set_session_cookie` (lines 131–139) — `secure=settings.environment != "development"`.
- **No CSRF token mechanism exists anywhere** (`grep -ri csrf` across both backend and frontend: zero hits).
- **What this actually means:** `SameSite=Lax` is real, meaningful protection against the classic CSRF pattern (a third-party site issuing a cross-origin state-changing `POST`/`PATCH`/`DELETE` via an auto-submitting form or `fetch`) in every modern browser — such a request simply won't carry the session cookie. It is **not** complete defense-in-depth (a same-site redirect chain or a browser without SameSite support would not be covered), and there is no second layer (CSRF token) behind it. This is a deliberate, accepted design choice for this pass, not something this engagement built — adding a token-based CSRF mechanism would be new application infrastructure, out of scope for a testing-only pass per the brief ("do not add new business features"). **Recommendation for a future pass:** add a double-submit CSRF token if this app will ever be embedded or accept requests from less-strict browser contexts.

## 10. File upload validation

**Status: FINDING — confirmed, pre-existing gap, documented not fixed.**

`backend/app/services/attachment_service.py` (lines 25–28, 82–87) enforces an **extension-based allowlist only** (`Path(file.filename).suffix.lower()` checked against a fixed set of permitted extensions: png/jpg/jpeg/gif/webp/bmp/pdf/doc/docx/xls/xlsx/csv/txt/log) — there is no magic-byte/content-type sniffing of the actual file bytes.

- Existing coverage: `test_attachments.py::test_disallowed_file_type_rejected` (a `.exe` file is correctly rejected), `test_attachment_exceeding_size_limit_rejected`, `test_empty_attachment_rejected` — all PASS, these guard the allowlist mechanism itself.
- **New finding:** `test_attachment_allowlist_is_extension_only_not_content_sniffed` uploads a file named `innocuous.txt` whose actual byte content is an ELF binary header + shell script payload. **The upload is accepted (HTTP 200).** A malicious binary disguised with a permitted extension passes validation today.
- **Severity assessment for this application's actual threat model:** moderate-to-low. Attachments are stored on disk under a tenant/test-case-scoped path and are only ever served back for **download** — the application never executes an uploaded file server-side, and the content-disposition on download is `attachment` (forces save, not inline render) per the existing attachment download implementation. The practical risk is a malicious file being stored and later downloaded by another user who then executes it locally on their own machine — a real but secondary risk (same category as email attachment hygiene), not a direct server-compromise vector.
- **Recommendation:** add magic-byte/content-type sniffing (e.g. via `python-magic` or a signature-based check) as a follow-up hardening item if this is judged worth closing — this was deliberately **not built** in this pass (new validation logic is new application behavior, out of the "no new business features" scope for a testing-only engagement), only confirmed and documented per the brief's instruction to report actual results, not mark gaps as passing.

## 11. Sensitive data exposure

**Status: PASS — clean.**

- `backend/app/schemas/user.py::UserOut` and `backend/app/schemas/auth.py::MeResponse` were read directly: both expose only `id`/`email`/`name`/`role`/`is_active`/`created_at`. Grepped every schema file in `backend/app/schemas/*.py` for `password` — the string appears **only** in the login/create/reset **request** schemas, never in any response schema. No endpoint anywhere returns a password hash.
- Audit event metadata (`record_audit_event` call sites across `auth_service.py`, `user_service.py`, and every other service) was reviewed: no password, token, MFA code, or session identifier is ever passed into `metadata=`. Confirmed this still holds after this session's earlier Audit Management hardening pass, which also added `metadata` to the audit API's read response — the metadata being returned now is the same metadata that was already confirmed clean.

## 12. Audit manipulation

**Status: PASS — defended at three independent layers.**

1. **No mutation route exists at all.** `test_audit_logs_router_exposes_zero_mutation_routes`: a route-table scan confirms zero PUT/PATCH/DELETE/POST routes are registered anywhere under `/audit-logs`.
2. **Even an attempted mutation request 404s**, not 405. `test_unregistered_mutation_methods_on_audit_logs_are_rejected`: PUT/PATCH/DELETE against `/audit-logs/{id}` return 404 — there isn't even a GET-by-id route to target, so there's no routable path at all, which is stronger than a 405 Method Not Allowed would be.
3. **Database-level enforcement**, pre-existing and re-confirmed: `test_audit_integrity.py::test_audit_logs_are_insert_only_for_the_application_role` literally executes `DELETE FROM audit_logs` as the application's own restricted DB role inside the test and asserts Postgres itself rejects it — the `REVOKE UPDATE, DELETE ON audit_logs FROM qtesthub_app` grant from `backend/alembic/versions/7bca6b69ef88_...py` is exercised directly, not merely inferred from reading the migration.
4. Tamper-evidence: the SHA-256 hash chain (`app/core/audit.py`) and its independent re-verification endpoint (`GET /audit-logs/verify-chain`, tested in `test_audit_api.py`) mean that even in a scenario where layers 1–3 were somehow bypassed (e.g. a privileged database administrator with superuser access), tampering would still be **detectable** on the next verify-chain run — documented as a known, intentional limitation (detection, not prevention, against a privileged DBA) in `docs/KNOWN_GAPS.md` GAP-01, unchanged by this pass.

## 13. Unauthorized API access

**Status: PASS — now systematically covered (previously spot-check only).**

See §3 and §6 — the new 56-route parametrized sweep (`test_no_session_cookie_rejects_every_protected_route`) is the first systematic (not spot-check) confirmation that every protected endpoint, across every router, genuinely requires a valid session.

---

## Summary table

| Area | Status | New tests | Pre-existing |
|---|---|---|---|
| Cross-tenant access | PASS | — | Strong (DB + API layer) |
| IDOR | PASS | 2 | — |
| Broken access control / RBAC | PASS | 3 (incl. 56 parametrized) | ~15–18 scattered |
| Privilege escalation | PASS | 2 | — |
| Session management | PASS | — | Strong |
| Authentication bypass | PASS | covered by sweep | 2 |
| SQL injection | PASS (no attack surface) | 0 (nothing to test) | — |
| XSS | PASS (by construction) | 0 | — |
| CSRF | Documented, accepted design | 1 | — |
| File upload validation | **FINDING** | 1 | 3 |
| Sensitive data exposure | PASS | — (verified by review) | — |
| Audit manipulation | PASS | 2 | 1 |
| Unauthorized API access | PASS | covered by sweep | — |

**Total new security tests: 73 (11 test functions, 56 of them parametrized route-enumeration cases). All 73 pass.**

## Outstanding risks (carried forward, not closed in this pass)

1. **File upload content-sniffing gap** (§10) — moderate-to-low severity given this app's storage-and-download-only usage pattern; recommend a future hardening pass if judged worth the new-feature scope.
2. **No CSRF token (defense-in-depth)** (§9) — `SameSite=Lax` provides real but not complete protection; accepted as-is per existing design, not newly discovered.
3. **No XSS-specific regression test** (§8) — structurally low risk (no raw-HTML injection point exists), but a `<script>`-payload regression test would make this an explicitly-verified guarantee rather than an inference from code construction.
4. Pre-existing, unchanged by this pass (see `docs/KNOWN_GAPS.md`): audit hash-chain is tamper-evident, not tamper-proof against a privileged DBA (GAP-01); platform-level tenant actions aren't attributed to an individual platform admin (GAP-13); Platform Admin auth has no session/MFA (GAP-14).
