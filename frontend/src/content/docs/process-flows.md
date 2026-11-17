# Flowcharts / Process Flow Diagrams

**Purpose**: show decision points, validations, and alternative/error paths for the workflows where branching logic — not strict request/response sequencing — is the point of interest.
**Scope**: authentication (credentials + SSO branch + MFA), test case approval, role/permission management (role builder), the RBAC permission-check decision tree applied on every request, the application-wide error-handling pattern, and the GDPR/DPDP data-deletion flow (including its explicitly gated, not-yet-built branch).

## 1. Authentication (Login, SSO branch, MFA)

**Diagram source**: [`diagrams/flow-auth-login.mmd`](diagrams/flow-auth-login.mmd)
**Source**: `backend/app/api/auth.py`, `backend/app/api/sso.py`, `backend/app/services/auth_service.py`, `frontend/src/routes/Login.tsx`

```mermaid
flowchart TD
    Start(["User visits Login page"]) --> Choice{"Sign in with SSO?\n(only shown if tenant_id is a valid UUID)"}
    Choice -- "No" --> Creds["Enter tenant_id, email, password"]
    Choice -- "Yes" --> CheckSSO["GET /auth/sso/{tenant_id}/status"]
    CheckSSO --> SSOEnabled{"SSO enabled\nfor tenant?"}
    SSOEnabled -- "No" --> ShowMsg["Show: SSO not configured"] --> Creds
    SSOEnabled -- "Yes" --> Redirect["Redirect to IdP\nauthorization endpoint"]
    Redirect --> IdPAuth["User authenticates at IdP"]
    IdPAuth --> Callback["IdP redirects back with code+state"]
    Callback --> ValidateState{"state cookie\nmatches?"}
    ValidateState -- "No" --> Reject1(["401: Invalid/expired SSO attempt"])
    ValidateState -- "Yes" --> Exchange["Exchange code for tokens;\nprovision user if first login\n(role = tenant default, never admin)"]
    Exchange --> SSOSession["Create session\n(mfa_verified=true - IdP already authenticated)"]
    SSOSession --> Dashboard(["Redirect to Dashboard"])

    Creds --> Submit["POST /auth/login"]
    Submit --> RateLimit{"Rate limit OK?\n(10/min per IP)"}
    RateLimit -- "No" --> Reject2(["429 Too Many Attempts"])
    RateLimit -- "Yes" --> TenantStatus{"Tenant status\n== approved?"}
    TenantStatus -- "No" --> Reject3(["403 Forbidden"])
    TenantStatus -- "Yes" --> CredCheck{"Email + password\nvalid?"}
    CredCheck -- "No" --> Reject4(["401 Invalid credentials\n(generic message, no enumeration)"])
    CredCheck -- "Yes" --> CreateSession["Create session\n(mfa_verified=false);\ncreate MFA challenge"]
    CreateSession --> DeliveryMode{"MFA_DELIVERY_MODE"}
    DeliveryMode -- "simulated" --> ReturnCode["Return debug_code in response body"]
    DeliveryMode -- "real" --> EmailCode["Email code via SMTP\n(fails loudly if SMTP unset)"]
    ReturnCode --> EnterCode["User enters 6-digit code"]
    EmailCode --> EnterCode
    EnterCode --> VerifySubmit["POST /auth/mfa/verify"]
    VerifySubmit --> LockCheck["SELECT mfa_challenges FOR UPDATE\n(row lock prevents concurrent-attempt race)"]
    LockCheck --> CodeValid{"Code correct AND\nnot expired AND\nattempt_count < limit?"}
    CodeValid -- "No" --> IncrementAttempt["Increment attempt_count"] --> Reject5(["401 Unauthorized"])
    CodeValid -- "Yes" --> MarkVerified["Set mfa_verified=true"]
    MarkVerified --> Dashboard
```

**Validations shown**: rate limit, tenant status, credential match, state-cookie CSRF check, MFA code correctness/expiry/attempt budget. **Alternative paths**: SSO vs. credential login converge at "Dashboard" but SSO sessions skip the MFA branch entirely (the IdP is trusted to have already authenticated the user).

## 2. Test Case Approval Workflow

