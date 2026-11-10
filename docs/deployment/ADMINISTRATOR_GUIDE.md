<!-- Synced copy of docs/ADMINISTRATOR_GUIDE.md -- edit the canonical file;
     re-copy here. See docs/deployment/DEPLOYMENT_ASSESSMENT.md. -->

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
platform admin account was created (see `backend/scripts/seed_platform_admin.py`
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
channel; the Tenant Admin should change it after first login. This bootstrap
step is the one place a password is still set directly — every subsequent
user in that tenant is provisioned via the invite flow (§2.1).

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
  `docs/PRODUCTION_DEPLOYMENT_GUIDE.md` §7, or run
  `deployment/scripts/health_check.sh` for a single pass/fail summary.
- **Security events**: failed logins, MFA/platform-admin lockouts,
  IP-allowlist rejections, and rate-limit trips each emit a distinct
  `security_event=...` log line — grep for it in your aggregator to alert on
  repeated auth failures. See `docs/deployment/SECURITY_CONFIGURATION.md`.
- **Migrations**: run automatically on deploy; see
  `docs/PRODUCTION_DEPLOYMENT_GUIDE.md` §4 for the upgrade/rollback
  procedure.
- **IP-allowlist break-glass recovery** (gap-closure pass, ADR-057): if a
  tenant admin locks their own organization out via Settings' IP
  Allowlist field, `POST /api/v1/platform/tenants/{tenant_id}/clear-ip-
  allowlist` clears it. See §2.2 below for the full procedure.

### 1.4 Assigning a tenant's subscription plan

`PUT /api/v1/platform/tenants/{tenant_id}/subscription` with
`{"plan_code": "standard", "status": "active", "seat_count": 25}`
(`GET /api/v1/platform/plans` lists the available plan codes). This is
schema/record-keeping only — there is no payment gateway integration in
this release; billing/invoicing is a separate, not-yet-approved item. Every
tenant starts on the Trial plan automatically when created.

### 1.5 Data residency (readiness metadata only)

Set a tenant's `data_region` (e.g. `us`/`eu`/`apac`) at creation, or change
it later with `PATCH /api/v1/platform/tenants/{tenant_id}/data-region`
(also available as a dropdown next to each tenant in the Platform
Administration screen). **This is readiness metadata only** — there is one
database and one deployment for every tenant regardless of this value; no
tenant's data is actually hosted in a different region. See
`docs/DATA_RESIDENCY.md` for what a real implementation would require. Only
a Platform Admin can set this — a tenant cannot change its own declared
region.

## Part 2 — Tenant Administration (per-organization)

A **Tenant Admin** is a user with the `admin` role inside one specific
organization/tenant (distinct from a Platform Admin above — a Tenant Admin
only ever sees their own organization's data, enforced by row-level security
at the database layer).

### 2.1 Managing users

From the Admin area in the main app, click **Invite User** (name, email,
role) — this sends (or, if no SMTP server is configured, surfaces as a
copyable link) a single-use, time-limited invite the person accepts by
setting their own password; no account exists until they do. "New User (set
password directly)" is still available for scripts/back-compat but is no
longer the recommended path. Deactivate/reactivate existing users and
change their role (`admin` / `manager` / `tester` — the three fixed roles,
see `docs/USER_GUIDE.md` for what each can do) from the same screen.

### 2.1a Subscription

Under Settings, a read-only **Subscription** card shows the organization's
current plan, status, and seat count. This is informational only — plan
assignment is a Platform Admin action (§1.4 below) and there is no
self-service upgrade/downgrade or payment collection in this release.

### 2.2 Tenant settings

Under Settings (gated by the `tenant.settings.manage` permission, Admin-only
by default): organization name, default currency, default timezone, AI
feature toggle and provider credentials (if your organization uses the AI
Test Case Generator), and MFA delivery mode. Changes here apply org-wide and
take effect immediately.

An **IP Allowlist** field (one CIDR block or IP per line) restricts which
networks can sign in or use an active session at all — leave it empty for
no restriction (the default). **Caution**: there is no *tenant-side*
in-app recovery if you set an allowlist that excludes your own current
network — you will be locked out immediately. Always confirm your own
network is included before saving.

**Recovery procedure (gap-closure pass, ADR-057)**: if a tenant locks
itself out this way, a Platform Administrator can clear that tenant's
allowlist via `POST /api/v1/platform/tenants/{tenant_id}/clear-ip-allowlist`
(platform-admin HTTP Basic auth, same as every other `/platform/*` route —
see Part 1 below). This is a deliberate "break glass" action: it is
audit-logged (`tenant.ip_allowlist_cleared_by_platform_admin`) and should
only be used when a tenant genuinely cannot reach support any other way,
since it removes the restriction entirely rather than editing it to a
single corrected entry — the tenant's own admin must re-add the intended
allowlist afterward.

A **Branding** card lets you set a display name, a primary color (applied to
the sidebar accent), and upload a logo (PNG/JPEG/SVG/WebP, 2MB max) — shown
to every user in your organization in the app's left sidebar.

An **SSO** card configures OIDC single sign-on (issuer URL, client ID/secret
from your identity provider, and the default role newly-provisioned SSO
users get). SAML is not supported. Once enabled, users see a "Sign in with
SSO" option on the login screen for your tenant — **an SSO login does not
require this app's own MFA code**, since the identity provider is trusted to
enforce its own. Password-based login keeps working unaffected alongside
SSO. An **SCIM Provisioning** card lets you generate/revoke bearer tokens for
your identity provider's SCIM client to create/update/deactivate users
automatically — point your IdP at `/api/v1/scim/v2/{your_tenant_id}/Users`
with one of these tokens.

### 2.2a Severities, priorities, status labels, and custom fields

Under Settings, admins and managers (gated by the new `field_customization.manage`
permission) can manage:

- **Defect Severities** / **Test Case Priorities**: add, rename, or remove the
  values your organization uses — every tenant starts with the same four
  defaults (Low/Medium/High/Critical) so nothing changes until you act. A value
  still in use by an existing defect or test case can't be removed, and at
  least one option must always remain.
- **Status Labels**: rename how an existing, fixed status is *displayed*
  (e.g. show "Closed" as "Resolved") without changing the underlying workflow
  — the actual status codes and their transition rules (including the reopen
  counter) are unaffected by this.
- **Custom Fields**: define extra fields (text/number/boolean/date/
  single-select/multi-select) on test cases, defects, or requirements. Fields
  appear automatically on each entity's detail page once defined. A field
  marked "required" is enforced only when a value is actively being saved —
  it does not retroactively block existing records.

A **Templates** button on the Test Cases page lets any project member import
ready-made Insurance QA Pack test cases (Claims/Underwriting/Policy Admin)
into the current project — each import creates real, editable test cases
organized into a matching module. Re-importing the same templates creates a
fresh copy rather than being skipped.

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
management screen.

A separate, genuine tenant-wide bulk **data export** ("Export Organization
Data" under Settings) generates a downloadable zip archive of everything
your organization owns — test cases, defects, requirements, executions,
comments, and more, as flat JSON files plus a manifest — distinct from the
per-user erase action above. It runs as a background job (click "Request
Export", wait for the status badge to show "succeeded", then "Download").
Attachment files are listed by reference, not included as bytes, to keep
the archive a reasonable size.
