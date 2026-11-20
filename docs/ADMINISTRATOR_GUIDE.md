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

**Authentication:** password **plus an authenticator-app code** (TOTP), exchanged for a
server-side session cookie (ADR-074; HTTP Basic is no longer accepted). See §1.0 below for
signing in, first-time authenticator setup, recovery codes and lost-device recovery; see
`backend/scripts/seed_platform_admin.py` for bootstrapping the first admin. Protections on this plane
(ADR-052 and ADR-074):
- **Rate limiting**: 60/minute across all platform routes (looser than
  tenant login's 10/minute, since this also gates the read-only tenant list
  the console re-polls after every mutation) — repeated rapid attempts are
  throttled (`429 rate_limited`). The per-admin lockout below is the primary
  brute-force defense on this plane, not this rate limit.
- **Lockout**: 5 consecutive wrong passwords, or 5 consecutive wrong authenticator/recovery
  codes, lock the account for 15 minutes (and end its sessions).
- **Audit attribution**: every tenant-create/status-change action records
  which platform admin performed it (previously unattributed).
- **Platform audit trail (ADR-082)**: sign-in, MFA, lockout, enrolment, password and admin-management
  events (successes and failures) are stored in a hash-chained table and shown on the **Audit** tab of
  Platform Administration (filter by event, outcome or actor email; newest first). **Verify chain**
  re-computes every hash and reports the first broken event. The tab is read-only; nothing is deleted or
  archived automatically, so plan retention/export yourself. The `security_event=...` log lines remain.
  Passwords, codes, secrets and session tokens are never recorded. **Create checkpoint** anchors the
  chain in an HMAC-signed checkpoint (ADR-085); **Verify chain** then also reports
  "N checkpoints verified" or the failure reason, and **Export checkpoints** downloads them as JSON
  (see 2.3 for what this does and does not protect).

Treat platform admin credentials with the same care as any other high-privilege credential
(a password manager, not a shared note), and keep the recovery codes somewhere separate from
the authenticator device.

### 1.0 Signing in to Platform Administration (password + authenticator app)

Platform Administration is protected by two steps (ADR-074). Open `/platform-admin` (linked from the bottom of the tenant sign-in page), then:

1. **Password** - your platform-admin email and password. Five wrong passwords lock the account for 15 minutes.
2. **Authenticator code** - the 6-digit code from your authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy...). Five wrong codes also lock the account for 15 minutes.

**First sign-in (setting up the authenticator).** An admin who has not enrolled yet first sees *Enter your enrolment code* (the one-time code their administrator gave them, separate from the password). Only then does *Set up two-step verification* show the QR code: scan it with the app (or type the setup key), enter the code it shows, and the console shows **10 recovery codes once**. Copy or download them and tick *I have saved these* before continuing - they are not shown again. A wrong or expired code shows *Invalid or expired enrolment code*; five wrong codes lock the account for 15 minutes, and a wrong guess does not use the code up.

**Onboarding a new platform admin.** (1) *Platform Admins* tab -> *New Admin*, set an email and a strong password. (2) The console shows the **enrolment code once** (copy button; it expires after `PLATFORM_ENROLMENT_CODE_TTL_HOURS`, default 24 h). (3) Send the password and the code to the new admin **through different channels** (for example password by chat, code by phone) - sending both together removes the protection. (4) They sign in, enter the code, set up the authenticator and save their recovery codes. If the code is lost or expires, use *Re-issue enrolment code* on their row (not available on your own account; any earlier code stops working). The row shows *Active until ...* or *No active code*. Admins that were un-enrolled before this feature existed have no code until you re-issue one.

**Using a recovery code.** On the code screen choose *Use a recovery code instead* and enter one code (hyphens and case do not matter). Each recovery code works exactly once, so enrol a new authenticator soon after using one (ask another platform admin for *Reset MFA*, or use the CLI below).

**Sessions.** You stay signed in for up to 8 hours, or 30 minutes of inactivity, whichever comes first; *Sign out* ends the session immediately. Changing an admin's password, deactivating them, resetting their MFA or locking the account ends all of their sessions.

