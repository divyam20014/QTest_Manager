# Sequence Diagrams

**Purpose**: show the real request/response/DB-interaction order for the major workflows, including authentication checks, error branches, and background-process interleaving.
**Scope**: 9 workflows selected to cover every major module (auth, test authoring, execution, defects, CI/CD, AI, bulk data, reporting) and all three distinct auth planes.

## 1. Login + MFA

**Diagram source**: [`diagrams/seq-login-mfa.mmd`](diagrams/seq-login-mfa.mmd)
**Source**: `backend/app/api/auth.py` (`login`, `verify_mfa`), `backend/app/services/auth_service.py`, `backend/app/core/auth.py`, `frontend/src/routes/Login.tsx`

```mermaid
sequenceDiagram
    actor U as User (Browser)
    participant FE as React SPA (Login.tsx)
    participant API as FastAPI (auth.py)
    participant SVC as auth_service
    participant DB as PostgreSQL

    U->>FE: Enter tenant_id, email, password
    FE->>API: POST /api/v1/auth/login
    API->>API: slowapi rate limit check (10/min per IP)
    API->>SVC: start_login(tenant_id, email, password, request)
    SVC->>DB: SELECT tenants.status WHERE id=tenant_id
    alt tenant not approved
        SVC-->>API: 403 Forbidden (tenant suspended/pending)
        API-->>FE: error envelope
    else tenant approved
        SVC->>DB: SELECT users WHERE tenant_id, email
        alt invalid credentials
            SVC-->>API: 401 Unauthorized (generic, no enumeration - ADR-017)
        else valid credentials
            SVC->>DB: INSERT sessions (mfa_verified=false)
            SVC->>DB: INSERT mfa_challenges (code_hash, expires_at)
            Note over SVC: MFA_DELIVERY_MODE=simulated:<br/>code returned in response.<br/>=real: emailed via SMTP (app/core/mfa.py)
            SVC-->>API: session_row, debug_code (simulated only)
            API-->>FE: Set-Cookie qth_session; {mfa_required:true, debug_code?}
        end
    end
    FE->>U: Show MFA code entry screen
    U->>FE: Enter 6-digit code
    FE->>API: POST /api/v1/auth/mfa/verify {code}
    API->>SVC: verify_mfa(session_id, code)
    SVC->>DB: SELECT mfa_challenges ... FOR UPDATE
    alt code incorrect / expired / attempt_count exceeded
        SVC->>DB: increment attempt_count
        SVC-->>API: 401 Unauthorized
    else code correct
        SVC->>DB: UPDATE sessions SET mfa_verified=true
        SVC->>DB: UPDATE mfa_challenges SET verified_at=now()
        SVC-->>API: session_row
        API-->>FE: Set-Cookie qth_session (refreshed); {verified:true}
    end
    FE->>API: GET /api/v1/auth/me
    API->>API: get_current_context (parse cookie, resolve SessionContext)
    API-->>FE: user, tenant_id, role, permissions[]
    FE->>U: Redirect to Dashboard
```

**Notes**: the `SELECT ... FOR UPDATE` row lock on the MFA challenge (GAP-17) closes a race where concurrent verify attempts could each read the same pre-increment `attempt_count`. Rate limiting is keyed by client IP (not `(tenant_id, email)`), a deliberate simplification documented in `docs/KNOWN_GAPS.md` GAP-16.

## 2. Tenant SSO (OIDC Authorization Code Flow)

**Diagram source**: [`diagrams/seq-sso-oidc.mmd`](diagrams/seq-sso-oidc.mmd)
**Source**: `backend/app/api/sso.py`, `backend/app/services/sso_service.py`

