# Use Case Diagrams

**Purpose**: map each actor to the capabilities they actually have, sourced from real `require_permission()`/`require_any_permission()` gates and router definitions, not an idealized feature list.
**Scope**: a system-wide overview covering every major module, plus one module-level detail diagram (Test Execution & Defects) chosen because it has the richest actor/permission interplay (strict assignee-only execution access, project-membership-gated defect assignment, a distinct machine actor for CI ingestion).

**Note on notation**: Mermaid has no native UML use-case diagram shape. Both diagrams below are modeled as a `flowchart` using stadium shapes (`(["..."])`) for use cases and actor-style nodes for actors, with `-.include.->`/`-.extend.->`/`-.alternative.->` labeled dashed edges standing in for UML's `<<include>>`/`<<extend>>` relationships. This is a deliberate, disclosed substitution, not a claim of native UML rendering.

## Overview — Actors × Major Modules

**Diagram source**: [`diagrams/usecase-overview.mmd`](diagrams/usecase-overview.mmd)

```mermaid
flowchart LR
    subgraph Actors
        PA(["Platform Administrator"])
        TA(["Tenant Admin"])
        MG(["Manager / Full-Access Custom Role"])
        TS(["Tester / Restricted Custom Role"])
        CI(["External CI/CD System"])
        IDP(["Tenant Identity Provider"])
    end

    subgraph UC_Platform["Platform Administration"]
        UC1(["Provision Tenant"])
        UC2(["Approve / Suspend Tenant"])
        UC3(["View Cross-Tenant Audit"])
    end

    subgraph UC_Admin["Tenant Administration"]
        UC4(["Manage Users & Invites"])
        UC5(["Build Custom Roles & Permissions"])
        UC6(["Configure SSO / SCIM"])
        UC7(["Configure Branding / IP Allowlist"])
        UC8(["Manage Field Customization\n(severity/priority/custom fields)"])
        UC9(["Manage Service Tokens (CI/CD)"])
        UC10(["Schedule Compliance Reports"])
    end

    subgraph UC_Project["Project & Test Management"]
        UC11(["Manage Projects & Portfolio"])
        UC12(["Author & Version Test Cases"])
        UC13(["Review / Approve Test Cases"])
        UC14(["Organize Modules / Shared Steps /\nSuites / Plans / Data Sets"])
        UC15(["Manage Requirements & RTM"])
    end

    subgraph UC_Exec["Test Execution"]
        UC16(["Create & Configure Test Runs"])
        UC17(["Execute Assigned Test Steps"])
        UC18(["Record Verdicts"])
        UC19(["Ingest Automated CI Results"])
    end

    subgraph UC_Defect["Defect Management"]
        UC20(["Report / Triage Defects"])
        UC21(["Track Defect Lifecycle"])
        UC22(["Get AI Root-Cause Suggestion"])
    end

    subgraph UC_Report["Reporting & AI"]
        UC23(["View Dashboards & Analytics"])
        UC24(["Export / Print Compliance Reports"])
        UC25(["Query AI QA Assistant"])
        UC26(["Generate Test Cases from\nRequirement via AI"])
    end

    PA --> UC1 & UC2 & UC3
    TA --> UC4 & UC5 & UC6 & UC7 & UC8 & UC9 & UC10
    TA --> UC11 & UC13 & UC20 & UC21 & UC23 & UC24
    MG --> UC11 & UC13 & UC16 & UC20 & UC21 & UC23 & UC24
    TS --> UC12 & UC17 & UC18 & UC20 & UC25
    MG --> UC12 & UC14 & UC15 & UC22 & UC25 & UC26
    CI --> UC19
    IDP -.->|"authenticates"| TA
    IDP -.->|"authenticates"| MG
    IDP -.->|"authenticates"| TS

    UC19 -.include.-> UC18
    UC18 -.extend.-> UC20
    UC13 -.include.-> UC12
```

### Actor descriptions

