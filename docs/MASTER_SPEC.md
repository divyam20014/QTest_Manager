# QTestHub Enterprise TMS — Master Spec (Planning Phase)

Canonical condensed reference. Source of truth is `BRD-QTH-INS-2026-V2.4` (supplied in full by the stakeholder); this file indexes it against the engineering decisions in `ARCHITECTURE_DECISIONS.md` and must not be treated as replacing the BRD's business intent — only as the implementation-facing summary of it.

## Product
Multi-tenant, cloud-native Test Management System for insurance organizations (carriers, TPAs) covering five lines of business: Motor, Health, Travel, Life, Property. End-to-end QA governance: project portfolio → test case authoring/versioning/approval → bulk CSV import/export → test execution with step-level timing → step-level defect management → reporting/analytics → immutable audit trail.

## Tech stack (binding)
Frontend: React, TypeScript, Vite, Tailwind CSS, shadcn/ui, Lucide, Recharts, React Router, TanStack Query, React Hook Form, Zod.
Backend: Python, FastAPI, SQLAlchemy, Alembic, Pydantic, REST.
Database: PostgreSQL (+ Row-Level Security), Docker/Docker Compose.
Security: Argon2id, HTTP-only session cookies, RBAC, RLS, MFA, append-only hash-chained audit log.
Testing: Pytest, Vitest, React Testing Library, Playwright.

## Roles (fixed, BRD §3.2 — see ADR-014)
**Admin**: full tenant control, user/role management, audit access, all project/testing operations.
**Manager**: assigned-project management, approvals, run management, defect triage, compliance exports.
**Tester**: assigned-project access, authoring, execution, defect creation, bulk import/export, restricted reporting.
Enforced server-side; frontend hiding is supplementary only.

## Application hierarchy
```
Platform Administration        Tenant Workspace
├─ Tenant Management           ├─ Dashboard
├─ User Management (bootstrap) ├─ Project Management (Motor/Health/Travel/Life/Property)
└─ Global Configuration        ├─ Test Management (Repository/Authoring/Review/Versioning/Bulk I-O)
                                ├─ Test Execution (Plans/Console/Step Results/History)
                                ├─ Defect Management (Repository/Lifecycle/Step Linkage/Regression Verify)
                                ├─ Reporting & Analytics (Project/Assignee/Domain/Execution/Compliance)
                                └─ Administration (Users & Roles/Audit Logs/Settings)
```

## Core lifecycles
**Test case** (authoring/approval, ADR-001): `draft → ready_for_review → approved → deprecated`. Editing an approved case creates a new immutable version (ADR-003).
**Test run case** (execution, ADR-001): `pending → in_progress → passed|failed|blocked|ignored`, computed server-side from step verdicts.
**Defect** (BRD §7.2): `New → Open → Fixed → Verified → Closed`.

## Key invariants (non-negotiable, enforced at DB + service layer)
1. `tenant_id` is always server-derived, never client-supplied (ADR-007).
2. A step is referenced by its row id (`test_case_version_step_id`), never a bare array index (ADR-002).
3. Execution state lives in normalized tables, never a single JSON blob (ADR-004).
4. An approved test case's steps are immutable; changes version forward (ADR-003).
5. Audit log rows are insert-only (ADR-006).
6. A test run case always pins the exact test case version it is executing (ADR-003).

## Insurance domains
Fixed enum: `Motor, Health, Travel, Life, Property`. Each project belongs to exactly one domain (FR-PROJ-001). The platform tests insurance systems; it does not itself compute premiums, adjudicate claims, or perform actuarial math (explicit boundary, BRD §2.2 / master prompt §5).

## Out of scope (BRD §2.2 + master prompt confirmation)
- Hardware/firmware testing.
- Direct production schema migration of third-party policy admin systems (Guidewire, Duck Creek, etc.).
- Real-money payment/settlement processing.
- Insurance premium/claims calculation logic as a product feature.

## Document map
- `ARCHITECTURE.md` — module boundaries, request lifecycle, deployment.
- `DATABASE_SCHEMA.md` — full relational schema, RLS policy shape.
- `API_SPECIFICATION.md` — endpoint inventory per module.
- `ARCHITECTURE_DECISIONS.md` — ADRs resolving every identified BRD ambiguity.
- `KNOWN_GAPS.md` — residual risks and deferred/open decisions.
- `REQUIREMENT_TRACEABILITY.md` — BR → FR → module → DB entity → endpoint → test coverage → status.
- `IMPLEMENTATION_STATUS.md` — phase plan and current progress (living document, update every phase).

## Working agreement
Implementation proceeds phase by phase per explicit instruction; no phase begins until the prior phase's tests pass, docs are updated, and completion criteria (see `IMPLEMENTATION_STATUS.md`) are met. No feature is marked complete in the traceability matrix until it works end-to-end (UI + backend + DB + RBAC + tenant isolation + tests).