```mermaid
sequenceDiagram
    actor U as User (Browser)
    participant FE as React SPA (Login.tsx)
    participant API as FastAPI (sso.py)
    participant SVC as sso_service
    participant DB as PostgreSQL
    participant IdP as Tenant Identity Provider

    U->>FE: Enter tenant_id (UUID), click "Sign in with SSO"
    FE->>API: GET /api/v1/auth/sso/{tenant_id}/status
    API->>SVC: is_enabled(tenant_id)
    SVC->>DB: SELECT sso_configs WHERE tenant_id
    API-->>FE: {enabled: true/false}
    alt SSO enabled
        FE->>U: window.location.href = /auth/sso/{tenant_id}/login (full redirect)
        U->>API: GET /api/v1/auth/sso/{tenant_id}/login
        API->>SVC: get_config(tenant_id); build_authorization_url()
        API->>API: generate random state, set httponly qth_sso_state cookie
        API-->>U: 302 Redirect to IdP authorization_endpoint
        U->>IdP: Authenticate (IdP's own login UI)
        IdP-->>U: 302 Redirect to /auth/sso/{tenant_id}/callback?code&state
        U->>API: GET /api/v1/auth/sso/{tenant_id}/callback?code&state
        API->>API: validate state cookie == state param
        API->>SVC: exchange_code_and_provision(tenant_id, code, redirect_uri)
        SVC->>IdP: POST token_endpoint (exchange code for tokens)
        IdP-->>SVC: id_token / access_token
        SVC->>DB: SELECT users WHERE tenant_id, email (from id_token claims)
        alt user does not exist
            SVC->>DB: INSERT users (role = sso_configs.default_role_code, tester by default)
        end
        SVC->>DB: INSERT sessions (mfa_verified=true - IdP already authenticated)
        SVC-->>API: session_row
        API-->>U: Set-Cookie qth_session; 302 Redirect to "/"; delete qth_sso_state
        U->>FE: Load SPA at "/"
        FE->>API: GET /api/v1/auth/me
        API-->>FE: session context
    else SSO not enabled
        FE->>U: "SSO is not configured for this organization"
    end
```

**Notes**: SSO-provisioned users are never auto-granted admin — `default_role_code` defaults to `tester`. The CSRF-style `state` cookie is `httponly`/`samesite=lax` with a 600-second max age.

## 3. Test Case Creation, Versioning & Approval

**Diagram source**: [`diagrams/seq-testcase-approval.mmd`](diagrams/seq-testcase-approval.mmd)
**Source**: `backend/app/api/test_cases.py`, `backend/app/services/test_case_service.py`

```mermaid
sequenceDiagram
    actor Author as Test Case Author
    actor Reviewer as Reviewer (reviewer_id or testcase.approve holder)
    participant API as FastAPI (test_cases.py)
    participant SVC as test_case_service
    participant DB as PostgreSQL

    Author->>API: POST /projects/{id}/test-cases {title, priority, steps[]}
    API->>SVC: create_test_case(...)
    SVC->>DB: INSERT test_cases (status='draft')
    SVC->>DB: INSERT test_case_versions (version_number=1)
    SVC->>DB: INSERT test_case_version_steps
    SVC->>DB: UPDATE test_cases SET current_version_id
    SVC->>DB: INSERT audit_logs (action=test_case.created)
    SVC-->>API: TestCaseOut
    API-->>Author: 201 Created

    Author->>API: PATCH /test-cases/{id} {status: 'ready_for_review', reviewer_id?}
    API->>SVC: update_test_case(...) -> forks new version if content changed
    SVC->>DB: INSERT test_case_versions (version_number+1) [if edited]
    SVC->>DB: UPDATE test_cases SET status='ready_for_review'
    SVC->>DB: INSERT notifications (type=review_requested, recipient=reviewer)
    SVC-->>API: TestCaseOut

    Reviewer->>API: POST /test-cases/{id}/approve
    API->>API: require_permission(testcase.approve) OR ctx.user_id == reviewer_id
    API->>SVC: approve_test_case(...)
    SVC->>DB: UPDATE test_case_versions SET approved_by, approved_at
    SVC->>DB: UPDATE test_cases SET status='approved'
    SVC->>DB: INSERT notifications (type=review_decided)
    SVC->>DB: INSERT audit_logs (action=test_case.approved)
    SVC-->>API: TestCaseOut
    API-->>Reviewer: 200 OK

    alt Reviewer requests changes instead
        Reviewer->>API: POST /test-cases/{id}/request-changes {comment}
        API->>SVC: request_changes(...)
        SVC->>DB: UPDATE test_cases SET status='draft'
        SVC->>DB: INSERT notifications (type=review_decided)
        SVC-->>API: TestCaseOut
    end

    Note over SVC,DB: Immutable snapshot model (ADR-001/003):<br/>TestCaseVersion rows are never updated once created.<br/>Every content edit after 'approved' forks a new version.
```

