# Data Flow Diagrams (DFD)

**Purpose**: trace how data moves between external entities, processes, and data stores, at increasing levels of detail.
**Scope**: Level 0 (whole-system context), Level 1 (application-wide process map), Level 2 (per-module detail for Test Execution, Defect Management, RBAC/Auth, and AI Assistant Services — the four modules judged most structurally significant; Project/Test-Case-Authoring and Reporting flows are covered at Level 1 granularity and in the Sequence Diagrams document instead of a dedicated Level 2, to avoid near-duplicate diagrams).

## Level 0 — Context Diagram

**Diagram source**: [`diagrams/dfd-level0.mmd`](diagrams/dfd-level0.mmd)

```mermaid
flowchart LR
    TenantUser(["Tenant User\n(Admin/Manager/Tester/Custom Role)"])
    PlatformAdmin(["Platform Administrator"])
    CISystemEnt(["CI/CD Pipeline"])
    IdPEnt(["Tenant Identity Provider"])
    EmailRecipients(["Report Email Recipients"])
    GeminiEnt(["Gemini AI Provider"])

    QTestHub{{"QTestHub\nTest Management Platform"}}

    TenantUser -- "Login, test authoring, execution,\ndefect triage, reporting" --> QTestHub
    QTestHub -- "Dashboards, test/defect data,\nnotifications, reports" --> TenantUser

    PlatformAdmin -- "Tenant provisioning,\napprove/suspend" --> QTestHub
    QTestHub -- "Tenant status, audit trail" --> PlatformAdmin

    CISystemEnt -- "Automated test result webhooks\n(bearer service token)" --> QTestHub
    QTestHub -- "Accept/reject outcomes" --> CISystemEnt

    IdPEnt -- "OIDC identity assertion" --> QTestHub
    QTestHub -- "Authorization redirect" --> IdPEnt

    QTestHub -- "Scheduled compliance report (PDF)" --> EmailRecipients

    QTestHub -- "Test-case generation / review /\nassistant query prompts" --> GeminiEnt
    GeminiEnt -- "Generated content" --> QTestHub
```

**External entities**: Tenant User, Platform Administrator, CI/CD Pipeline, Tenant Identity Provider, Report Email Recipients, Gemini AI Provider. **Observation**: QTestHub has exactly one inbound unauthenticated-but-stateful entry point (SSO callback) and one fully machine-to-machine entry point (CI webhook) — both are deliberately separate from the human session-cookie plane.

## Level 1 — Application Data Flow

**Diagram source**: [`diagrams/dfd-level1.mmd`](diagrams/dfd-level1.mmd)

```mermaid
flowchart TB
    TenantUser(["Tenant User"])
    PlatformAdmin(["Platform Admin"])
    CISystemEnt(["CI/CD System"])
    IdPEnt(["Identity Provider"])

    P1["1.0 Authentication &\nSession Management\napp/api/auth.py, sso.py"]
    P2["2.0 RBAC & Permission\nEnforcement\napp/core/auth.py, roles.py"]
    P3["3.0 Project & Portfolio\nManagement\napp/api/projects.py"]
    P4["4.0 Test Case Authoring &\nVersioning\napp/api/test_cases.py"]
    P5["5.0 Test Execution\nEngine\napp/api/execution.py"]
    P6["6.0 Defect\nManagement\napp/api/defects.py"]
    P7["7.0 Reporting &\nAnalytics\napp/api/reporting.py"]
    P8["8.0 AI Assistant\nServices\napp/api/ai.py"]
    P9["9.0 CI/CD Result\nIngestion\napp/api/ci.py"]
    P10["10.0 Audit Logging\napp/services/audit_service.py"]
    P11["11.0 Background Job\nProcessing\napp/worker.py"]

    DS1[("D1 users / sessions /\nroles / permissions")]
    DS2[("D2 projects /\ntest_modules")]
    DS3[("D3 test_cases /\ntest_case_versions / steps")]
    DS4[("D4 test_runs /\ntest_run_cases / execution_steps")]
    DS5[("D5 defects /\ndefect_links")]
    DS6[("D6 audit_logs\n(hash-chained, insert-only)")]
    DS7[("D7 background_jobs")]
    DS8[("D8 attachments\n(disk/S3)")]

    TenantUser --> P1
    IdPEnt --> P1
    P1 --> DS1
    P1 --> P2
    P2 --> DS1

    PlatformAdmin --> P3
    TenantUser --> P3
    P3 --> DS2
    P2 -.authorizes.-> P3

    TenantUser --> P4
    P4 --> DS3
    P4 --> DS2
    P2 -.authorizes.-> P4

    TenantUser --> P5
    P5 --> DS4
    P5 --> DS3
    P2 -.authorizes.-> P5
    CISystemEnt --> P9
    P9 --> P5

    TenantUser --> P6
    P5 -- "Fail verdict triggers\nquick-create" --> P6
    P6 --> DS5

    TenantUser --> P7
    DS3 --> P7
    DS4 --> P7
    DS5 --> P7
    P7 -- "scheduled PDF" --> P11

    TenantUser --> P8
    DS3 --> P8
    P8 -- "token usage" --> DS1

    P3 --> P10
    P4 --> P10
    P5 --> P10
    P6 --> P10
    P1 --> P10
    P10 --> DS6

    P11 --> DS7
    P11 --> P9
    P11 --> P7
    P11 --> DS8
```

