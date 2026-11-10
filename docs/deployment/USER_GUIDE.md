<!-- Synced copy of docs/USER_GUIDE.md -- edit the canonical file; re-copy here. -->

# QTestHub — User Guide

Written for: an end user inside a customer organization (Tester, Manager, or
Admin role) using QTestHub day to day. For provisioning/administration tasks,
see `docs/ADMINISTRATOR_GUIDE.md` instead.

## Signing in

If you were invited, you'll receive an invite link (by email, or directly
from your Admin in non-production test environments) — open it and set your
own password to activate your account; there's nothing to sign in with until
you do. Otherwise, sign in with the email/password your organization's Admin
gave you directly. If your organization requires MFA, you'll be asked for a
one-time code after your password (delivered by email, or shown directly on
screen in non-production test environments). Your role (Tester, Manager, or
Admin) determines what you can see and do — set by your Admin, not something
you change yourself.

If your organization has single sign-on configured, a "Sign in with SSO"
button appears once you enter your organization's tenant ID — this redirects
you to your organization's identity provider, and you won't need a
QTestHub-specific password or MFA code (your identity provider handles that).
The first time you sign in this way, your account is created automatically.

## Dashboard

Your landing page: portfolio-wide rollups (project status, domain
breakdown), your own recent activity, and (if you have unread items) a
notification bell in the header.

## Projects

Projects are the top-level container for test cases, defects, and
requirements. Managers/Admins can create and configure projects (domain,
priority, budget, timeline); Testers see the projects they're assigned to.

## Requirements

Create and version requirements, link them to the test cases that cover
them, and view the Requirements Traceability Matrix (RTM) to see coverage
gaps — which requirements have no linked test case yet. If your organization
has AI features enabled, you can generate draft test cases directly from a
requirement's text (always a draft — a human reviews and accepts it before
it becomes a real test case, never auto-published).

## Test Repository

Browse, create, and edit test cases (title, steps, expected results,
priority). Test cases are versioned — editing one creates a new version
rather than silently overwriting history, and you can view prior versions.
You can:
- **Bulk import/export** via CSV (Test Repository's Import/Export actions;
  download the template first to see the expected columns). Imports are
  capped at 2,000 rows per file.
- **Attach files** (screenshots, supporting documents) to a test case.
- **Comment** on a test case, optionally @-mentioning a specific teammate
  (they'll get a notification).
- Group test cases by module/folder (if your organization has this enabled).
- Fill in any custom fields your organization has defined (shown automatically
  on the test case's detail page) and submit the case for review if your
  workflow requires it.
- Import ready-made Insurance QA Pack templates (Claims/Underwriting/Policy
  Admin) via the **Templates** button — a quick way to get a starting set of
  realistic test cases you can then edit freely.
- If AI features are enabled, ask the AI reviewer for quality suggestions on
  an existing test case (clarity, missing steps) — suggestions only; nothing
  is changed automatically.

Priority (and a defect's severity) are sets your organization's administrator
can customize — you may see different or additional options than the
Low/Medium/High/Critical defaults.

## Test Runs & Execution Console

Create a test run from a set of test cases, then work through it step by
step in the Execution Console: mark each step Pass/Fail/Blocked, add notes,
and attach evidence (screenshots, logs) or comments directly on a step. A
failed step can be linked directly to a new or existing defect without
leaving the console.

## Defects

Log defects (manually, or linked from a failed execution step), track status
through its lifecycle, categorize root cause, and attach supporting files or
comments. The Defects list has quick-create and role-gated contextual
actions for common next steps.

## Reporting

Dashboards and exportable reports: test execution summaries, defect
trends/aging, requirement coverage, and (if your organization is tracking
it) release-readiness and workload views. Compliance-style exports are
available where your role permits.

## Notifications

The header bell shows unread notifications for three events: someone
@-mentioned you in a comment, a test case was assigned to you, or a defect
you reported was closed. It polls automatically — no need to refresh the
page. Clicking a notification marks it read and takes you to the relevant
test case or defect.

## Your account

From the account menu: view your own profile, your own audit history
(every change recorded against your account), and change your password. An
Admin can deactivate your account or, when you leave the organization,
pseudonymize your personal details while preserving the historical record
you contributed to (your past test case edits, audit entries, etc. remain,
attributed to an anonymized placeholder rather than your real name/email).