**Session protection (ADR-083).** A session is tied to the browser (User-Agent) it signed in with: if the same cookie shows up from a different one, the session is ended and the attempt is recorded in the *Audit* tab as `session_binding_failed`. If your browser updates or you switch to a desktop-site view mid-session you will be signed out once; sign in again. After `PLATFORM_SESSION_IDLE_MINUTES` (default 30) without activity you are signed out with a message saying so (`session_idle_expired` in the Audit tab). Operators can also set `PLATFORM_SESSION_BIND_IP=true` to end a session when the IP changes; it is off by default because mobile and VPN users change address.

**Confirming sensitive actions (step-up).** Creating or deactivating an admin, issuing an enrolment code or a password-reset code, and resetting an admin's MFA need an authenticator code entered in the last 5 minutes (`PLATFORM_STEP_UP_MINUTES`). Signing in counts. Otherwise a *Confirm it's you* dialog appears; enter a code (or a recovery code) and the action carries on by itself. A code that was already used cannot be used again, so wait for the next one if you just signed in or just confirmed. Wrong codes count toward the same lockout as sign-in.

**My sessions.** In the console header choose *My sessions* to see every browser signed in as you (device, address, when it signed in and was last active) and *Sign out* any you do not recognise, for example one on a lost laptop. Signing out the session you are using returns you to the sign-in form. You cannot see or end another admin's sessions; deactivating them or issuing a password reset does that.

**Changing your own password (ADR-081).** In the console header choose *Change password*, enter your current password, the new password twice and a **fresh** authenticator code (the one you just signed in with is refused - wait for the next one) or an unused recovery code. The new password must follow the policy (12+ characters, upper, lower and a digit) and differ from the current one. Your other sessions end; this one stays. A wrong current password counts toward the 15-minute lockout like a wrong sign-in password.

**Forgotten or compromised password (another admin).** *Platform Admins* tab -> *Issue password reset code* on that admin's row (not on your own row). Their sessions end immediately and their old password stops working. The console shows a one-time reset code **once** (valid `PLATFORM_PASSWORD_RESET_CODE_TTL_HOURS`, default 24 h); pass it on through a trusted channel. They choose *Have a reset code?* on the sign-in screen, enter email, code, a new password and (if they have set up MFA) an authenticator or recovery code, then sign in normally. A wrong or expired code is a generic error, counts toward the lockout and does not use up the code; the *Password reset* column shows *Reset code active until ...* or *Reset code expired* (issue another). If you are the only admin, use the operator CLI (`python -m scripts.seed_platform_admin ...`), which also clears a pending reset.

**Lost your phone / authenticator.**
- Another platform admin: *Platform Admins* tab -> *Reset MFA* on your row (not allowed on your own account). The console shows a fresh one-time enrolment code once; they pass it to you separately, then you sign in, enter it and enrol a new authenticator.
- Nobody else can sign in (you are the only admin): run, with shell access to the deployment,
  `docker compose exec api python -m scripts.reset_platform_admin_mfa --email you@example.com`
  It prints a fresh one-time enrolment code (shown once); sign in with your password, enter that code and enrol again. `python -m scripts.seed_platform_admin ...` for an admin that is not enrolled also prints a code once.

**Local development: `http://localhost:5173` and `http://127.0.0.1:5173` both work.** The session cookie is `SameSite=Strict`, so the console and the API must be on the same site, and a browser treats `localhost` and `127.0.0.1` as different sites. The web app therefore sends its API requests to the same loopback name the page was opened on (`http://127.0.0.1:8000` for a page on `127.0.0.1`); both origins are in the API's default CORS list. Any other address (for example your machine's network IP) is not covered: the browser drops the cookie and sign-in reports "Your browser did not keep the sign-in cookie". In that case open the console on `localhost`, or serve the web app and the API from one origin as production does, and add the origin to `CORS_ALLOW_ORIGINS`.