**Key observation**: Process 2.0 (RBAC) is a cross-cutting authorization gate on nearly every other process rather than a standalone feature — modeled here with dashed "authorizes" edges into 3.0/4.0/5.0 to avoid implying it's a sequential pipeline stage. Process 10.0 (Audit Logging) is similarly cross-cutting: every mutating process writes to the same insert-only, hash-chained store.

## Level 2 — Test Execution Module

**Diagram source**: [`diagrams/dfd-level2-execution.mmd`](diagrams/dfd-level2-execution.mmd)
**Source code**: `backend/app/api/execution.py`, `backend/app/services/execution_service.py`

```mermaid
flowchart TB
    Tester(["Tester / assigned user"])
    Manager(["Manager / Admin"])
    CI(["CI system"])

    P5_1["5.1 Create Run\n(from Project, Suite, or ad hoc)\nexecution_service.create_test_run /\ncreate_run_from_suite"]
    P5_2["5.2 Assign Run Cases\nPATCH /test-run-cases/{id}/assign"]
    P5_3["5.3 Open Step\n(record opened_at, enforce\nStrict assignee-only access)"]
    P5_4["5.4 Record Verdict\n(pass/fail/ignore,\nrow-locked rollup recompute)"]
    P5_5["5.5 Pause / Resume Run\n(Admin/Manager only)"]
    P5_6["5.6 Recompute Run Case\nStatus Rollup"]
    P5_7["5.7 CI Result Ingestion\nrecord_ci_result()"]

    DS_Cases[("test_cases /\ntest_case_versions / steps")]
    DS_Suites[("test_suites /\ntest_suite_cases")]
    DS_DataSets[("test_data_sets /\ntest_data_set_rows")]
    DS_Runs[("test_runs /\ntest_run_cases")]
    DS_Steps[("execution_steps")]
    DS_Defects[("defects (quick-create\non Fail verdict)")]
    DS_Notif[("notifications")]
    DS_Audit[("audit_logs")]

    Manager --> P5_1
    DS_Cases --> P5_1
    DS_Suites -. "optional source" .-> P5_1
    DS_DataSets -. "optional parameterization,\none TestRunCase per selected row" .-> P5_1
    P5_1 --> DS_Runs

    Manager --> P5_2
    P5_2 --> DS_Runs
    P5_2 --> DS_Notif

    Tester --> P5_3
    DS_Runs --> P5_3
    P5_3 --> DS_Steps

    Tester --> P5_4
    DS_Steps --> P5_4
    P5_4 --> DS_Steps
    P5_4 --> P5_6
    P5_4 -- "on Fail" --> DS_Defects
    P5_6 --> DS_Runs
    P5_6 -- "run_case completed" --> DS_Notif

    Manager --> P5_5
    P5_5 --> DS_Runs

    CI --> P5_7
    P5_7 --> DS_Steps
    P5_7 --> P5_6

    P5_1 --> DS_Audit
    P5_4 --> DS_Audit
    P5_5 --> DS_Audit
```