**Diagram source**: [`diagrams/flow-testcase-approval.mmd`](diagrams/flow-testcase-approval.mmd)
**Source**: `backend/app/services/test_case_service.py`, `backend/app/models/test_case.py`

```mermaid
flowchart TD
    Create(["Author creates test case"]) --> Draft["status = draft\n(version_number = 1)"]
    Draft --> Edit{"Author edits\nsteps/title/description?"}
    Edit -- "Yes" --> ForkVersion["Fork new TestCaseVersion\n(previous version stays immutable)"]
    ForkVersion --> Draft
    Edit -- "No" --> SubmitReview["Author sets status = ready_for_review\n(optionally names a specific reviewer_id)"]
    SubmitReview --> NotifyReviewer["Notification: review_requested"]
    NotifyReviewer --> ReviewerDecision{"Reviewer decision"}
    ReviewerDecision -- "Approve\n(testcase.approve OR\nis named reviewer_id)" --> Approved["status = approved\nTestCaseVersion.approved_by/at set"]
    ReviewerDecision -- "Request Changes" --> BackToDraft["status = draft\n(comment attached)"]
    BackToDraft --> NotifyAuthor["Notification: review_decided"] --> Edit
    Approved --> NotifyAuthor2["Notification: review_decided"]
    Approved --> Runnable["Only approved versions may be\nbundled into a Test Run"]
    Approved --> PostApprovalEdit{"Further edit\nafter approval?"}
    PostApprovalEdit -- "Yes" --> ForkVersion
    PostApprovalEdit -- "No" --> Deprecate{"Admin/Manager\ndeprecates case?"}
    Deprecate -- "Yes" --> Terminal(["status = deprecated\n(terminal, testcase.deprecate permission)"])
    Deprecate -- "No" --> Runnable
```

**Technical observation**: `deprecated` is terminal — re-deprecating an already-deprecated case returns 409 (GAP-36), and there is no path back from `deprecated` to any other status in the current implementation.

## 3. Role & Permission Management (Role Builder)

**Diagram source**: [`diagrams/flow-rbac-role-builder.mmd`](diagrams/flow-rbac-role-builder.mmd)
**Source**: `backend/app/api/roles.py`, `backend/app/services/role_service.py`, `backend/app/core/auth.py` (ADR-059/060)

```mermaid
flowchart TD
    Start(["Tenant Admin opens /admin/roles"]) --> ListRoles["List roles:\n3 fixed system roles (Admin/Manager/Tester)\n+ this tenant's custom roles"]
    ListRoles --> Action{"Action"}
    Action -- "Create custom role" --> NameRole["Name the role"]
    NameRole --> SelectPerms["Select subset of real,\nenforced permission codes\n(from `permissions` table)"]
    SelectPerms --> SaveRole["POST /roles\n(tenant_id = ctx.tenant_id, is_system=false)"]
    SaveRole --> StoreRole["INSERT roles (code=NULL, tenant-scoped)\nINSERT role_permissions"]
    StoreRole --> Assignable(["Role assignable to this tenant's users only"])

    Action -- "Edit custom role" --> EditPerms["Modify permission set"]
    EditPerms --> SavePerms["PATCH /roles/{id}"]
    SavePerms --> UpdatePerms["UPDATE role_permissions"]

    Action -- "Assign role to user" --> AssignUser["PATCH /users/{id} {role_id}"]
    AssignUser --> UserRoleSet["users.role_id updated"]
    UserRoleSet --> NextLogin["On next request, SessionContext\nrecomputed from new role_id"]

    NextLogin --> IsSystem{"Role.code\nin (admin, manager, tester)?"}
    IsSystem -- "Yes" --> UseCode["role_code = literal code\n(unchanged legacy behavior)"]
    IsSystem -- "No (custom role)" --> ComputeTier{"Role holds\nproject.view.all\npermission?"}
    ComputeTier -- "Yes" --> ManagerTier["role_code = 'manager'-equivalent\n(effective access tier, ADR-059)"]
    ComputeTier -- "No" --> TesterTier["role_code = 'tester'-equivalent"]
    UseCode --> Composed(["Composes with every existing\nrole_code-based permission check\nacross the codebase, unchanged"])
    ManagerTier --> Composed
    TesterTier --> Composed

    Action -- "Delete custom role" --> DeleteCheck{"Any user still\nassigned this role?"}
    DeleteCheck -- "Yes" --> Blocked(["409 Conflict: reassign users first"])
    DeleteCheck -- "No" --> DeleteRole["DELETE roles row"]
```

