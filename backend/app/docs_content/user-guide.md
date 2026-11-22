# QTestHub — User Guide

Written for the people who use QTestHub day to day inside a customer
organization. The guide is split by role. In the app (**User Guide** in the
sidebar) you only see the parts that match what your role allows: everyone sees
**Getting started** and **For Testers**; people who manage projects and runs
also see **For Managers**; Admins also see **For Admins**.

## Getting started

### Signing in

If you were invited, you receive an invite link (by email, or directly from
your Admin in non-production test environments). Open it and set your own
password to activate your account; there is nothing to sign in with until you
do. Otherwise sign in with the email and password your Admin gave you.

If your organization requires MFA, you are asked for a one-time code after your
password (delivered by email, or shown on screen in non-production test
environments). If your organization has single sign-on configured, a **Sign in
with SSO** button appears once you enter your organization's tenant ID. It
takes you to your identity provider, and you do not need a QTestHub password or
MFA code. The first time you sign in this way your account is created
automatically.

Your role (Tester, Manager, Admin, or a custom role) decides what you can see
and do. It is set by your Admin and is not something you change yourself.

### Finding your way around

The sidebar groups the app into **Workspace** (Dashboard, Projects), **Test
Management** (Test Cases, Test Runs, Execution Console, Defects), **Analytics**
(Reports, Compliance Reports) and **Administration** (Admin). **User Guide**
and **Profile** sit at the bottom. On a phone the sidebar becomes a bottom bar
with a **More** menu. Entries your role cannot open are not shown. The search
box in the header (or Ctrl/Cmd+K) opens the command palette to jump to any
screen you can open. The breadcrumb above each page shows where you are.

### Appearance

Open **Appearance** (the palette icon in the header, or More on a phone) to
choose System, Light, Dark, Cobalt & Sunshine, Sage & Tangerine, Indigo & Aqua
or Custom. The change applies at once, including the sign-in page. Custom opens
"Create your theme": pick a light or dark base, a primary and an accent colour
and an optional surface tint. The theme is adjusted automatically to meet WCAG
AA and you are told when a colour had to change. You can keep up to three named
custom themes. The choice is remembered in this browser only, not in your
account.

### Notifications

The header bell shows unread notifications for three events: someone
@-mentioned you in a comment, a test case was assigned to you, or a defect you
reported was closed. It updates by itself, so you do not need to refresh.
Clicking a notification marks it read and opens the test case or defect.

### Your account

Open **Profile** to see your own details, your own audit history (every change
recorded against your account) and to change your password. Your Admin can
deactivate your account. When you leave the organization, they can pseudonymize
your personal details while keeping the historical record: your past edits and
audit entries remain, attributed to an anonymized placeholder instead of your
name and email.

### Release freezes

If your organization has set a release freeze, a banner shows the reason and
when it ends. While it is active, changes covered by the freeze (for example
editing test cases or recording results) are refused with the same reason. You
can still view everything and run reports. Admins are not affected.

## For Testers

Testers find, run and report on tests. This part explains each module, how to
use it, and what is limited for you.

### Dashboard

Your landing page. It shows project status and domain rollups, four clickable
cards (Pass rate, Active runs, Open defects, Test cases) with the change since
30 days ago, the execution trend, what needs attention and your recent
activity. The **View** switcher at the top moves between the built-in
**Overview** and any dashboards you or your team have made. A Tester can open
the team default dashboard and read it, but cannot create or edit dashboards of
their own unless a custom role allows it. Widgets show only data you could see
elsewhere; a project you cannot access shows "No access to this project".

### Projects

A project is the container for test cases, defects and requirements. You see
the projects you are assigned to. Opening one shows its Dashboard (summary
tiles, release readiness, trends and risk widgets, read only). The tabs above
it switch to Details, Requirements, Test Cases, Test Runs and Defects. The
buttons at the top (**New test run**, **New test case**, **Report defect**) take
you straight there for this project. You only see the buttons your role allows.
Creating and configuring projects is a Manager task.