**Technical observation**: 5.6 (rollup recompute) is drawn as a distinct process because it is a genuine shared sub-routine (`_recompute_run_case_status`) invoked from two independent entry points — human verdict recording (5.4) and automated CI ingestion (5.7) — and a real concurrency bug was once found and fixed exactly at this convergence point (two concurrent verdicts on different steps of the same run case corrupting the rollup; fixed with `SELECT ... FOR UPDATE`).

## Level 2 — Defect Management Module

**Diagram source**: [`diagrams/dfd-level2-defects.mmd`](diagrams/dfd-level2-defects.mmd)
**Source code**: `backend/app/api/defects.py`, `backend/app/services/defect_service.py`

```mermaid
flowchart TB
    Reporter(["Reporter (any role with defect.create)"])
    Assignee(["Assigned user (project member)"])
    Triager(["Manager / Admin"])
    WorkerProc(["Background Worker\n(SLA sweep)"])

    P6_1["6.1 Create Defect\n(manual or Fail-verdict quick-create,\nor linked to existing)"]
    P6_2["6.2 Update Status\n(forward-only sequence:\nNew->Open->Fixed->Verified->Closed)"]
    P6_3["6.3 Reopen Defect\n(dedicated path, increments\nreopened_count)"]
    P6_4["6.4 Assign / Triage\n(root_cause, environment,\nbuild/release linkage)"]
    P6_5["6.5 SLA Breach Sweep\n(periodic, aging-based)"]
    P6_6["6.6 Bulk Import / Export\nCSV"]

    DS_Defects[("defects / defect_links")]
    DS_Envs[("environments / builds / releases")]
    DS_Notif[("notifications")]
    DS_Audit[("audit_logs")]
    DS_Comments[("comments / comment_mentions")]

    Reporter --> P6_1
    P6_1 --> DS_Defects
    P6_1 --> DS_Audit

    Triager --> P6_2
    DS_Defects --> P6_2
    P6_2 --> DS_Defects
    P6_2 -- "on Closed" --> DS_Notif
    P6_2 --> DS_Audit

    Triager --> P6_3
    P6_3 --> DS_Defects

    Triager --> P6_4
    DS_Envs --> P6_4
    P6_4 --> DS_Defects

    WorkerProc --> P6_5
    DS_Defects --> P6_5
    P6_5 --> DS_Notif
    P6_5 --> DS_Defects

    Reporter --> P6_6
    P6_6 --> DS_Defects

    Assignee --> DS_Comments
    DS_Comments --> DS_Notif
```

**Technical observation**: status update (6.2) is deliberately forward-only (ADR-026) — reopening (6.3) is modeled as a separate process because it is implemented as a distinct code path (`defect_service.reopen_defect`) rather than a reverse transition of 6.2, preserving the forward-only invariant everywhere else in the state machine.

## Level 2 — RBAC / Authentication Module

**Diagram source**: [`diagrams/dfd-level2-rbac.mmd`](diagrams/dfd-level2-rbac.mmd)
**Source code**: `backend/app/core/auth.py`, `backend/app/api/roles.py`, `backend/app/services/role_service.py`