## 4. Test Run Creation & Step-by-Step Execution

**Diagram source**: [`diagrams/seq-test-execution.mmd`](diagrams/seq-test-execution.mmd)
**Source**: `backend/app/api/execution.py`, `backend/app/services/execution_service.py`, `frontend/src/routes/execution/ExecutionConsole.tsx`

```mermaid
sequenceDiagram
    actor Mgr as Manager
    actor Tester as Assigned Tester
    participant API as FastAPI (execution.py)
    participant SVC as execution_service
    participant DB as PostgreSQL

    Mgr->>API: POST /projects/{id}/test-runs {name, run_type, test_case_ids[]}
    API->>SVC: create_test_run(...)
    SVC->>DB: SELECT test_cases WHERE status='approved' (only approved cases runnable)
    SVC->>DB: INSERT test_runs
    loop for each approved test case (x each data row, if parameterized)
        SVC->>DB: INSERT test_run_cases (pinned to current_version_id)
    end
    SVC->>DB: INSERT audit_logs (action=test_run.created)
    SVC-->>API: TestRunOut
    API-->>Mgr: 201 Created

    Mgr->>API: PATCH /test-run-cases/{id}/assign {assigned_to}
    API->>SVC: assign_run_case(...)
    SVC->>DB: UPDATE test_run_cases SET assigned_to
    SVC->>DB: INSERT notifications (type=run_case_assigned)
    SVC-->>API: 200 OK

    Tester->>API: GET /test-run-cases/{id}/context
    API-->>Tester: run name, project, case title, priority, version, assignee

    Tester->>API: POST /execution-steps/{id}/open
    API->>SVC: open_step(...)
    Note over SVC: Strict access control: only test_run_cases.assigned_to<br/>== ctx.user_id may act on this step (confirmed design decision)
    SVC->>DB: UPDATE execution_steps SET opened_at=now()
    SVC-->>API: ExecutionStepOut
    API-->>Tester: step opened, live elapsed timer starts (frontend)

    Tester->>API: POST /execution-steps/{id}/verdict {verdict: 'fail'}
    API->>SVC: record_verdict(...)
    SVC->>DB: SELECT test_run_cases ... FOR UPDATE (row lock, GAP-49 fix)
    SVC->>DB: UPDATE execution_steps SET verdict, closed_at, duration_ms
    SVC->>SVC: _recompute_run_case_status() (re-read all step verdicts)
    SVC->>DB: UPDATE test_run_cases SET status
    SVC->>DB: INSERT audit_logs (action=execution_step.verdict_recorded)
    SVC-->>API: ExecutionStepOut
    API-->>Tester: verdict recorded

    alt verdict == 'fail'
        Tester->>API: POST /defects (DefectQuickCreateDialog, prefilled context)
        Note over Tester,API: Expected Result defaults from the<br/>originating step's own `expected` text
        API-->>Tester: Defect created, linked via test_case_version_step_id
    end

    opt Run case fully verdicted
        SVC->>DB: INSERT notifications (type=test_run_completed) [if last case]
    end
```

**Notes**: access control here is **Strict** per an explicit product decision made during this engagement (`execution access = "Strict: assigned-to-them only"`) — a tester who is not `test_run_cases.assigned_to` cannot act on that case's steps at all, not even to view-only.

## 5. Defect Creation and Status Lifecycle

**Diagram source**: [`diagrams/seq-defect-lifecycle.mmd`](diagrams/seq-defect-lifecycle.mmd)
**Source**: `backend/app/api/defects.py`, `backend/app/services/defect_service.py`