**Design rationale** (ADR-059/060, confirmed with the user during this engagement): rather than rewriting ~20 hardcoded `role_code == "..."` comparisons across 7 service files, a custom role's effective access tier is *computed* once per request and carried on `SessionContext.role_code` — every pre-existing check composes correctly without modification. **Disclosed limitation**: dozens of frontend conditionals keyed on the literal role name (`role === 'admin'`) do not visually recognize a custom role as admin-equivalent even when its permission set grants equivalent access — backend enforcement is correct regardless; this is a UI-display-only gap (see `docs/KNOWN_GAPS.md` GAP-05).

## 4. RBAC Permission-Check Decision Flow

**Diagram source**: [`diagrams/flow-permission-check.mmd`](diagrams/flow-permission-check.mmd)
**Source**: `backend/app/core/auth.py` (`get_current_context`, `require_permission`)

```mermaid
flowchart TD
    Req(["Incoming authenticated request"]) --> ParseCookie["parse_session_cookie(request)"]
    ParseCookie --> CookieValid{"Cookie present\nand valid UUID?"}
    CookieValid -- "No" --> U401(["401 Unauthorized"])
    CookieValid -- "Yes" --> LookupSession["SELECT sessions WHERE id"]
    LookupSession --> SessionExists{"Session exists,\nnot revoked,\nnot expired?"}
    SessionExists -- "No" --> U401
    SessionExists -- "Yes" --> MfaCheck{"mfa_verified\n== true?"}
    MfaCheck -- "No" --> U401b(["401: MFA verification required"])
    MfaCheck -- "Yes" --> IdleCheck{"last_seen_at within\nsession_ttl_minutes?"}
    IdleCheck -- "No" --> RevokeIdle["Revoke session"] --> U401c(["401: Session expired (idle)"])
    IdleCheck -- "Yes" --> TouchSession["Update last_seen_at=now()"]
    TouchSession --> TenantStatusCheck{"Tenant.status\n== approved?"}
    TenantStatusCheck -- "No" --> F403a(["403: Tenant suspended"])
    TenantStatusCheck -- "Yes" --> IPCheck{"tenants.ip_allowlist set?"}
    IPCheck -- "No" --> LoadRole["Load role + permissions\n(_load_role_and_permissions)"]
    IPCheck -- "Yes" --> IPMatch{"Caller IP in\nany allowlisted CIDR?"}
    IPMatch -- "No" --> F403b(["403: Network not on allowlist"])
    IPMatch -- "Yes" --> LoadRole
    LoadRole --> ComputeCtx["Compute SessionContext\n(role_code, display_role, permissions set)"]
    ComputeCtx --> RouteNeedsPerm{"Route uses\nrequire_permission(code)?"}
    RouteNeedsPerm -- "No" --> Proceed(["Handler executes\n(any authenticated user)"])
    RouteNeedsPerm -- "Yes" --> HasPerm{"code in\nctx.permissions?"}
    HasPerm -- "No" --> F403c(["403: Missing permission"])
    HasPerm -- "Yes" --> Proceed
```

**Notes**: this exact chain runs on **every** authenticated request (it is a FastAPI dependency, not a one-time login check) — suspending a tenant mid-session blocks it on the very next request, not just new logins (GAP-23). `trust_proxy_headers` must be explicitly enabled for `X-Forwarded-For` to be honored in the IP-allowlist check, specifically to prevent a client from spoofing its own IP when no reverse proxy is actually in front of the app.

## 5. Error / Exception Handling Pattern

**Diagram source**: [`diagrams/flow-error-handling.mmd`](diagrams/flow-error-handling.mmd)
**Source**: `backend/app/core/errors.py`, `backend/app/main.py` (3 exception handlers)