### Test Cases

Test Cases (in the sidebar) is where tests are written and kept. A test case
has a title, steps with expected results and a priority, and it is versioned:
editing creates a new version and the earlier ones stay viewable.

Step by step:

1. Open **Test Cases**, filter or search for the case you need, and open it.
2. To write one, choose **New Test Case**, or use **Quick add**: enter a title,
   priority, an optional module and up to three steps, then press Create or
   Ctrl/Cmd+Enter. **Create and add another** keeps the priority and module so
   you can enter a batch. **More options** opens the full form.
3. On a case you can attach files, add comments (@-mention a teammate to notify
   them), fill in any custom fields your organization defined, and use the
   **Linked Requirements** card to type, pick a requirement to link it and use
   the x on a chip to unlink it.
4. **Compare Versions** shows a summary such as "1 step changed, 1 added", then
   each changed field and step labelled Added, Removed or Changed.
5. **Templates** imports ready-made Insurance QA Pack cases (Claims,
   Underwriting, Policy Admin) as a starting set you can edit.
6. If AI features are enabled for your organization, you can ask the AI
   reviewer for suggestions on a case. Suggestions only: nothing changes
   automatically.

Use the **Columns** menu on any list to hide columns or switch to Compact rows;
it is remembered per table. The **Views** menu next to the filters (Test Cases,
Defects, Test Runs) saves your filters under a name. Pick a view to apply it,
use the star to make it your default, the pencil to rename and the bin to
delete. Views are private to you, up to 25 per list.

What is limited: bulk edit, CSV import and export, and quarantining a flaky test
are Manager tools; priorities and statuses use the sets your organization
configured, so you may see different options from the defaults.

### Test Runs and the Execution Console

A test run is a set of test cases to execute, usually against one build and
environment. **Test Runs** lists them. **Execution Console** (or **Execute** on
a run) is where you work through one.

1. Open a run assigned to you and open the first case. In the console, mark each
   step **Pass**, **Fail**, **Blocked** or **Ignore**, add notes, and attach
   evidence (screenshots, logs) or a comment directly to the step.
2. When a step fails, link it to a new or existing defect without leaving the
   console. A blocked case asks for the reason.
3. Move to the next case. A run finishes by itself once every case is complete:
   blocked, or every step recorded with no failure. A case with a failed step
   keeps the run open on purpose, so you can re-run the failed step after the fix
   and mark it Pass; the run page says which cases are holding it open.
4. **Cockpit mode** in the console header switches to a dark, denser layout with
   larger result buttons and the step timer pinned at the top. It only affects
   the console, ignores the app theme and is remembered in this browser.
   Printing always uses the light look.

What is limited: Testers execute runs; creating, finishing, reopening and
deleting runs, and **Rerun failed**, are for people who can create runs
(normally Managers). A finished run is locked.

### Defects

**Defects** lists issues found in testing. Log one with **Report defect** (or
from a failed step), then follow it through its statuses. You can set severity,
categorize the root cause, and attach files or comments. The list has
quick-create and next-step actions that appear only when your role allows them.
Severity and status names are your organization's own sets.

### Requirements (view)

Each project has a **Requirements** tab listing what the product must do and
which test cases cover it. As a Tester you read requirements and see their
linked test cases and coverage; use it to understand why a case exists. Creating
or versioning requirements and the Requirements Traceability Matrix gap view are
Manager tasks.

### What a Tester sees when visibility is limited

Your Admin can limit what Testers see. If **assigned cases only** is on, you see
only test cases assigned to you, or in a test run assigned to you or started by
you; everything else is simply not listed, and opening one by link shows "not
found". If **Reports are hidden**, the Reports menu is gone and report pages show
a no-access message, but your Dashboard still shows your projects, defects and
activity. Ask your Manager or Admin to assign you a case if one you need is
missing.

## For Managers

