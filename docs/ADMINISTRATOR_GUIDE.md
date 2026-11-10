# QTestHub — Administrator Guide

Written for: two different audiences doing two different jobs, split clearly
below — (1) a **Platform Administrator** who provisions and manages customer
tenants, and (2) a **Tenant Admin** who manages one organization's own users,
roles, and settings. If you're looking for how to use the test-management
features themselves, see `docs/USER_GUIDE.md` instead.

## Part 1 — Platform Administration (tenant lifecycle)

Platform Administration is a deliberately separate identity plane from every
tenant's own login (ADR-008) — a platform admin is not a user of any tenant,
and no tenant user can see or affect platform-admin actions. It is reachable
at `/platform-admin` in the frontend (not linked from the main app's
navigation) or directly via the API under `/api/v1/platform/*`.

**Authentication:** HTTP Basic, using the email/password provisioned when the
platform admin account was created (see `backend/app/scripts/seed_platform_admin.py`
for bootstrapping the first one). As of Tier 0 (ADR-052), this plane has:
- **Rate limiting**: 60/minute across all platform routes (looser than
  tenant login's 10/minute, since this also gates the read-only tenant list
  the console re-polls after every mutation) — repeated rapid attempts are
  throttled (`429 rate_limited`). The per-admin lockout below is the primary
  brute-force defense on this plane, not this rate limit.
- **Lockout**: 5 consecutive failed logins locks the account for 15 minutes.
- **Audit attribution**: every tenant-create/status-change action records
  which platform admin performed it (previously unattributed).

A full session+MFA replacement of this HTTP Basic plane was evaluated and
deliberately deferred for this tier (see ADR-052) as disproportionate to the
rest of Tier 0's scope — treat platform admin credentials with the same care
as any other high-privilege credential (a password manager, not a shared
note) until that follow-up phase happens.

### 1.1 Provisioning a new tenant

Via the UI: open `/platform-admin`, sign in, click "New Tenant," fill in the
organization name and its first Admin user's name/email/temporary password
(must be 12+ characters with an uppercase letter, a lowercase letter, and a
digit), submit. The tenant is created already `approved` — there is no
separate self-service signup step to review first.

Via the API:
```
POST /api/v1/platform/tenants
Authorization: Basic <platform-admin-credentials>
{
  "tenant_name": "Acme Insurance",
  "admin_name": "Jane Admin",
  "admin_email": "jane@acme.example.com",
  "admin_password": "<temporary password>"
}
```
Hand the temporary password to the customer through a secure, out-of-band
channel — there is no email-invite flow yet (tracked separately, not in this
tier's scope); the Tenant Admin should change it after first login.

### 1.2 Suspending / reactivating a tenant

`PATCH /api/v1/platform/tenants/{tenant_id}/status` with
`{"status": "suspended"}` or `{"status": "approved"}`. Also available from
the `/platform-admin` UI's tenant list (Approve/Suspend buttons). Suspending
a tenant does not delete any data — it is reversible.

### 1.3 Operational tasks

- **Backups/restore**: see `docs/PRODUCTION_DEPLOYMENT_GUIDE.md` §5 and
  `scripts/db_backup.sh`/`db_restore.sh`/`attachments_backup.sh`. Run on the
  documented schedule; verify restores periodically against a scratch
  environment, not just on the day you actually need one.
- **Monitoring**: `GET /api/v1/ready` for readiness, container stdout (JSON
  lines, one per log event, each carrying a `request_id`) for logs, and the
  optional Sentry integration (`SENTRY_DSN`) for error alerting. See
  `docs/PRODUCTION_DEPLOYMENT_GUIDE.md` §7.
- **Migrations**: run automatically on deploy; see
  `docs/PRODUCTION_DEPLOYMENT_GUIDE.md` §4 for the upgrade/rollback
  procedure.

## Part 2 — Tenant Administration (per-organization)

A **Tenant Admin** is a user with the `admin` role inside one specific
organization/tenant (distinct from a Platform Admin above — a Tenant Admin
only ever sees their own organization's data, enforced by row-level security
at the database layer).

### 2.1 Managing users

From the Admin area in the main app: create users (name, email, role,
temporary password), deactivate/reactivate them, and change their role
(`admin` / `manager` / `tester` — the three fixed roles, see
`docs/USER_GUIDE.md` for what each can do). There is currently no
self-service email-invite flow — the Tenant Admin sets an initial password
directly and communicates it to the new user out-of-band.

### 2.2 Tenant settings

Under Settings (gated by the `tenant.settings.manage` permission, Admin-only
by default): organization name, default currency, default timezone, AI
feature toggle and provider credentials (if your organization uses the AI
Test Case Generator), and MFA delivery mode. Changes here apply org-wide and
take effect immediately.

### 2.3 Audit log

Every significant action (user/role changes, test case/defect/requirement
changes, settings changes, logins) is recorded in an append-only,
hash-chained audit log (`/audit` in the app, Admin/Manager-visible per your
role's permissions). A "Verify Chain" action re-derives every record's hash
from its stored fields and flags the first point of any detected tampering
or corruption — run it periodically, especially after any direct database
intervention (which should otherwise never happen in normal operation).

### 2.4 Data export / account deletion (GDPR-related)

A per-user "erase" action pseudonymizes one departing user's personal
identifiers while preserving the historical record they contributed to
(audit trail, test case authorship references) — see the Admin area's user
management screen. A tenant-wide bulk data export is a separately tracked,
not-yet-built capability (see `docs/KNOWN_GAPS.md`) — not covered by this
guide because it doesn't exist yet.
