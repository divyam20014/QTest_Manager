/* QTestHub Architecture Portal — curated content index.
   Hand-authored from docs/architecture/*.md (source-verified against the
   actual repository during an earlier documentation pass). This file
   supplies: section descriptions, diagram metadata, component/actor
   descriptions for info panels, and entries for the global search index.
   Diagram geometry (nodes/edges/ER columns) is auto-generated separately
   in data.generated.js by scripts/build-data.js (see README.md). */
"use strict";

window.QTH_CONTENT = {
  appName: "QTestHub",
  tagline: "Interactive Architecture Documentation",

  sections: [
    { id: "overview", label: "Overview", icon: "home" },
    { id: "system", label: "System Architecture", icon: "layers" },
    { id: "dfd", label: "Data Flow Diagrams", icon: "flow" },
    { id: "sequence", label: "Sequence Diagrams", icon: "sequence" },
    { id: "process", label: "Process Flow", icon: "flowchart" },
    { id: "erd", label: "Entity-Relationship Diagram", icon: "db" },
    { id: "usecase", label: "Use Case Diagrams", icon: "actor" },
  ],

  overview: {
    title: "QTestHub — Architecture Overview",
    what: "QTestHub is a multi-tenant, enterprise test-management system purpose-built for insurance-domain QA (BRD domains: Motor, Health, Travel, Life, Property). It is a FastAPI + SQLAlchemy + PostgreSQL backend, a React + TypeScript + Vite frontend, and a Docker Compose deployment (three containers: api, web, worker, plus db). Multi-tenancy is enforced at the database layer via PostgreSQL Row-Level Security keyed on tenant_id, not merely at the application layer.",
    audience: "Developers, QA engineers, technical architects, project managers, business analysts, application maintenance teams, and technical auditors.",
    methodology: [
      "Enumerated every SQLAlchemy model file under backend/app/models/ (27 files) and read each in full to extract every table, column, constraint, and foreign key — no table or relationship was inferred or assumed.",
      "Enumerated every FastAPI router under backend/app/api/ (33 routers) and every service module under backend/app/services/ (38 modules) to map request flows, permission gates, and cross-service calls.",
      "Read backend/app/main.py, backend/app/core/auth.py, backend/app/worker.py, docker-compose.yml / docker-compose.prod.yml, and backend/app/core/config.py to build the system architecture diagram.",
      "Cross-referenced docs/KNOWN_GAPS.md to distinguish genuinely implemented behavior from features deliberately deferred pending a stakeholder/legal/infrastructure decision — these are marked explicitly rather than omitted or assumed complete."
    ],
    highlights: [
      { title: "Multi-tenancy via Postgres RLS", body: "Nearly every table inherits TenantScopedMixin (backend/app/models/mixins.py), adding a non-client-settable tenant_id column. Isolation is enforced by Row-Level Security, activated per-request via a session-scoped Postgres GUC (set_tenant_context(db, tenant_id), backend/app/core/db.py). A small, documented set of tables are RLS-exempt by design because they must be resolved before a tenant context can exist: sessions, mfa_challenges, user_invites, background_jobs." },
      { title: "Immutable versioning", body: "TestCase/TestCaseVersion/TestCaseVersionStep and Requirement/RequirementVersion both follow a snapshot-on-write pattern — a version row, once created, is never updated. This underpins the approval workflow and the Shared Steps feature (which copies, not references, step text at insertion time)." },
      { title: "Three distinct auth planes", body: "(1) tenant user session-cookie auth with MFA and optional OIDC SSO; (2) platform-administrator HTTP Basic auth against a separate platform_admins table with its own brute-force lockout; (3) machine-to-machine service_tokens bearer auth for CI/CD result ingestion. audit_logs carries three mutually-exclusive nullable attribution columns (user_id, platform_admin_id, service_token_id) — exactly one is ever set per row." },
      { title: "Tenant-definable Role Builder (ADR-059/060)", body: "The three BRD-fixed roles (Admin/Manager/Tester) remain as global is_system=true rows, but a tenant admin can also define custom roles with any subset of real, enforced permissions. A custom role's effective access tier is computed server-side (SessionContext.role_code in backend/app/core/auth.py) rather than requiring every existing role_code == \"...\" call site to be rewritten." },
      { title: "DB-backed background job queue", body: "No Celery/Redis in the approved stack. The background_jobs table + backend/app/worker.py polling loop handles CSV import off the request path, periodic SLA-breach sweeps, and scheduled/emailed PDF compliance reports." }
    ],
    scopeLimits: [
      "This portal renders diagrams live from Mermaid source (vendored locally, no CDN/internet required) — it does not pre-render static SVG/PNG/PDF files. Use the per-diagram Export buttons to generate an SVG or PNG on demand from the current view.",
      "The \"Download Documentation (Print/PDF)\" action uses the browser's native print pipeline (window.print()) with a dedicated print stylesheet laying out every diagram sequentially — this was a deliberate choice over vendoring a heavier client-side PDF library, and is disclosed here rather than presented as a bespoke PDF generator.",
      "Items marked \"Not Identified in Current Implementation\" appear where docs/KNOWN_GAPS.md documents a feature as deliberately unbuilt (e.g. true GDPR physical erasure, SAML, external tracker sync). These are shown in the relevant info panels, not hidden.",
      "SCIM provisioning and a handful of secondary flows are real, routed code but were not independently re-verified end-to-end during the documentation pass that produced the underlying content — flagged at point of use.",
      "No application source code was modified to build this portal; only files under architecture_documentation/ were created."
    ],
    docIndex: [
      { id: "system", label: "System Architecture", desc: "Container/component view: frontend, backend, worker, database, external integrations, deployment topology." },
      { id: "dfd", label: "Data Flow Diagrams", desc: "Level 0 context, Level 1 application-wide, Level 2 per-module (execution, defects, RBAC, AI)." },
      { id: "sequence", label: "Sequence Diagrams", desc: "9 sequence diagrams covering the major end-to-end workflows across all three auth planes." },
      { id: "process", label: "Process Flow / Flowcharts", desc: "6 flowcharts: login/MFA/SSO, test case approval, role builder, permission-check decision tree, error handling, GDPR deletion." },
      { id: "erd", label: "Entity-Relationship Diagram", desc: "Full ERD (~40 tables) split into 3 readable sub-diagrams, every FK sourced from actual SQLAlchemy models." },
      { id: "usecase", label: "Use Case Diagrams", desc: "Actor-to-capability map plus a module-level detail diagram for Execution & Defects." }
    ]
  },

  system: {
    title: "System Architecture",
    purpose: "Show every runtime component, how they communicate, and which integrations are optional vs. load-bearing.",
    scope: "Container-level (Docker Compose services) and the clients/external systems that talk to them. Does not descend into individual classes — see the ERD and Sequence Diagrams sections for that level of detail.",
    diagram: "system-architecture",
    componentDocs: {
      "SPA": { source: "frontend/src/", notes: "React 18 + TypeScript + Vite, TanStack Query, react-hook-form + zod, Tailwind-based UI primitives under frontend/src/components/ui/. Built and served by the web container (frontend/Dockerfile); in prod sits behind nginx." },
      "FastAPI": { source: "backend/app/main.py", notes: "Registers 33 routers under /api/v1, 3 custom exception handlers, CORS + correlation-id + request-logging middleware, slowapi rate-limit middleware, optional Sentry init gated by settings.sentry_enabled." },
      "AuthCore": { source: "backend/app/core/auth.py", notes: "SessionContext dataclass, get_current_context, require_permission()/require_any_permission() FastAPI dependencies, IP-allowlist enforcement (_enforce_ip_allowlist)." },
      "RateLimit": { source: "backend/app/core/rate_limit.py", notes: "slowapi in-process rate limiter. No Redis in this stack, so limits are per-process — would need a Redis-backed limiter to hold correctly under horizontal scaling (Requires Clarification if that is ever planned)." },
      "AICore": { source: "backend/app/core/ai/", notes: "gemini_provider.py builds {gemini_api_base_url}/v1beta/models/{gemini_model}:generateContent calls; model name centrally configured via the gemini_model setting, overridable via GEMINI_MODEL env var with no code change." },
      "PDFCore": { source: "backend/app/core/pdf_report.py", notes: "reportlab-based PDF rendering, chosen over weasyprint specifically because it is pure-Python with no system pango/cairo/gdk-pixbuf dependency chain." },
      "Storage": { source: "backend/app/core/storage.py", notes: "LocalFilesystemStorage (default) or S3CompatibleStorage (STORAGE_BACKEND=s3), same interface, swapped at the service layer (ADR-053)." },
      "Worker": { source: "backend/app/worker.py", notes: "Same container image as api, different entrypoint/command. Runs three independent timers in one process: job-queue claim loop (CSV import jobs), a 300s SLA-breach sweep, and a 900s scheduled-report sweep." },
      "Postgres": { source: "db service (PostgreSQL 16)", notes: "Row-Level Security policies applied per tenant-scoped table; hash-chained, insert-only audit_logs with UPDATE/DELETE grants revoked for the application role — only the owner role (migrations only) can alter schema." },
      "AttachVol": { source: "qtesthub_attachments Docker volume", notes: "Bytes never stored as DB blobs (ADR-012); metadata lives in the attachments table." },
      "Gemini": { source: "Google Gemini API (external, optional)", notes: "Only reachable when a tenant has AI enabled and a Fernet-decrypted API key configured. Degrades gracefully when unconfigured." },
      "SMTP": { source: "SMTP Server (external, optional)", notes: "Required only when MFA_DELIVERY_MODE or NOTIFICATION_EMAIL_DELIVERY_MODE is set to 'real'." },
      "S3": { source: "S3 / S3-compatible object store (external, optional)", notes: "Only used when STORAGE_BACKEND=s3." },
      "Sentry": { source: "Sentry (external, optional)", notes: "Purely additive error monitoring, gated by sentry_dsn being set." },
      "Nginx": { source: "deploy/nginx/reverse-proxy.conf (prod only)", notes: "TLS termination, Content-Security-Policy headers, routes /api/v1/* to api, everything else to web." },
      "CISystem": { source: "External CI/CD System", notes: "Authenticates via Bearer service-token; posts to POST /api/v1/ci/{tenant_id}/webhooks/test-results only." },
      "IdP": { source: "Tenant Identity Provider (OIDC, per-tenant)", notes: "Config lives in the sso_configs table, not env vars. Drives the SSO authorization-code flow." },
      "SCIMClient": { source: "IdP SCIM Client", notes: "Routed and reachable (/api/v1/scim/v2/{tenant_id}/*) but not independently re-verified end-to-end in the documentation pass this portal is built from." }
    },
    routers: ["platform", "auth", "users", "projects", "test_cases", "csv_import", "execution", "defects", "reporting", "audit", "attachments", "comments", "notifications", "settings", "requirements", "ai", "test_assets", "test_modules", "search", "export", "sso (+ admin_router)", "scim (+ admin_router)", "field_customization", "templates", "test_data", "service_tokens", "roles", "ci", "report_schedule", "shared_steps", "test_data_sets", "test_suites", "test_plans"],
    deployment: {
      dev: "docker-compose.yml: db port 5432 exposed to host; no reverse proxy; web served by Vite's dev server on 5173; no TLS. Named volumes: qtesthub_pgdata, qtesthub_attachments.",
      prod: "docker-compose.prod.yml: explicit Compose name: qtesthub-prod (added after a real incident where an unnamed prod teardown wiped the dev stack's volumes). db has no host port mapping. ${VAR:?...} substitutions refuse to start containers with unset required variables. validate_for_production() additionally fails the app at import time if ENVIRONMENT=production and MFA is still simulated, DATABASE_URL is still the dev default, or CORS is unset/wildcarded.",
      healthchecks: "api and web have HTTP health checks (/api/v1/ready does a real SELECT 1, distinct from the liveness-only /api/v1/health). worker has a /proc-scanning health check instead, since it serves no HTTP endpoint."
    }
  },

  dfd: {
    title: "Data Flow Diagrams",
    purpose: "Trace how data moves between external entities, processes, and data stores, at increasing levels of detail.",
    scope: "Level 0 (whole-system context), Level 1 (application-wide process map), Level 2 (per-module detail for Test Execution, Defect Management, RBAC/Auth, and AI Assistant Services).",
    levels: [
      { id: "dfd-level0", label: "Level 0 — Context", note: "External entities: Tenant User, Platform Administrator, CI/CD Pipeline, Tenant Identity Provider, Report Email Recipients, Gemini AI Provider. QTestHub has exactly one inbound unauthenticated-but-stateful entry point (SSO callback) and one fully machine-to-machine entry point (CI webhook) — both deliberately separate from the human session-cookie plane." },
      { id: "dfd-level1", label: "Level 1 — Application-wide", note: "Process 2.0 (RBAC) is a cross-cutting authorization gate on nearly every other process, not a sequential pipeline stage — modeled with dashed \"authorizes\" edges. Process 10.0 (Audit Logging) is similarly cross-cutting: every mutating process writes to the same insert-only, hash-chained store." },
      { id: "dfd-level2-execution", label: "Level 2 — Test Execution", note: "5.6 (rollup recompute) is a genuine shared sub-routine (_recompute_run_case_status) invoked from two independent entry points — human verdict recording and automated CI ingestion. A real concurrency bug was once found and fixed exactly at this convergence point, resolved with SELECT ... FOR UPDATE." },
      { id: "dfd-level2-defects", label: "Level 2 — Defect Management", note: "Status update is deliberately forward-only (ADR-026) — reopening is modeled as a separate process (defect_service.reopen_defect) rather than a reverse transition, preserving the forward-only invariant everywhere else." },
      { id: "dfd-level2-rbac", label: "Level 2 — RBAC / Auth", note: "Every authenticated request runs the full chain: parse cookie -> resolve session -> IP allowlist -> load role/permissions -> compute effective access tier -> permission check." },
      { id: "dfd-level2-ai", label: "Level 2 — AI Assistant Services", note: "Every AI sub-process converges on usage metering before returning to the caller — ai_usage_logs records both successful and failed calls, so usage auditing works even when the provider call itself fails. The tenant's AI API key is Fernet-decrypted in memory per-call and never logged or returned in any API response." }
    ],
    notIdentified: [
      "A dedicated Level 2 DFD for Reporting/Analytics was not produced separately — fully covered by Level 1 Process 7.0/11.0 and the Scheduled Report sequence diagram.",
      "External tracker sync (Jira/GitHub/GitLab) data flows are not shown — this integration was explicitly declined/deferred by the project owner; no corresponding code path exists to diagram."
    ]
  },

  sequence: {
    title: "Sequence Diagrams",
    purpose: "Show the real request/response/DB-interaction order for the major workflows, including authentication checks, error branches, and background-process interleaving.",
    scope: "9 workflows selected to cover every major module and all three distinct auth planes.",
    workflows: [
      { id: "seq-login-mfa", label: "1. Login + MFA", source: "backend/app/api/auth.py, auth_service.py, core/auth.py, frontend/src/routes/Login.tsx", note: "The SELECT ... FOR UPDATE row lock on the MFA challenge closes a race where concurrent verify attempts could each read the same pre-increment attempt_count. Rate limiting is keyed by client IP (not tenant_id+email), a documented simplification." },
      { id: "seq-sso-oidc", label: "2. Tenant SSO (OIDC)", source: "backend/app/api/sso.py, sso_service.py", note: "SSO-provisioned users are never auto-granted admin — default_role_code defaults to tester. The CSRF-style state cookie is httponly/samesite=lax with a 600-second max age." },
      { id: "seq-testcase-approval", label: "3. Test Case Creation, Versioning & Approval", source: "backend/app/api/test_cases.py, test_case_service.py", note: "Immutable snapshot model (ADR-001/003): TestCaseVersion rows are never updated once created. Every content edit after 'approved' forks a new version." },
      { id: "seq-test-execution", label: "4. Test Run Creation & Step-by-Step Execution", source: "backend/app/api/execution.py, execution_service.py, frontend ExecutionConsole.tsx", note: "Access control here is Strict per an explicit product decision — a tester who is not test_run_cases.assigned_to cannot act on that case's steps at all, not even to view-only." },
      { id: "seq-defect-lifecycle", label: "5. Defect Creation and Status Lifecycle", source: "backend/app/api/defects.py, defect_service.py", note: "Forward-only sequence (ADR-026): New -> Open -> Fixed -> Verified -> Closed. A background worker sweeps for SLA breaches every 5 minutes." },
      { id: "seq-ci-webhook", label: "6. CI/CD Webhook Result Ingestion (M2M)", source: "backend/app/api/ci.py, service_token_auth.py, service_token_service.py", note: "set_tenant_context is re-asserted per row because the Postgres session-scoped GUC resets on every commit/rollback — a recurring bug class across this codebase, documented and fixed everywhere it was found." },
      { id: "seq-ai-assistant", label: "7. AI QA Assistant / AI Defect Assistant", source: "backend/app/api/ai.py, ai_service.py, core/ai/gemini_provider.py, core/crypto.py", note: "AI Defect Assistant root-cause suggestion follows the identical decrypt -> prompt -> generate -> meter pattern, scoped to one defect's context instead of a free-form question (same ai_service.py module)." },
      { id: "seq-csv-bulk-import", label: "8. CSV Bulk Import (Flexible Field-Mapping)", source: "backend/app/api/csv_import.py, csv_import_service.py", note: "TestRail/Zephyr/Jira preset mappings are fuzzy-matched suggestions, explicitly labeled in the UI as unverified against a real export (no real accounts/files were available to validate against)." },
      { id: "seq-scheduled-report", label: "9. Scheduled / Emailed Compliance PDF Report", source: "backend/app/api/report_schedule.py, report_schedule_service.py, core/pdf_report.py, worker.py", note: "reportlab chosen over weasyprint: pure-Python, no system pango/cairo/gdk-pixbuf dependency, no Dockerfile changes needed." }
    ],
    notIdentified: [
      "A SCIM provisioning sequence diagram was not produced — scim.py/scim_service.py are real, routed code, but were not independently re-verified end-to-end as part of the documentation pass.",
      "GDPR physical-erasure and WORM audit-log-shipping sequences do not exist because the underlying features do not exist yet (see Process Flow's GDPR flowchart)."
    ]
  },

  process: {
    title: "Flowcharts / Process Flow Diagrams",
    purpose: "Show decision points, validations, and alternative/error paths for workflows where branching logic — not strict request/response sequencing — is the point of interest.",
    scope: "Authentication (credentials + SSO branch + MFA), test case approval, role/permission management (role builder), the RBAC permission-check decision tree, the application-wide error-handling pattern, and the GDPR/DPDP data-deletion flow.",
    flows: [
      { id: "flow-auth-login", label: "1. Authentication (Login, SSO branch, MFA)", source: "backend/app/api/auth.py, sso.py, auth_service.py, frontend/src/routes/Login.tsx", note: "Validations shown: rate limit, tenant status, credential match, state-cookie CSRF check, MFA code correctness/expiry/attempt budget. SSO vs. credential login converge at Dashboard but SSO sessions skip the MFA branch entirely." },
      { id: "flow-testcase-approval", label: "2. Test Case Approval Workflow", source: "backend/app/services/test_case_service.py, models/test_case.py", note: "'deprecated' is terminal — re-deprecating an already-deprecated case returns 409, and there is no path back from deprecated to any other status." },
      { id: "flow-rbac-role-builder", label: "3. Role & Permission Management (Role Builder)", source: "backend/app/api/roles.py, role_service.py, core/auth.py (ADR-059/060)", note: "Disclosed limitation: dozens of frontend conditionals keyed on the literal role name (role === 'admin') do not visually recognize a custom role as admin-equivalent even when its permission set grants equivalent access — backend enforcement is correct regardless; this is a UI-display-only gap." },
      { id: "flow-permission-check", label: "4. RBAC Permission-Check Decision Flow", source: "backend/app/core/auth.py (get_current_context, require_permission)", note: "This exact chain runs on every authenticated request — suspending a tenant mid-session blocks it on the very next request, not just new logins. trust_proxy_headers must be explicitly enabled for X-Forwarded-For to be honored in the IP-allowlist check." },
      { id: "flow-error-handling", label: "5. Error / Exception Handling Pattern", source: "backend/app/core/errors.py, main.py (3 exception handlers)", note: "Every error path converges on the same {data, error: {code, message}} response envelope, which is what allows the frontend's ApiError class to handle every error uniformly regardless of origin." },
      { id: "flow-gdpr-deletion", label: "6. GDPR / DPDP Data Deletion", source: "backend/app/models/identity.py (users.pseudonymized_at)", note: "Not Identified in Current Implementation / Requires Clarification: true physical row deletion is not implemented — current mechanism is pseudonymization only (PII fields scrubbed, audit_logs preserved unchanged for hash-chain integrity). Physical erasure requires explicit legal/compliance sign-off per tenant jurisdiction before being exposed." }
    ],
    notIdentified: [
      "A dedicated 'approval workflow' flowchart for Defects was not produced separately — fully covered by the Defect Lifecycle sequence diagram, which already shows the forward-only state sequence and its branches.",
      "A dedicated CI pipeline / quality-gate flowchart (lint/typecheck/test/build order) is not covered here — this package documents the deployed application's own runtime behavior, not its development/CI tooling."
    ]
  },

  erd: {
    title: "Entity-Relationship Diagram",
    purpose: "A complete, source-verified map of every table, primary/foreign key, and relationship in the QTestHub schema.",
    scope: "All ~40 tables defined across backend/app/models/ (27 files, every one read in full), confirmed against the Alembic migration history (40 migration files). Split into 3 diagrams for readability.",
    diagrams: [
      { id: "erd-core", label: "Core: Identity, Project, Test Authoring, Execution" },
      { id: "erd-defects-reqs", label: "Defects, Requirements & Traceability" },
      { id: "erd-platform-auth", label: "Platform, Auth-planes, SaaS, AI & Jobs" }
    ],
    rlsExempt: ["sessions", "mfa_challenges", "user_invites", "background_jobs"],
    rlsExemptNote: "RLS-exempt by design because they must be resolved before a tenant context can exist — these tables are keyed/queried before set_tenant_context() can run."
  },

  usecase: {
    title: "Use Case Diagrams",
    purpose: "Map each actor to the capabilities they actually have, sourced from real require_permission()/require_any_permission() gates and router definitions, not an idealized feature list.",
    scope: "A system-wide overview covering every major module, plus one module-level detail diagram (Test Execution & Defects) chosen for its richest actor/permission interplay.",
    notation: "Mermaid has no native UML use-case diagram shape. Both diagrams are modeled as a flowchart using stadium shapes for use cases and actor-style nodes for actors, with include/extend/alternative dashed edges standing in for UML relationships. This is a deliberate, disclosed substitution.",
    actors: [
      { name: "Platform Administrator", source: "backend/app/models/identity.py::PlatformAdmin, backend/app/api/platform.py", desc: "Bootstrap-only (ADR-008); authenticates via HTTP Basic against a table entirely separate from tenant RBAC. Not part of any tenant's permission model." },
      { name: "Tenant Admin", source: "roles.code == \"admin\" (system role)", desc: "Full tenant-scope access: user/role management, all integration configuration, all project/test/defect capabilities." },
      { name: "Manager / Full-Access Custom Role", source: "roles.code == \"manager\", or a custom role holding project.view.all", desc: "Project-wide visibility and test-run creation authority; cannot manage tenant-level settings (SSO/roles/service tokens) unless the custom role explicitly grants those permission codes too." },
      { name: "Tester / Restricted Custom Role", source: "roles.code == \"tester\", or a custom role without project.view.all", desc: "Can author test cases and execute only run cases explicitly assigned to them (Strict access) — cannot create runs, approve test cases, or manage users." },
      { name: "External CI/CD System", source: "service_tokens bearer auth", desc: "Machine actor; its only capability is posting automated test results to one scoped webhook endpoint." },
      { name: "Tenant Identity Provider", source: "OIDC, per-tenant sso_configs", desc: "Authenticates users on the tenant's behalf; initiates the SSO login use case from outside the system." }
    ],
    selectedUseCases: [
      { name: "Build Custom Roles & Permissions", note: "ADR-059/060 — a Tenant Admin can define a role with any subset of real, enforced permission codes; the 3 system roles remain fixed and always available." },
      { name: "Ingest Automated CI Results <<include>> Record Verdicts", note: "A CI result is recorded through the identical record_verdict/rollup-recompute code path a human tester's verdict uses." },
      { name: "Record Verdicts <<extend>> Report / Triage Defects", note: "Recording a fail verdict optionally extends into the defect quick-create flow — conditional, not mandatory." },
      { name: "Review / Approve Test Cases <<include>> Author & Version Test Cases", note: "Approval always acts on an already-authored version; it cannot exist independently." }
    ],
    detailDiagram: { id: "usecase-execution-defects", label: "Detail — Test Execution & Defect Module" },
    notIdentified: [
      "No distinct 'Customer / External Stakeholder (read-only)' actor exists in the current RBAC model.",
      "SCIM's actor is shown in the System Architecture diagram's client list but was not given its own use-case entries, since its provisioning behavior was not independently re-verified."
    ]
  }
};