Managers plan the testing, watch progress and decide when work is ready. You
can do everything a Tester can, plus the following. These tools appear for
anyone whose role can view all projects, including custom roles.

### Setting up projects

**Projects** lists every project. **New Project** creates one with a name,
domain, priority, budget and timeline. In a project's **Details** tab you manage
members, builds, suites and plans. Keep the builds and environments current so
runs can target them (environments are maintained under Admin, see "For
Admins").

### Requirements and coverage

On a project's **Requirements** tab create requirements and new versions, link
them to the test cases that cover them, and open the Requirements Traceability
Matrix (RTM) to see coverage gaps: requirements with no linked test case yet. If
AI features are enabled you can generate draft test cases from a requirement's
text. The result is always a draft: a person reviews and accepts it before it
becomes a real test case.

### Planning and assigning runs

1. In **Test Runs** choose **New test run**, pick the project, build and
   environment, and choose the cases (tick **Skip quarantined cases** to leave
   out flaky ones).
2. Assign testers to the run. **Create and start** opens the Execution Console on
   the first case right away.
3. Watch progress on the run page. **Finish Run** closes a run when some cases
   stay failed on purpose; a finished run is locked and **Reopen Run** makes it
   active again without changing any result.
4. **Rerun failed** on a run with failed or blocked cases makes a new run named
   "<name> (rerun)" holding only those cases with the same assignees. Passed
   and ignored cases are left out and the original run is unchanged. If a
   release freeze is active the button shows the reason instead of creating the
   run.

### Test case management

From the Test Cases list, tick rows (up to 100) and use the bar to **bulk edit**:
assign, change priority, move to a module or quarantine. **Import** and
**Export** use CSV (download the template first to see the columns; imports are
capped at 2,000 rows per file). You can submit cases for review where your
workflow requires it.

**Quarantine** a flaky test from its page or from the Flaky Tests card, giving a
reason. A Quarantined badge shows on the case. Quarantine never deletes
anything: history and verdicts in existing runs still count, and release
readiness and the leakage card always show the quarantined count separately, so
a quarantined case cannot hide a failure. Use **Remove quarantine** when it is
stable again.

### Defect triage

On **Defects**, review new defects, set severity and status, assign them, record
the root cause and close them. A defect you reported being closed notifies the
reporter. Use saved **Views** (for example "Open and critical") to keep a triage
list one click away.

### Reports

**Reports** has the tabs **Overview**, **Compliance** and **Report builder**.
Overview holds dashboards and exportable reports: execution summaries, defect
trends and aging, requirement coverage, release readiness and workload. Filter by
project and date. The **Defect Leakage & Test Effectiveness** card shows how many
defects reached users. A defect has *escaped* when it is linked to a release
whose release date has passed, or when its environment is named Production or
Prod. *Leakage* is escaped defects divided by all defects, and *detection
effectiveness* is the rest; both read "No defects" when there is nothing to
measure. The card lists open escaped defects by age and severity, a per-release
table and a monthly trend, and exports to Excel.

**Compliance** (also **Compliance Reports** in the sidebar) opens print-ready
compliance exports, available to roles that hold the compliance export
permission.

### Report builder

Open **Report builder**. Pick a source (test cases, test runs or defects), tick
the fields to show and reorder them with the arrow buttons, add filters (field,
operator, value), optionally group by up to two fields to get a count per group,
choose a sort and press **Run**. Results are paged. Type a name and press
**Save** (or **Save as** for a copy); tick **Share with workspace** to let
colleagues run and export it read only. Saved reports appear under My reports
and Shared reports. **Export CSV** and **Export Excel** download the saved
version (up to 5000 rows). You only ever see data you could already see
elsewhere. It is not available when Reports are hidden from Testers and you hold
a Tester-level role.

### Custom dashboards

Use the **View** switcher on the Dashboard to move between **Overview**, your
own dashboards and the **Team default**. **Customize** opens the list where you
create, rename and delete them.

1. Choose **New dashboard**, name it (up to 60 characters; 10 dashboards per
   person) and open it.
2. Choose **Edit layout**, then **Add widget**. Pick a type, set its project or
   other options and a size: Small, Medium or Large (1, 2 or 3 of 3 columns;
   everything stacks on a phone).
3. Use the arrow buttons to reorder, the size menu to resize, the gear for
   settings and the bin to remove (12 widgets per dashboard). **Save** keeps the
   whole layout at once; **Cancel** discards your edits.

Dashboards are private to you. Only an Admin can mark one **Team default**.

### Release freezes (view)

Managers see the freeze banner and the reason, and are blocked by an active
freeze for the changes it covers. Freezes are created by Admins under Access
Control; ask an Admin if one needs to start, end or change.

## For Admins

Admins run the organization's workspace. You can do everything Managers can. This
part covers the **Admin** area and day-to-day administration. Open **Admin** in
the sidebar. A menu on the left lists **Users & Roles**, **Access Control**,
**Environments**, **Settings** and **Audit Logs**; on a phone it becomes a
**Section** drop-down. You only see the sections your role allows (Managers, for
example, see only Environments).

### Users and roles

**Users & Roles** lists everyone in the organization. Search, filter by role or
status (Active, Deactivated) and sort. From here you can:

- **Invite User**: enter name, email and role. The person gets an invite link to
  set their own password. This is the normal way to add people.
- **New User**: create someone directly with a temporary password.
- Change a user's role, reset a password, deactivate or reactivate an account.
- When someone leaves, **erase** their personal details. A preview lists what is
  removed and what is kept; history stays attributed to an anonymized
  placeholder.

### Access Control

**Access Control** has two tabs.

- **Roles & Permissions** shows the permission matrix for each role. Admin,
  Manager and Tester are the standard roles. **New role** creates a custom role
  with exactly the permissions you tick; a custom role that can view all
  projects is treated as Manager-level in the app. Edit a role, review the
  change and save; unsaved changes are flagged.
- **Access rules** (release freezes and restricted environments). **New rule**
  blocks selected actions (test cases, test runs, recording results, defects,
  requirements) for chosen roles, either always or in a time window, optionally
  for one environment. A rule shows whether it is Active now, Scheduled, Ended
  or Disabled. Admins are always exempt. While a freeze is active, everyone else
  sees its reason on the page.

### Environments

**Environments** lists the environments test runs can target. Choose **Add
Environment** to add one, and edit or retire existing ones. Managers can also
maintain this list.

### Settings

**Settings** has these tabs:

- **General**: organization-wide configuration.
- **Branding**: the look of your workspace.
- **Fields**: the organization's own option sets and fields: defect severities
  and priorities, test case priorities, defect and test case status labels, and
  custom fields for test cases, defects and requirements. Users see these
  automatically on the matching screens.
- **Security & SSO**: single sign-on and sign-in requirements such as MFA.
- **Integrations**: SCIM and service tokens for connecting other systems.
- **Data**: **Tester visibility** (limit Testers to assigned cases, hide Reports
  from Testers), AI features, your subscription and seat usage, data export and
  scheduled reports.

### Audit Logs

**Audit Logs** records who changed what and when across the organization. Filter
to investigate a change or prepare for a review. Each person can also see their
own history under Profile.

### Onboarding a team

1. In **Settings**, set the organization details and, if needed, turn on MFA or
   SSO under Security & SSO.
2. Under **Fields**, adjust severities, priorities, status labels and custom
   fields to match how your teams work.
3. Under **Environments**, add the environments your testers run against.
4. In **Users & Roles**, **Invite User** for each person with the right role
   (create a custom role first under Access Control if the standard ones do not
   fit).
5. Create the first project, add members and, optionally, set the team default
   dashboard (on one of your dashboards choose **Set as team default**).
6. Under **Settings > Data**, choose whether Testers see only assigned cases and
   whether Reports are hidden from them.
7. Use **Access rules** to schedule release freezes when needed.