```mermaid
sequenceDiagram
    actor Rep as Reporter
    actor Tri as Triager (Manager/Admin)
    participant API as FastAPI (defects.py)
    participant SVC as defect_service
    participant DB as PostgreSQL
    participant Worker as Background Worker

    Rep->>API: POST /defects {title, severity, priority, steps_to_reproduce, ...}
    API->>API: require_permission(defect.create)
    API->>SVC: create_defect(...)
    SVC->>DB: INSERT defects (status='New')
    SVC->>DB: INSERT audit_logs (action=defect.created)
    SVC-->>API: DefectOut
    API-->>Rep: 201 Created

    Tri->>API: PATCH /defects/{id}/status {status: 'Open'}
    API->>SVC: update_status(...)
    Note over SVC: Forward-only sequence (ADR-026):<br/>New -> Open -> Fixed -> Verified -> Closed
    SVC->>DB: UPDATE defects SET status='Open'
    SVC->>DB: INSERT audit_logs

    Tri->>API: PATCH /defects/{id} {assigned_to, root_cause, environment_id}
    API->>SVC: update_defect(...)
    SVC->>DB: UPDATE defects

    Tri->>API: PATCH /defects/{id}/status {status: 'Closed', verification_confirmed: true}
    API->>API: 422 if verification_confirmed != true
    API->>SVC: update_status(..., status='Closed')
    SVC->>DB: UPDATE defects SET status='Closed', closed_at=now()
    SVC->>DB: INSERT notifications (type=defect_closed)
    SVC->>DB: INSERT audit_logs

    alt Defect reopened later
        Tri->>API: POST /defects/{id}/reopen
        API->>SVC: reopen_defect(...)
        SVC->>DB: UPDATE defects SET status='Open', reopened_count+=1, last_reopened_at=now()
    end

    loop Every 5 minutes (worker poll)
        Worker->>SVC: sweep_sla_breaches(db)
        SVC->>DB: SELECT defects WHERE aging exceeds budget AND sla_breach_notified_at IS NULL
        alt breach found
            SVC->>DB: INSERT notifications (type=defect_sla_breach)
            SVC->>DB: UPDATE defects SET sla_breach_notified_at=now()
        end
    end
```

## 6. CI/CD Webhook Result Ingestion (M2M Auth Plane)

**Diagram source**: [`diagrams/seq-ci-webhook.mmd`](diagrams/seq-ci-webhook.mmd)
**Source**: `backend/app/api/ci.py`, `backend/app/core/service_token_auth.py`, `backend/app/services/service_token_service.py`

```mermaid
sequenceDiagram
    actor Admin as Tenant Admin
    participant API as FastAPI (service_tokens.py)
    participant SVC as service_token_service
    participant DB as PostgreSQL
    participant CI as CI/CD Pipeline
    participant CIAPI as FastAPI (ci.py)
    participant ExecSVC as execution_service

    Admin->>API: POST /service-tokens {name, scope: 'ci_results'}
    API->>SVC: create_token(...)
    SVC->>SVC: generate random secret
    SVC->>DB: INSERT service_tokens (token_hash = argon2(secret))
    SVC-->>API: plaintext secret (shown once)
    API-->>Admin: token name + secret

    Note over CI: CI pipeline stores secret, posts results<br/>at end of automated test run

    CI->>CIAPI: POST /ci/{tenant_id}/webhooks/test-results<br/>Authorization: Bearer <secret><br/>{results: [{test_run_case_id, status}, ...]}
    CIAPI->>CIAPI: slowapi rate limit (30/min)
    CIAPI->>SVC: authenticate(tenant_id, bearer_secret, scope='ci_results')
    SVC->>DB: SELECT service_tokens WHERE tenant_id, revoked_at IS NULL
    SVC->>SVC: argon2 verify hash
    alt token invalid / revoked / wrong scope
        SVC-->>CIAPI: 401 Unauthorized
    else token valid
        SVC->>DB: UPDATE service_tokens SET last_used_at=now()
        SVC-->>CIAPI: ServiceToken
        loop for each result row
            CIAPI->>ExecSVC: record_ci_result(tenant_id, test_run_case_id, status, token.id)
            ExecSVC->>DB: set_tenant_context(db, tenant_id) [re-asserted per row]
            ExecSVC->>DB: UPDATE test_run_cases / execution_steps
            ExecSVC->>DB: INSERT audit_logs (service_token_id=token.id)
            alt row fails (unknown id, finished run)
                ExecSVC-->>CIAPI: AppError (per-row, does not abort batch)
            end
        end
        CIAPI-->>CI: 200 {accepted_count, rejected_count, outcomes[]}
    end
```