```mermaid
flowchart TB
    User(["Any authenticated caller"])
    Admin(["Tenant Admin"])

    P2_1["2.1 Parse Session Cookie\nparse_session_cookie()"]
    P2_2["2.2 Resolve Session\n(expiry, idle timeout,\nrevocation, MFA-verified check)"]
    P2_3["2.3 Load Role & Permissions\n_load_role_and_permissions()"]
    P2_4["2.4 Compute Effective\nAccess Tier (ADR-059)\n(system role code, or\nmanager/tester-equivalent\nfor custom roles)"]
    P2_5["2.5 IP Allowlist\nEnforcement"]
    P2_6["2.6 require_permission(code)\nDependency Check"]
    P2_7["2.7 Role Builder\n(create/edit custom role +\npermission set)"]

    DS_Sessions[("sessions")]
    DS_Users[("users")]
    DS_Roles[("roles / permissions /\nrole_permissions")]
    DS_Tenants[("tenants.ip_allowlist")]

    User --> P2_1
    P2_1 --> P2_2
    DS_Sessions --> P2_2
    P2_2 -- "update last_seen_at" --> DS_Sessions
    P2_2 --> P2_5
    DS_Tenants --> P2_5
    P2_5 --> P2_3
    DS_Users --> P2_3
    DS_Roles --> P2_3
    P2_3 --> P2_4
    P2_4 -- "SessionContext\n(role_code, display_role, permissions)" --> P2_6
    P2_6 -- "403 ForbiddenError if missing" --> User

    Admin --> P2_7
    P2_7 --> DS_Roles
```

## Level 2 — AI Assistant Services Module

**Diagram source**: [`diagrams/dfd-level2-ai.mmd`](diagrams/dfd-level2-ai.mmd)
**Source code**: `backend/app/api/ai.py`, `backend/app/services/ai_service.py`, `backend/app/core/ai/`

```mermaid
flowchart TB
    User(["Tenant User"])

    P8_1["8.1 Generate Test Cases\nfrom Requirement\ngenerate_test_cases_for_requirement()"]
    P8_2["8.2 AI Review\nof Test Case\nreview_test_case()"]
    P8_3["8.3 Analyze Requirement\nChange Impact\nanalyze_requirement_change()"]
    P8_4["8.4 QA Assistant\nConversational Query\nanswer_assistant_question()"]
    P8_5["8.5 Defect Root-Cause\nSuggestion\n(part of AI Defect Assistant)"]
    P8_6["8.6 Usage Metering &\nLimit Enforcement"]

    DS_Tenant[("tenants.ai_enabled /\nai_api_key_encrypted (Fernet)")]
    DS_Reqs[("requirements /\nrequirement_versions")]
    DS_Cases[("test_cases /\ntest_case_versions")]
    DS_Defects[("defects")]
    DS_Usage[("ai_usage_logs")]
    Gemini(["Gemini API\n(external)"])

    User --> P8_1
    DS_Reqs --> P8_1
    DS_Tenant --> P8_1
    P8_1 --> Gemini
    Gemini --> P8_1
    P8_1 --> DS_Cases
    P8_1 --> P8_6

    User --> P8_2
    DS_Cases --> P8_2
    P8_2 --> Gemini
    P8_2 --> P8_6

    User --> P8_3
    DS_Reqs --> P8_3
    P8_3 --> Gemini
    P8_3 --> P8_6

    User --> P8_4
    DS_Cases --> P8_4
    DS_Defects --> P8_4
    P8_4 --> Gemini
    P8_4 --> P8_6

    DS_Defects --> P8_5
    P8_5 --> Gemini
    P8_5 --> P8_6

    P8_6 --> DS_Usage
    DS_Tenant -. "ai_monthly_request_limit\n(Plan)" .-> P8_6
```

**Technical observation**: every AI sub-process converges on 8.6 (usage metering) before returning to the caller — `ai_usage_logs` records both successful and failed calls (`success: bool` column), so usage auditing works even when the provider call itself fails. The tenant's AI API key is Fernet-decrypted in memory per-call and never logged or returned in any API response.

## Not Identified in Current Implementation

- A dedicated Level 2 DFD for Reporting/Analytics was not produced separately — its data flows (aggregation across `test_cases`/`defects`/`execution_steps`, scheduled PDF generation) are fully covered by Level 1 Process 7.0/11.0 and by the Scheduled Report sequence diagram; a standalone Level 2 would have substantially duplicated that content.
- External tracker sync (Jira/GitHub/GitLab) data flows are **not shown** — per `docs/KNOWN_GAPS.md`, this integration was explicitly declined/deferred by the user during a prior phase of this engagement and no corresponding code path exists to diagram.