| Actor | Source | Description |
|---|---|---|
| Platform Administrator | `backend/app/models/identity.py::PlatformAdmin`, `backend/app/api/platform.py` | Bootstrap-only (ADR-008); authenticates via HTTP Basic against a table entirely separate from tenant RBAC. Not part of any tenant's permission model. |
| Tenant Admin | `roles.code == "admin"` (system role) | Full tenant-scope access: user/role management, all integration configuration, all project/test/defect capabilities. |
| Manager / Full-Access Custom Role | `roles.code == "manager"`, or a custom role holding `project.view.all` (computed effective tier, ADR-059) | Project-wide visibility and test-run creation authority; cannot manage tenant-level settings (SSO/roles/service tokens) unless the custom role explicitly grants those permission codes too. |
| Tester / Restricted Custom Role | `roles.code == "tester"`, or a custom role without `project.view.all` | Can author test cases and execute **only** run cases explicitly assigned to them (confirmed "Strict" access decision) — cannot create runs, approve test cases, or manage users. |
| External CI/CD System | `service_tokens` bearer auth | Machine actor; its only capability is posting automated test results to one scoped webhook endpoint. |
| Tenant Identity Provider | OIDC, per-tenant `sso_configs` | Authenticates users on the tenant's behalf; not an "actor" with QTestHub capabilities of its own, but shown because it initiates a real use case (SSO login) from outside the system. |

### Use case descriptions (selected, non-obvious ones)

- **Build Custom Roles & Permissions** (UC5): the role-builder capability (ADR-059/060) — a Tenant Admin can define a role with any subset of real, enforced permission codes; the 3 system roles remain fixed and always available.
- **Ingest Automated CI Results** (UC19) `<<include>>` **Record Verdicts** (UC18): a CI result is recorded through the identical `record_verdict`/rollup-recompute code path a human tester's verdict uses — modeled as an include relationship because it is literally the same underlying operation, authenticated differently.
- **Record Verdicts** (UC18) `<<extend>>` **Report / Triage Defects** (UC20): recording a `fail` verdict optionally extends into the defect quick-create flow — it is a conditional continuation, not a mandatory step (a tester may close the failed step without creating a defect, or link to an existing one instead).
- **Review / Approve Test Cases** (UC13) `<<include>>` **Author & Version Test Cases** (UC12): approval always acts on an already-authored version; it cannot exist independently.

## Detail — Test Execution & Defect Module

**Diagram source**: [`diagrams/usecase-execution-defects.mmd`](diagrams/usecase-execution-defects.mmd)

```mermaid
flowchart LR
    subgraph Actors
        MG(["Manager"])
        TS(["Tester (assigned-only, strict)"])
        CI(["CI/CD System (service token)"])
    end

    subgraph UseCases
        UC1(["Create Test Run\n(from Project / Suite / ad hoc)"])
        UC2(["Add Parameterized Data Rows\n(Test Data Set)"])
        UC3(["Assign Run Cases to Testers"])
        UC4(["Pause / Resume Run"])
        UC5(["Open Execution Step"])
        UC6(["Record Pass/Fail/Ignore Verdict"])
        UC7(["Re-run / Re-verdict a Step"])
        UC8(["Quick-Create Defect from Failed Step"])
        UC9(["Link to Existing Defect"])
        UC10(["View Linked Defects on\nTest Case / Test Run"])
        UC11(["Ingest CI Test Results (bulk)"])
        UC12(["View Execution Context\n(run/project/case/version/assignee)"])
    end

    MG --> UC1
    MG --> UC2
    MG --> UC3
    MG --> UC4
    TS --> UC5
    TS --> UC6
    TS --> UC7
    TS --> UC12
    UC6 -.extend.-> UC8
    UC8 -.alternative.-> UC9
    MG --> UC10
    TS --> UC10
    CI --> UC11
    UC11 -.include.-> UC6
```

**Why this module gets its own detail diagram**: it has the richest, most security-relevant actor/permission interplay in the system — a Manager creates and configures runs but a Tester can only act on steps explicitly assigned to them (not merely "any step in a project they belong to" — a deliberately **Strict** design confirmed during this engagement), and a wholly separate machine actor (CI/CD, bearer-token authenticated) can perform the same underlying "record a verdict" action through a completely different authentication path.

## Not Identified in Current Implementation

- No distinct "Customer / External Stakeholder (read-only)" actor exists in the current RBAC model — every authenticated identity in the system is one of the three system roles or a tenant-defined custom role; there is no concept of an external, un-provisioned read-only viewer (e.g., a client-facing report-only link).
- SCIM's actor (an IdP's SCIM client provisioning users automatically) is shown in the System Architecture diagram's client list but was not given its own use-case entries here, since its provisioning behavior was not independently re-verified as part of this documentation pass (see `SEQUENCE_DIAGRAMS.md`'s equivalent disclosure).