**Notes**: `set_tenant_context` is re-asserted per row because the Postgres session-scoped GUC resets on every commit/rollback — a recurring bug class across this codebase, documented and fixed everywhere it was found.

## 7. AI QA Assistant Query / AI Defect Assistant Root-Cause Suggestion

**Diagram source**: [`diagrams/seq-ai-assistant.mmd`](diagrams/seq-ai-assistant.mmd)
**Source**: `backend/app/api/ai.py`, `backend/app/services/ai_service.py`, `backend/app/core/ai/gemini_provider.py`, `backend/app/core/crypto.py`

```mermaid
sequenceDiagram
    actor U as Tenant User
    participant FE as React SPA
    participant API as FastAPI (ai.py)
    participant SVC as ai_service
    participant Crypto as app/core/crypto.py (Fernet)
    participant Provider as gemini_provider.py
    participant DB as PostgreSQL
    participant Gemini as Gemini API

    U->>FE: Ask QA Assistant a question
    FE->>API: POST /ai/assistant/query {question}
    API->>API: slowapi rate limit (20/min)
    API->>SVC: answer_assistant_question(tenant_id, role_code, user_id, question)
    SVC->>DB: SELECT tenants.ai_enabled, ai_api_key_encrypted WHERE id=tenant_id
    alt AI not enabled for tenant
        SVC-->>API: AppError (ai_not_configured)
        API-->>FE: error envelope
    else AI enabled
        SVC->>Crypto: decrypt(ai_api_key_encrypted)
        Crypto-->>SVC: plaintext API key (never logged/returned)
        SVC->>DB: gather relevant context (test cases, defects, requirements\nscoped to tenant + role-visible projects)
        SVC->>Provider: generate(prompt, api_key, model=settings.gemini_model)
        Provider->>Gemini: POST /v1beta/models/{model}:generateContent
        alt Gemini error (e.g. 404 deprecated model, timeout)
            Gemini-->>Provider: error response
            Provider-->>SVC: AppError (ai_provider_error)
            SVC->>DB: INSERT ai_usage_logs (success=false)
            SVC-->>API: error envelope
        else success
            Gemini-->>Provider: generated content + token counts
            Provider-->>SVC: AssistantAnswer
            SVC->>DB: INSERT ai_usage_logs (success=true, prompt/completion/total_tokens)
            SVC-->>API: AssistantAnswer
            API-->>FE: 200 {answer, token_usage}
        end
    end
    FE->>U: Render conversational answer

    Note over SVC,Gemini: AI Defect Assistant root-cause suggestion follows<br/>the identical decrypt -> prompt -> generate -> meter<br/>pattern, scoped to one defect's context instead of<br/>a free-form question (same ai_service.py module).
```

## 8. CSV Bulk Import (Flexible Field-Mapping Flow)

**Diagram source**: [`diagrams/seq-csv-bulk-import.mmd`](diagrams/seq-csv-bulk-import.mmd)
**Source**: `backend/app/api/csv_import.py`, `backend/app/services/csv_import_service.py`