**Development and automated tests only.** `python -m scripts.seed_platform_admin --email ... --password ... --totp-secret <base32>` pre-enrols a known secret so tests can sign in without a QR code. It is refused when `ENVIRONMENT=production`. The dev admin used by the e2e suite is `owner@qtesthub.local`, whose TOTP secret is the documented test value `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP` (you can add it to an authenticator app by typing it as the setup key, or re-enrol your own with the reset script).

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

### 1.6 Rotating the encryption key (operators)

`AI_CREDENTIAL_ENCRYPTION_KEY` protects Platform Admin MFA secrets, tenant AI
provider keys and SSO client secrets (ADR-084). It takes a comma-separated list: the
first key encrypts, all keys decrypt. Rotate with: generate a new key, deploy
`NEW,OLD`, run `python -m scripts.rotate_encryption_key` (dry run) then `--apply`,
run `--verify`, deploy `NEW` only, and keep the old key in your secrets manager for
as long as older database backups are retained. If every key is lost, Platform Admin
MFA must be reset with `python -m scripts.reset_platform_admin_mfa --email <email>`
and tenants must re-enter AI provider keys and SSO client secrets. Rotate at least
annually and after any suspected exposure. Full runbook: Production Deployment Guide,
section 5a.

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
(platform-admin session + MFA, same as every other `/platform/*` route —
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

**Signed checkpoints (ADR-085).** The hash chain alone cannot stop someone
with database-owner access from rewriting the whole log consistently. A
*checkpoint* records the chain's newest event, the event count and a link to
the previous checkpoint, signed with a secret key (`AUDIT_CHECKPOINT_HMAC_KEY`)
that is kept outside the database. On the Audit Logs page, **Create checkpoint**
makes one on demand, **Export checkpoints** downloads them as JSON, and
**Verify Chain Integrity** now also says "N checkpoints verified" or names the
problem: `signature_invalid` (a checkpoint was changed), `anchor_missing`
(events were deleted), `anchor_hash_mismatch` (events were rewritten),
`count_mismatch` (events were inserted or removed earlier in the log) or
`checkpoint_chain_broken` (a checkpoint was removed). The worker creates
checkpoints for every tenant and for the platform hourly; a scope with no new
events is skipped. Any failure should be treated as a security incident.

Limits: the signature only helps while the key stays secret, so an attacker
who holds both database access and the key can still forge everything. Events
since the last checkpoint are not yet protected. Store exported checkpoints
somewhere the database administrator cannot write (a ticket, a SIEM, an
object-lock bucket) so deletion of the newest checkpoints can be noticed.
Nothing exports automatically. Operators can also run
`python -m scripts.audit_checkpoint --dry-run` (see the Production Deployment Guide).

**How long does Verify Chain take? (ADR-087)** It re-hashes every event in Python, so time grows with the size of the log. Measured on a slow laptop with the database on the same machine: about 1 s for 10,000 events, 5 s for 50,000, 16 s for 100,000, with flat memory (about 6 MB). Your server will differ, so treat these as a guide only; a log of several hundred thousand events can take minutes and keeps one request open the whole time. For a quick routine check, call `GET /audit-logs/verify-chain?since_checkpoint=true`, which skips events already covered by a verified checkpoint and only walks newer ones (the response shows `skipped_count`); it will not notice an edit inside the already-checkpointed part, so still run the full check periodically, for example before an audit.

### 2.3b Tester visibility (Settings, Data tab)

Two switches, both off, so nothing changes until you turn one on. They apply to the whole organization and take effect immediately for every Tester; Managers and Admins are never affected.

- **Testers see only test cases assigned to them.** Turn it on when Testers should work from their own queue. A Tester then sees a case only if it is assigned to them, or sits in a test run assigned to them or started by them. Other cases vanish from the repository, search, counts, the dashboard and exports, and open as "not found". Assign cases (or run cases) to your Testers before enabling it, or they will see an empty repository.
- **Hide Reports from Testers.** Turn it on when report content is for leads only. Testers lose the Reports menu and report pages; the Dashboard still works, without the status chart and execution trend.

Each change is recorded in the audit log as `tenant.setting_changed`.

### 2.3a Release freezes and environment restrictions (access rules)

Access rules are off until you add one; nothing changes for anyone before that. Admins are always exempt, so you can always lift a rule.

To set a release freeze: open **Administration, Access Rules**, choose **New rule**, keep the type **Freeze window**, give it a name, choose All projects or one project, and set the start and end. Times are entered in your local time and enforced on the server in UTC; the form shows the UTC time under the fields. Tick what to block (test cases, test runs, recording results, defects, requirements; viewing and reports are never blocked), tick any role that stays exempt (Manager, Tester), and write the message people will see. Save. From the start time, anyone not exempt sees a banner and is refused with your message when they try to change something. **Disable** keeps the rule but stops it applying at once; **Delete** removes it.

An **Environment restriction** limits who can log defects against a named environment (for example Production), always or outside an allowed window. Test runs have no environment field, so a restriction does not apply to them. Every create, edit, enable, disable and delete is recorded in the audit log (name, type and scope only).

### 2.4 Data export / account deletion (GDPR-related)

**Erasing a user's personal data (Users & Roles, "Erase personal data").**
Only Admins can do this (permission `user.erase`). It is for a data-subject
erasure request or a departed person you must remove. It is irreversible, so
read the preview before you confirm.

1. Decide first. Confirm with your data protection officer or legal contact
   that erasure is appropriate and that you may keep the records listed below.
   QTestHub provides the mechanism; it does not decide that for you.
2. Open Users & Roles and choose "Erase personal data" on the user's row. You
   cannot erase yourself, the last active Admin, or someone already erased.
3. The dialog first shows a preview (nothing has changed yet): sessions that
   will be signed out, notifications deleted, invites and report-schedule
   addresses affected, and what is kept.
4. Type the user's exact email to enable the button, then confirm.

What happens: the name becomes "Erased user" and the email a placeholder, the
account is closed and signed out everywhere, their notifications and
verification codes are deleted, invites to their address are anonymised, and
their address is removed from report-schedule recipients (a schedule with no
recipients left is disabled). An `user.erased` audit entry records only who did
it and counts.

What is kept: the comments, defects, test cases, test runs and results they
created stay, attributed to "Erased user" (the same internal id). The text of
those records is not edited. The audit log is never changed, and older entries
(for example "user created", invites, SSO/SCIM provisioning, name edits) may
still contain the email or name that was typed at the time, because rewriting
them would break the tamper-evident chain. Backups and exports made earlier
still contain the data until they expire under your retention policy.

What to tell the data subject: their name, email and sign-in have been
removed from the live system and their account closed; work records they
contributed to were kept in pseudonymised form (no name or email shown) under
your legitimate-interest or legal-obligation basis; older audit entries and
backups may still hold their email or name until they expire. Adjust the
wording to what your DPO has approved. This is not a statement of compliance.

A separate, genuine tenant-wide bulk **data export** ("Export Organization
Data" under Settings) generates a downloadable zip archive of everything
your organization owns — test cases, defects, requirements, executions,
comments, and more, as flat JSON files plus a manifest — distinct from the
per-user erase action above. It runs as a background job (click "Request
Export", wait for the status badge to show "succeeded", then "Download").
Attachment files are listed by reference, not included as bytes, to keep
the archive a reasonable size.

### 2.5 In-app documentation (where it is served from)

The **Documentation** entry in the sidebar (`/brd`) reads the project documents from the API (`GET /api/v1/docs`), not from the web app's files, so a signed-out visitor gets a 401 and nothing readable. General documents (user guide, product documents, requirement traceability, architecture diagrams) are open to every signed-in user. The sensitive set (this guide, the production deployment guide, security configuration, backup and restore, known gaps, architecture, architecture decisions, database schema, API specification, test strategy, design system) is Admin only (the `tenant.settings.manage` permission): other roles do not see these in the list, and a direct link shows "No access".

The files live once in the repository's `docs/` folder. After editing one, run `npm run docs:sync` (or `python -m scripts.sync_docs` in `backend/`) to refresh the copies under `backend/app/docs_content/`, then rebuild the `api` image. `npm run docs:check` (and a backend test) reports drift.