```mermaid
flowchart TD
    Handler(["Route handler / service call raises"]) --> ErrType{"Exception type"}
    ErrType -- "AppError subclass\n(ValidationAppError, UnauthorizedError,\nForbiddenError, ConflictError, NotFoundError...)" --> AppErrHandler["app.exception_handler(AppError)"]
    AppErrHandler --> Envelope1["JSONResponse {data: null,\nerror: {code, message}}\nstatus_code = exc.status_code"]

    ErrType -- "RateLimitExceeded\n(slowapi)" --> RLHandler["app.exception_handler(RateLimitExceeded)"]
    RLHandler --> LogWarn["logger.warning(security_event=rate_limited)"]
    LogWarn --> Envelope2["JSONResponse 429\n{code: rate_limited}"]

    ErrType -- "Any other unhandled\nException" --> GenericHandler["app.exception_handler(Exception)"]
    GenericHandler --> LogFull["logger.exception(...)\n(full traceback, server-side only)"]
    LogFull --> Envelope3["JSONResponse 500\n{code: internal_error,\nmessage: generic, never leaks detail}\n(SAAS-GAP-15 fix)"]

    Envelope1 --> Client["Frontend ApiError\n(uniform handling, frontend/src/api/client.ts)"]
    Envelope2 --> Client
    Envelope3 --> Client
    Client --> Toast["Toast notification\nrendered to user (app-wide rollout)"]
```

**Notes**: every error path converges on the same `{data, error: {code, message}}` response envelope (`backend/app/core/responses.py`'s `envelope()` helper mirrored on the error side), which is what allows the frontend's `ApiError` class to handle every error uniformly regardless of origin.

## 6. GDPR / DPDP Data Deletion

**Diagram source**: [`diagrams/flow-gdpr-deletion.mmd`](diagrams/flow-gdpr-deletion.mmd)
**Source**: `backend/app/models/identity.py` (`users.pseudonymized_at`), `docs/KNOWN_GAPS.md` GAP-03

```mermaid
flowchart TD
    Request(["Admin requests deletion of a user\n(data-subject erasure request)"]) --> Mechanism{"Mechanism available today"}
    Mechanism --> Pseudo["Pseudonymization\n(users.pseudonymized_at set)"]
    Pseudo --> ScrubPII["Scrub direct PII fields\n(name, email replaced with\nopaque placeholders)"]
    ScrubPII --> PreserveAudit["audit_logs rows referencing\nthis user_id are preserved unchanged\n(hash-chain integrity, ADR-006)"]
    PreserveAudit --> Done(["User can no longer log in or be\nidentified from new data,\nbut historical audit continuity is kept"])

    Mechanism --> PhysicalErasure{"True physical row deletion?"}
    PhysicalErasure -- "Not implemented" --> Blocked["GAP-03: requires per-jurisdiction\nretention-period rules not specified\nin BRD"]
    Blocked --> SignOff(["Requires explicit legal/compliance\nsign-off per tenant jurisdiction\nbefore being exposed"])

    classDef notbuilt fill:#fee,stroke:#c00,stroke-dasharray: 4 2;
    class PhysicalErasure,Blocked,SignOff notbuilt;
```

**Status — Not Identified in Current Implementation / Requires Clarification**: the "technical capability, flagged as pending legal sign-off" version of full physical erasure discussed during a later phase of this engagement (Pass 6 of the then-current 8-pass plan) had not yet been built as of the last code state this documentation pass analyzed — the red-dashed branch above reflects the repository's actual current state (pseudonymization only), not the forward plan. Confirm against `backend/app/services/` for a `gdpr_service.py` or equivalent before asserting otherwise in any future revision of this document.

## Not Identified in Current Implementation

- An "approval workflow" flowchart for **Defects** (equivalent to the Test Case approval flowchart above) was not produced as a separate diagram — defect status transitions are fully covered by the Defect Lifecycle sequence diagram (`SEQUENCE_DIAGRAMS.md` §5), which already shows the forward-only state sequence and its branches; a second flowchart would have been largely redundant.
- A dedicated CI pipeline / quality-gate flowchart (lint/typecheck/test/build order) is **not covered here** — this package documents the deployed application's own runtime behavior, not its development/CI tooling.