```mermaid
sequenceDiagram
    actor U as Tenant User
    participant FE as React SPA (ImportDialog.tsx)
    participant API as FastAPI (csv_import.py)
    participant SVC as csv_import_service
    participant DB as PostgreSQL

    U->>FE: Select CSV file, optionally choose a tool preset\n(TestRail/Zephyr/Jira)
    FE->>API: POST /test-cases/import/detect-columns?preset=testrail (file)
    API->>API: validate extension/.csv, size <= csv_import_max_bytes, UTF-8 decode
    API->>SVC: detect_columns(csv_text, preset)
    SVC->>SVC: parse header + sample rows,\nfuzzy-match to a suggested column mapping
    SVC-->>API: {headers, sample_rows, suggested_mapping}
    API-->>FE: 200 OK (nothing written to DB yet)
    FE->>U: Show mapping confirmation UI (editable)

    U->>FE: Confirm/adjust mapping, submit
    FE->>API: POST /test-cases/import/mapped (file, mapping JSON)
    API->>API: require_permission(testcase.bulk_import_export)
    API->>SVC: import_test_cases_mapped(tenant_id, role_code, user_id, csv_text, mapping)
    SVC->>SVC: materialize all rows up front;\nreject whole file if rows > csv_import_max_rows (2000)
    SVC->>DB: preload existing (project_id, title_lower) pairs
    loop for each row
        SVC->>SVC: validate required fields, detect in-batch duplicate title
        alt row invalid or duplicate
            SVC->>SVC: record row error (does not abort batch)
        else row valid
            SVC->>DB: INSERT test_cases, test_case_versions, steps
        end
    end
    SVC->>DB: INSERT audit_logs (action=test_case.bulk_imported)
    SVC-->>API: ImportReport {created_count, errors[]}
    API-->>FE: 200 OK
    FE->>U: Show results; "Download Error Report (CSV)" if any errors
```

**Notes**: the TestRail/Zephyr/Jira preset mappings are fuzzy-matched suggestions, explicitly labeled in the UI as unverified against a real export from those tools (no real accounts/files were available in this environment to validate against).

## 9. Scheduled / Emailed Compliance PDF Report

**Diagram source**: [`diagrams/seq-scheduled-report.mmd`](diagrams/seq-scheduled-report.mmd)
**Source**: `backend/app/api/report_schedule.py`, `backend/app/services/report_schedule_service.py`, `backend/app/core/pdf_report.py`, `backend/app/worker.py`

```mermaid
sequenceDiagram
    actor Admin as Tenant Admin
    participant API as FastAPI (report_schedule.py)
    participant DB as PostgreSQL
    participant Worker as app/worker.py (poll loop)
    participant SVC as report_schedule_service
    participant PDF as app/core/pdf_report.py (reportlab)
    participant SMTP as SMTP Server

    Admin->>API: POST /report-schedules {cadence: 'weekly', recipient_emails[]}
    API->>DB: INSERT report_schedules (enabled=true)
    API-->>Admin: 201 Created

    loop every 900s (worker tick)
        Worker->>SVC: run_due_schedules(db)
        SVC->>DB: SELECT report_schedules WHERE enabled\nAND due (cadence vs last_run_at)
        loop for each due schedule, per tenant
            SVC->>DB: set_tenant_context(db, schedule.tenant_id)
            SVC->>DB: gather compliance report data\n(reuses reporting_service aggregation)
            SVC->>PDF: render_compliance_pdf(report_data)
            PDF-->>SVC: PDF bytes
            SVC->>SMTP: send email (PDF attachment) to recipient_emails
            SVC->>DB: UPDATE report_schedules SET last_run_at=now()
        end
    end

    Note over SVC,PDF: reportlab chosen over weasyprint: pure-Python,\nno system pango/cairo/gdk-pixbuf dependency,\nno Dockerfile changes needed (Pass 4 decision).
```

## Not Identified in Current Implementation

- A SCIM provisioning sequence diagram was not produced — `scim.py`/`scim_service.py` are real, routed code, but were not independently re-verified end-to-end as part of this documentation pass, so a diagram would risk asserting detail not freshly confirmed against the current code.
- GDPR physical-erasure and WORM audit-log-shipping sequences do not exist because the underlying features do not exist yet (see `PROCESS_FLOW_DIAGRAMS.md`'s GDPR flowchart and `docs/KNOWN_GAPS.md` GAP-01/GAP-03).
