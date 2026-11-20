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

**When a run finishes.** A run finishes by itself once every case is complete: blocked,
or every step recorded with no failure. A case with a failed step keeps the run open on
purpose, so the tester can re-run the failed step after the fix and mark it Pass; the run
page then says which cases are holding it open. If you are done and some cases stay
failed, a manager or admin finishes the run with **Finish Run**. A finished run is locked;
**Reopen Run** (manager or admin) makes it active again without changing any result.

**Cockpit mode.** The **Cockpit mode** button in the console header switches the console to a dark, denser layout with larger Pass/Fail/Ignore/Block buttons and the step timer and blocked state pinned at the top. It is off by default, only affects the Execution Console, ignores the app light/dark theme, and is remembered in this browser. Printing always uses the light look.

**Rerun failed.** On a run that has failed or blocked cases, **Rerun failed** (anyone who can create runs) makes a new run named "<name> (rerun)" holding only those cases, with the same assignees, and opens it. Passed and ignored cases are left out and the original run is unchanged. If a release freeze is active the button shows the reason instead of creating the run.


## Saved views

The Test Cases, Defects and Test Runs lists have a **Views** menu next to the filters. Set your filters, type a name and choose **Save current**. Pick a view to apply it, use the star to make it your default (applied when you open the list with no filters in the address), the pencil to rename and the bin to delete. Views are private to you and are not shared. You can keep 25 per list.

## Comparing test case versions

On a test case, **Compare Versions** shows a summary such as "1 step changed, 1 added", then each changed field and step with a text label (Added, Removed, Changed) and the changed words underlined or struck through. Unchanged steps are hidden behind a button.
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

## Release freezes

If your organization has set a release freeze, a banner on the page shows the reason and when it ends. While it is active, changes covered by the freeze (for example editing test cases or recording results) are refused with the same reason instead of "try again". You can still view everything and run reports. Admins are not affected.

## Documentation

**Documentation** in the sidebar opens the in-app guides (this user guide, the product vision and spec, requirement traceability and the architecture diagrams) after you sign in; they are loaded from the server for your session, not stored in the app. Administrators also see the administration, deployment and engineering references; if you open a link to one you are not allowed to read, you get a "No access" page.

## Your account

From the account menu: view your own profile, your own audit history
(every change recorded against your account), and change your password. An
Admin can deactivate your account or, when you leave the organization,
pseudonymize your personal details while preserving the historical record
you contributed to (your past test case edits, audit entries, etc. remain,
attributed to an anonymized placeholder rather than your real name/email).

## What a Tester sees when visibility is limited (ADR-093)

Your Admin can limit what Testers see. If **assigned cases only** is on, you see only test cases assigned to you, or in a test run assigned to you or started by you; everything else is simply not listed, and opening one by link shows "not found". If **Reports are hidden**, the Reports menu is gone and report pages show a no-access message, but your Dashboard still shows your projects, defects and activity. Ask your Admin or Manager to assign you a case if one you need is missing.
