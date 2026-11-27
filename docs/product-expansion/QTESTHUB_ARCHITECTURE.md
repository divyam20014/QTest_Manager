# QTestHub: Recommended Architecture

The current architecture is described in [Current state](QTESTHUB_CURRENT_STATE.md) **[V]**. This document is **[R]**.

## 1. Verdict

**Keep the architecture.** A FastAPI modular monolith, PostgreSQL with RLS, a React single-page app and a database-backed worker can carry the project management expansion. No finding calls for replacing a major part. The gaps are in **rules and data**, not in structure.

## 2. Critical architectural gaps

| Gap | Findings | What to do |
|---|---|---|
| Historical immutability is a convention in one code path, not a guarantee | F-01 | One function owns "may this version change?"; every write path uses it; database trigger as a backstop |
| No shared concurrency control | F-04 | One reusable `row_version` check and a standard 409 response, with a UI that keeps unsaved input |
| Release is not a first-class scope | F-02, F-03 | Define scope once (a service that returns the tasks, requirements, cases, runs and defects of a release) and use it for readiness, reports and sign-off |
| Two authorisation models (permission codes and role tiers) | F-06 | One policy function taking user, project and action; move services off `role_code` branches module by module |
| New data silently misses cross-cutting features | F-05 | An entity checklist enforced by tests: RLS, export, audit, search, soft delete, erasure |

## 3. Frontend

- Keep React Query, lazy routes, the navigation registry and the shared list, table and form components.
- New list screens use `ResponsiveTable`, `ListToolbar`, saved views and `PageHeader` [V components exist].
- Add one stale-write dialog used by every edit form. A form must compare with the copy it was **opened** from.
- Drag and drop (backlog, board) needs a keyboard equivalent. Prefer the existing move-button pattern before adding a library; adding one needs a written justification.
- Large screens (several over 900 lines [V, 2026-11-26]) should be split **only when a phase changes them**.

## 4. Backend and API

- Keep `api → services → models`. Add modules `planning` (milestones, sprints, dependencies), `release` (scope, readiness, sign-off), `resource`.
- Services must not call each other in cycles; release and reporting read from other modules and are not called by them.
- Keep `/api/v1`, the envelope, pagination caps and idempotency keys [V]. Additive changes only; renamed fields keep the old name for one release.
- Concurrency: `expected_version` in update bodies (already the project convention [V]) → 409 with the current version and who changed it. Lock the row (`FOR UPDATE`) for status changes and approvals.
- Existing large service files should be split along the same seams only when touched.

## 5. Database and reporting

- One shared schema with RLS; no per-tenant schemas, no second database.
- Reports query PostgreSQL. Add summary tables or materialised views only after measuring; the report cache is 20 seconds in development [V].
- Sprint and release reports need **recorded history** (scope changes, readiness snapshot). It cannot be reconstructed later.

## 6. Security

| Area | Current [V] | Recommendation |
|---|---|---|
| Sessions | Server-side, HttpOnly, Lax; idle and absolute limits | Keep. Add "sign out other sessions" for tenant users if absent **[U]** |
| CSRF (tenant plane) | No token or origin check found | Add an `Origin`/`Sec-Fetch-Site` check on state-changing requests, as the platform plane does |
| Organization isolation | Forced RLS, least-privilege role | Keep; add the generated cross-tenant test below |
| Identify role | Bypasses RLS | Confirm its grants stay minimal in every migration |
| Project permissions | Route-level override only | Fix before project-specific roles (F-06) |
| API authorisation | Per-route dependencies plus service checks | Add a test that lists every route with its required permission and fails on an unlisted route |
| Input validation | Pydantic, Markdown sanitising, formula guard on export | Keep |
| Uploads | Allowlist, signature check, size limit, checksum | Add malware scanning before wider commercial use; serve downloads as attachments **[U: not checked]** |
| Sensitive data | AI keys and SSO secrets encrypted; erasure exists | Extend erasure review to new tables with user references |
| Rate limiting | In process memory | With more than one API process or server, limits multiply. Use a shared store or limit at the proxy |
| Audit | Hash chain, checkpoints | Audit sign-off, overrides, role and scope changes |
| Backup and recovery | Scripts in two places; guides exist | Pick one set; schedule; **rehearse a restore** with attachments; set recovery targets **[U]** |

**Generated isolation test:** for every table with `tenant_id`, assert RLS and a policy exist, or that the table is on a reviewed exception list.

## 7. Background work

Keep the database queue. Reconsider a broker only if **measured**: queue delay breaching a stated target, many short jobs causing database contention, or a need for real-time push. Before adding job types, confirm retry, time-out and stuck-job handling **[U: stuck-job recovery not verified]**. Scheduled work (sprint snapshots, reminders) belongs in the existing worker loop; make each job safe to run twice.

## 8. Deployment

- Production already has a static frontend image and a TLS proxy [V]. **Build and test that stack**, including the content security policy, before relying on it **[U]**.
- Add a CI pipeline: lint, type checks, backend tests, unit tests, then browser tests with `npm run test:e2e` (it creates its own database [V]). CI will need its own handling of the full suite's length.
- Merge the duplicate `deploy/` and `deployment/` and script folders.
- Run migrations as one step before new application processes start; define rollback (restore or downgrade) per release.
- Use S3-compatible storage [V available] if more than one API server runs.
- No microservices.

## 9. Performance

Targets are **[U]** and should be agreed (for example list p95, dashboard p95, largest project size). Then: load-test with the existing scripts; watch board and tree limits (50,000 cases, 2,000 tasks [V]); paginate backlog and boards from the start; measure readiness and sprint reports on realistic data; resolve the failing import budget (GAP-69) by fixing it or changing the stated target.
