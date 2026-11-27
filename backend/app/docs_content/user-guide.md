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

Everything starts from the **sidebar** on the left (a bottom bar with a **More**
menu on a phone). It lists **Dashboard**, **My Work**, **Projects**, **Test
Cases**, **Test Runs**, **Defects**, **Reports** and **Admin**. **User Guide** and
**Profile** sit at the bottom. Entries your role cannot open are not shown. Two
pages are reached from another page: the **Execution Console** from **Test Runs**
or **My Work** (Test Runs stays highlighted while you are in it), and the
compliance report from the **Compliance** tab of **Reports**. Search (Ctrl/Cmd+K)
finds both. The small number beside **Defects** is your open defects and the one
beside **My Work** is what is waiting on you (see below); both come from live
data and are announced to screen readers when they change.

A quick map of where things live:

- **What is waiting on me?** My Work, or the Dashboard's attention list.
- **One project's numbers, plans, people and settings?** Projects, then the
  project. Its header has a **project switcher** (search by name; your recent
  projects come first and you stay on the same tab where the other project has
  it), and its tabs hold the Overview dashboard, Tasks (with the requirements),
  Test Cases, Test Runs, Defects, Reports, Planning and Team. Activity and
  project Settings open from the two icons in the header.
- **The same records as a board or a calendar?** The **List / Board / Calendar**
  switch above Defects, Test Cases and Test Runs (see "Views" below).
- **Something I use often?** Star it (Favourites) or find it under Recent.
- **Anything at all?** Ctrl/Cmd+K, the command palette.
- **Changing the menus for everyone?** Admin > Workspace (admins only).

Use the arrow button at the left of the header to shrink the sidebar to an icon
rail. In the rail every entry has a tooltip. On a phone the sidebar becomes a
bottom bar with **Dashboard**, **My Work**, **Projects**, **Defects** and
**More**; Test Cases, Test Runs, Reports and Admin are under **More**. When a row
of tabs is wider than the screen, an arrow at its edge shows there is more to
swipe to.

The header is one calm row: the sidebar button and the breadcrumb on the left
(only the current page on a phone), one search field in the middle, **+ New** (a
test case, run, defect, requirement or project, as your role allows), the
notification bell and your account menu on the right. The search field (or
Ctrl/Cmd+K) opens the command palette: type to find test cases, defects,
requirements, projects and test runs, to start something new, or to jump to any
screen you can open.

### Where records open

A requirement, test case, test run or defect opens **inside its project**: the
project name and tab strip stay above it, and the tab it belongs to is marked as
the current one. Links you saved or were sent before (a bookmark, a favourite, a
notification) still work; they take you to the same record in its project. The
Execution Console and the lists that span every project (Defects, Test Runs, Test
Cases in the sidebar) are unchanged.

### My Work

**My Work** is one page of what is waiting on you, with a tab each for **Run
cases** (assigned to you and not finished, grouped as In progress, Failed -
retest, Blocked and Not run; each one opens the Execution Console), **Tasks**
(tasks and sub-tasks assigned to you, from every project you can open, until
they are done; overdue ones first, then by due date),
**Defects** (open defects assigned to you or reported by you) and **Reviews**
(test cases submitted for review with you named as the reviewer). It only reads
data; nothing is stored for it. You see only what your role and project access
already allow.

### Favourites and Recent

Select the star beside the title of a project, test case, test run, defect or
requirement to add it to **Favourites** in the sidebar; select it again to
remove it. **Recent** lists the last eight of those pages you opened. Both are
kept in this browser for you only (another person on the same computer has their
own), so they are not shared and are not on your other devices. If a saved record
has since been deleted, its link will say it is not found; use the small x beside
it in the sidebar to remove it.

### Appearance

Open your account menu (your initials at the right of the header, or More on a
phone) and select **Appearance** to
pick System, Light, Dark, Cobalt & Sunshine, Sage & Tangerine, Indigo & Aqua
or Custom. The change applies at once, including the sign-in page. Custom opens
"Create your theme": pick a light or dark base, a primary and an accent colour
and an optional surface tint. The theme is adjusted automatically to meet WCAG
AA and you are told when a colour had to change. You can keep up to three named
custom themes. The choice is remembered in this browser only, not in your
account. The same menu has **My Account**, **Ask AI** and **Sign out**.

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
the projects you are assigned to. Opening one shows its **Overview** (summary
tiles, release readiness, trends and risk widgets, read only). The buttons on
the Overview (**New test run**, **New test case**, **Report defect**) take you
straight there for this project. You only see the buttons your role allows.
Creating and configuring projects is a Manager task.

#### The project workspace

Every page of a project shares one header and one row of tabs. The header shows
the project name, its status and priority, the owner, how many of its test cases
are approved (a bar and the real counts; "0 test cases" when there are
none), a star to add the project to your Favourites, and (if you can edit the
project) a gear that opens its Settings. The small up-down button beside the name
is the **project switcher**: type to search, recent projects come first, and
choosing one keeps you on the same tab when the other project has it, otherwise
it opens that project's Overview.

The tabs are **Overview**, **Tasks** (tasks, sub-tasks and the requirements in
them), **Test Cases**, **Test Runs**, **Defects**, **Reports**, **Planning** and
**Team** (members and project roles). **Planning** has two sections: **Suites &
plans** (test suites and test plans) and **Releases & builds** (managers can edit
a release's name, target date, status and notes). Two icons in the project
header open the rest: **Project activity** (what changed recently, plus the
newest test cases and defects) and, for people who can edit the project,
**Project settings** (project details, tabs and deleting the project). Small
numbers beside Test Cases, Test Runs and Defects are the real counts (defects are
the open ones). Defects and Reports open the usual Defects and Reports pages for
this project, with the project header and tabs above them. When the tabs do not
fit (a phone, a narrow window) the last ones move into a **More** menu; the tab
you are on always stays visible. An old link to **Releases** opens that section
of Planning. The old **Details** page (`/projects/{id}/details`) no longer exists
as a page, and an old link or bookmark to it opens the project's Overview.

**Choosing the tabs.** In **Project settings > Project navigation**, a manager can
move tabs up or down with the arrow buttons (they work from the keyboard, and the
change is announced) and untick **Show** for Tasks, Planning or Team. Overview,
Test Cases, Test Runs, Defects and Reports are always shown (they can be moved).
**Save tabs** stores it for everyone on that project; **Reset to defaults** puts
the standard order back. A hidden tab is only left out of the tab row: its page
still opens from a direct link, with a short note saying the tab is hidden (and a
link to settings if you can edit), and nobody gains or loses access to any data.

### The project header on smaller views

On the page of a single record (a task, test case, run, defect or requirement)
the project header shrinks to the project's name, the project switcher and the
Activity and Settings icons. On a phone every project page except the Overview
does the same, and the lists leave out their introduction, so records start
higher.

### Test Cases

Test Cases (in the sidebar) is where tests are written and kept. The sidebar page
covers every project, and each project also has a **Test Cases** tab; the columns
they share come in the same order. On the sidebar page, **Views** saves your
filters under a name (they are kept apart from a project tab's views), and
**Export** appears once you choose one project in **Filters**. Filters you saved
on this page before it had Views are copied into Views the first time you open
it in that browser; the copy in the browser is left as it was. Each test case
has a generated ID (`TC_000001`), is versioned (editing the steps or content
creates a new version and the earlier ones stay viewable) and moves through a
**Review Status**: Draft, Ready for Review, Approved or Deprecated. How a case
last *ran* is a separate thing, its **Execution Status** (Pass, Fail, Blocked,
Skipped or Not Run), taken from the most recent run. A result always keeps the
text it was run against. For that reason the steps and content of a
**Deprecated** test case cannot be changed.

If someone else saves a test case or defect while you are editing it, your save
is refused so that you do not undo their change. The edit form keeps what you
typed, brings in what they changed, and names any field you both changed; check
it and save again. **Approve**, **Request changes**, status changes and
assignment are refused in the same way if the record changed after you opened
it, so look at it again before you decide. You can still change details such as
priority and module; to change the content, duplicate the test case.

Writing a test case:

1. Open **Test Cases** and choose **New Test Case** (pick a project if asked).
   The form has six sections you can collapse; fields marked * are required and
   are checked when you leave them. A section with a problem shows how many
   fields to fix, and your entries are kept if saving fails.
   - **Basic Information**: the Test Case ID (read-only, with a copy button),
     Requirement / User Story ID, the Module, then optional Sub-module and
     Feature, the Title (5 to 255 characters) and a Description in Markdown with
     a Preview tab. Nothing is stored as HTML.
   - **Classification**: Test Type, Priority, Severity, Automation Status
     (Manual, Automated or Candidate for Automation) and Environment.
   - **Test Preparation**: Preconditions and Test Data. For JSON test data the
     form tells you whether it is valid and can pretty-print it; tick **Must be
     valid JSON** to refuse malformed text.
   - **Test Execution Instructions**: the step builder (below), the overall
     Expected Result and optional Postconditions.
   - **Execution Details**: read-only. It shows the latest execution (status,
     actual result, who, when, linked defects) and links to the execution
     history. Executing happens in a test run, so the definition is never
     overwritten by a result.
   - **Additional Information**: author, assignee, comments and attachments
     (available once the case is saved).
2. **Save as Draft** creates the case in Draft. **Save & Submit for Review**
   also sends it for review. **Cancel** asks first if you have unsaved changes.
3. **Quick add** (in the more-actions menu) asks only for the required fields:
   title, module, priority, preconditions, test data, expected result and up to
   three steps. **Create and add another** keeps the module, priority and setup
   text for a batch; **More options** opens the full form with what you typed.

The step builder: each step has an automatic number, an **Action**, optional
**Test data** and a required **Expected result**. **Add step** appends a row;
edit any row in place; the bin removes a step and a toast offers **Undo**. To
reorder, drag a row by its handle, or use the **Move up** / **Move down**
buttons (or the Arrow keys on the handle) if you cannot drag. Steps renumber
automatically, up to 200 per case. Pasting several lines into an Action creates
one step per line.

Step by step on an existing case:

1. Filter or search (by Test Case ID, title, requirement or module) and open the
   case. Its tabs are **Details**, **Steps**, **Executions**, **Versions**,
   **Comments & Attachments** and **History**.
2. **Executions** lists every run of the case: the run, date, who ran it, the
   status, the actual result, the version run and any defects raised. **History**
   shows what changed, with the old and new value of each field.
3. **Edit** opens the form, **Duplicate** copies the case into a new Draft (new
   ID, title ending "(Copy)", no results, comments or defects), and **Delete**
   removes it from lists and reports after a confirmation. Runs, defects and
   history already recorded are kept.
4. On a case you can attach files, add comments (@-mention a teammate to notify
   them), fill in any custom fields your organization defined, and use the
   **Linked Requirements** card to link or unlink a requirement.
5. **Compare Versions** shows a summary such as "1 step changed, 1 added", then
   each changed field and step labelled Added, Removed or Changed.
6. **Templates** imports ready-made Insurance QA Pack cases (Claims,
   Underwriting, Policy Admin) as a starting set you can edit.
7. If AI features are enabled for your organization, you can ask the AI
   reviewer for suggestions on a case. Suggestions only: nothing changes
   automatically.

Columns and views. The list opens with nine columns: Test Case ID, Title,
Module, Test Type, Priority, Automation Status, Execution Status, Executed By
and Last Execution Date. The **Columns** menu has three modes: **Default** (those
nine), **All fields** (all 22 fields of the test case standard) and **Custom**
(tick the ones you want; Review Status and Assignee are extra optional
columns). Click a sortable header to sort. **Filters** cover test type, priority,
severity, automation status, environment, execution status, executed by, module,
review status and assignee; the tabs above the table filter by Review Status.
Choose a row to open a quick-view drawer; the row menu has Open, Edit, Duplicate
and Delete.

The **Views** menu saves your filters, sort **and columns** under a name, so a
custom column set comes back with the view. Pick a view to apply it, use the
star to make it your default, the pencil to rename and the bin to delete. Views
are private to you, up to 25 per list. The **Export** menu downloads Excel or
CSV, either with **all fields** or with the **selected columns**, and contains
only the rows that match the current filters.

What is limited: the buttons you can use follow your permissions (create, edit,
delete, export); a disabled button says which permission is missing. Bulk edit,
import and quarantining a flaky test are Manager tools; priorities, test
types and severities use the sets your organization configured, so you may see
different options from the defaults.

### Test Runs and the Execution Console

A test run is a set of test cases to execute. A run does not record which build
or environment was tested; if that matters, put it in the run's name. A defect
has its own Environment and Build / Version Found fields. **Test Runs** lists
the runs. **Execution Console** (or **Execute** on
a run) is where you work through one. To see every case waiting to be executed,
open the console with the **Execution Console** button on **Test Runs**, or **Open
the Execution Console** on **My Work**.

1. Open a run assigned to you and open the first case. In the console, mark each
   step **Pass**, **Fail**, **Blocked** or **Ignore**, add notes, and attach
   evidence (screenshots, logs) or a comment directly to the step. The **Actual
   result** box above the buttons is required to fail a step (the console asks
   inline) and optional for Pass; it appears in the case's Executions tab.
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

### Views: List, Board and Calendar

Defects, test cases and test runs can be shown in more than one way. The
**View** switch in the toolbar (List, Board, Calendar) changes only the layout:
the records, your filters and your permissions stay the same. The choice is in
the address (`?view=board`), so you can share it, and your browser remembers it
for each list.

**Board.** Defects are grouped by status, test runs by In progress, Paused and
Finished, and test cases by their latest execution result. Each column shows its
total and the first 20 cards; **Load more** adds 20 more, so a big project never
loads at once. A card shows the ID, title, severity or priority, assignee and
due date where there is one, and opens the record when you click the title.

- **Moving a defect.** Drag its card to another column, or use the **Move to...**
  button on the card (keyboard, touch and screen readers use this; the result is
  announced). Only statuses the workflow allows from the current one are offered,
  and Closed and Reopened need permission to close defects. Moves that need more
  information open the same dialog as **Change status** (a resolution, the
  confirmation that it was verified) or **Start retest**. If the server refuses
  the move you see why and the card stays where it was.
- **Moving a run.** In progress, Paused and Finished map to the run's own
  Pause, Resume, Finish and Reopen actions, available to the people who can use
  them on the run page.
- **Test cases are read-only on a board.** A case's execution status (Pass,
  Fail, Blocked, Skipped, Not Run) comes from its latest result, so it changes
  when you run the case, not by dragging. The review status stays a filter.
- If you cannot change statuses, cards have no drag handle and no Move to menu.

**Calendar (test runs).** A month view of runs (the day each started and the day
it finished), run cases by **due date** (one entry per day and run; red when
overdue) and releases by release date. Click an entry to open the run or the
project's releases. With the keyboard use the arrow keys to move between days,
PageUp and PageDown to change month, and Tab to reach the day's entries;
**Today** returns to the current month and **Overdue only** keeps just the late
run cases. On a phone the month is a list of the days that have something
scheduled. Test runs have no planned dates of their own, so runs appear on the
dates they actually started and finished.

**Saved views** remember the view you were in (List, Board or Calendar) along
with the filters; views saved before this keep working and leave your current
view alone.

### Defects

**Defects** lists the issues found in testing, for every project or, from a
project's **Defects** tab, for that project. Each defect has a generated Bug ID
(`BUG_000001`) that never changes.

Reporting a defect:

1. Choose **New Defect** (on a test case's **Defects** tab it opens with that case
   already linked). The form has six sections you can collapse; fields marked *
   are required and are checked when you leave them. A section with a problem
   shows how many fields to fix, and your entries are kept if saving fails.
   - **Bug Overview**: the Bug ID (read-only, with a copy button), the Project,
     the Title (5 to 255 characters), a Description in Markdown with a Preview
     tab, and the Component / Module.
   - **Reproduction Details**: Preconditions, the **Steps to Reproduce** (the same
     step builder as test cases: numbered by position, reorder by dragging or with
     the Move up / Move down buttons, paste several lines to create a step per
     line), the Expected Result and the Actual Result. Both results can be
     corrected after saving.
   - **Environment & Evidence**: attachments (screenshots, logs: the allowed types
     and the 10 MB limit are checked as you add a file, and files are uploaded when
     you save), the Environment and the Build / Version Found.
   - **Classification**: Severity, Priority and Status. A new defect is New, or
     Assigned once you choose an assignee. When you edit, only the statuses the
     defect may move to are listed. A **Resolution** is asked for only where the
     rules need one, with the reason beside the field.
   - **Ownership & Tracking**: Root Cause and notes, the Reporter and Date Reported
     (set automatically), the Assignee (only if you may assign defects) and the
     Fix Version / Target Milestone (pick a release or type a version).
   - **Traceability**: **Linked Test Cases** (search by Test Case ID or title; each
     link is a chip you can unlink) and **Labels / Tags** (up to 20 labels of 40
     characters, lower-cased).
2. Required on create: Title, Description, at least one step, Expected Result,
   Actual Result, Environment, Severity and Priority. **Create defect** saves;
   **Cancel** asks before discarding entries.

From a failed step in the Execution Console, **Report Defect** opens already filled
from the failure: a title with the Test Case ID, the module, the steps up to and
including the failing one (marked "Failed here"), the expected and actual result,
the environment and the evidence attached to the step. Choose a severity, check
the other fields and save: the defect is linked to the test case and the run case,
and its Bug ID appears in the console's Defects panel. **Link Existing Defect**
attaches a defect that already exists instead of creating another.

The list: the default columns are Bug ID, Title, Module, Severity, Priority, Status,
Reporter, Assignee, Date Reported and Fix Version. **Columns** switches between
**Default**, **All fields** (all 22) and **Custom**, and **Views** saves the filters,
sort and columns together. The tabs group the statuses: **Open** is everything not yet
Closed or Rejected (the number on the sidebar and the dashboard's Open defects), then
Fixed, Retest, Reopened, Deferred (parked, still open) and **Closed** (Closed and
Rejected). **Filters** covers status (several at once), severity, priority, assignee,
reporter, module, labels, linked test case, date range, fix version, environment and
resolution; the search box finds a Bug ID, title, description or label. Click a row for
a quick view, or use its menu: Open, Edit, Assign, Change status, Delete (each only
when your role allows it). **Export** (when you may export) gives Excel or CSV with all
fields or the columns shown, for the filtered set or for the rows you ticked.

A defect's page has the tabs **Details**, **Steps**, **Linked Test Cases** (the latest
execution of each, with the run; link another or unlink), **Retests**, **Comments &
Attachments** and **History** (every change with its old and new value).

Status rules: a defect normally moves New, Assigned, In Progress, Fixed, Retest,
Closed. A Fixed, Retest, Closed or Rejected defect can be Reopened. New, Assigned
and In Progress defects can be Rejected or Deferred, and a Deferred one can go back
to Assigned or New. **Change status** lists only the allowed next statuses and asks for a
**resolution** when one is required: Rejected needs one of Duplicate, Won't Fix,
Cannot Reproduce, By Design or Not Applicable; Closed needs one of those or Fixed (it
defaults to Fixed after a retest); open statuses carry none. Closing needs you to
confirm the defect was verified, and closing or reopening needs the close permission.

Retesting a fix: when a defect is **Fixed**, **Start retest** creates a Retest run with
its linked test cases, assigned to the reporter or a tester you pick, and moves the
defect to Retest. Execute that run as usual. When it has been executed, the defect
shows **Retest passed: Close** (or **Verify**, if you may not close) and **Retest
failed: Reopen**. Nothing is overwritten: each retest is its own run case, listed on
the **Retests** tab, and the earlier failure stays in the history.

Severity, priority and status names are your organization's own sets.

### Tasks (view and update)

A project's **Tasks** tab lists the pieces of work the requirements, test cases and
defects belong to. A task can have sub-tasks; the list shows them indented under
their parent, and you can switch to a flat list or a board. Open a task to see
what is in it and how it is going: progress, requirement coverage, pass rate,
open defects and test runs, then a tab for each. You can change the **status** of
a task assigned to you, from the task page or by moving its card on the board;
you cannot create, edit or delete tasks. A task cannot be completed while one of
its sub-tasks is still open; the message says how many.

### Requirements (view)

Requirements, what the product must do, live inside the **tasks** they belong to:
open a task and choose its **Requirements** tab, or open a test case and follow its
**Linked Requirements** card. As a Tester you read requirements and see their linked
test cases and coverage; use it to understand why a case exists. Creating or
versioning requirements is a Manager task. The **Traceability Matrix** (a button on
the Tasks tab, also under Reports) shows coverage per requirement.

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

**Projects** lists every active project. **New Project** needs only a name.
**Domain** and **Priority** are on the form, and **More details (optional)**
holds the status, manager, dates, budget and region; leave out what you do not
use. **Copy setup from** starts the new project with another project's visible
tabs and module folders, and nothing else. In a project you manage members on the
**Team** tab; builds, releases, suites and plans on **Planning**; and the
project's own details, visible tabs and deletion in **Project settings** (the
gear in the project header). Keep releases, builds and environments current:
defects refer to them. Test runs do not record a build or an environment yet
(environments are maintained under Admin, see "For Admins").

**Archiving.** **Archive Project** in Project settings retires a project without
deleting anything. It becomes read-only and its header says so, it leaves the
project list, project pickers and My Work, and its records stay in reports and
in lists that cover all projects. To find it, choose **Show: Archived projects**
in the Projects filters; **Restore Project** makes it editable again. Only a
project with no test cases, runs, defects, requirements or tasks can be deleted.

**Adding a team.** On a project's **Team** tab, **Add a team** adds everyone
active in that team who is not on the project yet, each with their own role. It
adds the people who are in the team at that moment: changing the team later does
not change the project.

### Tasks and sub-tasks

Use a project's **Tasks** tab to group the work. **New Task** creates a task;
open a task and choose **Add sub-task** to break it down (up to five levels).
Give a task an assignee, a priority, a release and start and due dates. A
sub-task's due date cannot be later than its parent's.

- **Statuses** are your organisation's own (an Admin sets them up, see Task
  Statuses). A task is complete when it is in a status of the "Done" kind, which
  needs every sub-task done first. A finished parent cannot take a new open
  sub-task, and a sub-task of a finished parent cannot be reopened: reopen the
  parent first.
- **Moving** a task: edit it and choose another **Parent task** (or none, for the
  top level). Its sub-tasks move with it. A task cannot be moved under itself or
  under one of its own sub-tasks.
- **Deleting** a task that has sub-tasks asks you to confirm that they go too.
  Requirements and defects that were in a deleted task are kept, without a task.
- **Putting things in a task**: add a requirement on the task's **Requirements**
  tab (it can be moved to another task from the requirement page, which does not
  create a new version), and choose the **Task** when you create or edit a defect. Link test cases on the task's **Test Cases** tab; the
  test cases of its requirements count too.
- The **task page** shows progress (sub-tasks done), requirement coverage, pass
  rate, open defects and test runs for the task and its sub-tasks (clear
  "Include sub-tasks" to see the task alone), with a tab for requirements, test
  cases, defects, runs, discussion and activity. A badge says how it is going:
  *At risk* when a critical defect is open or a linked test case last failed,
  *Needs attention* for overdue work, open defects, blocked cases or requirements
  without a test case, otherwise *On track*.
- The **board** has a column per status. Drag a card, or use its **Move to** menu;
  if a rule stops the move, the reason is shown and the card stays.

### Task reports

The project **Overview** has a **Task progress** widget (add it under Customise if
your layout predates it): tasks done, a bar per status, and overdue, due-in-7-days
and unassigned counts. The **Requirements Traceability Matrix** can be narrowed to
one task, with or without its sub-tasks, and its CSV and Excel downloads follow;
its coverage figure follows the task filter. The **Report
builder** has a **Tasks** source (status, kind of status, level, parent, assignee,
release, dates, overdue, and counts of sub-tasks, requirements, test cases and
defects) and a **Task** field on defects. Search (and the command palette) finds
tasks by title or by their TASK_ id.

### Requirements and coverage

Requirements live in tasks. Open a task, choose its **Requirements** tab and
**New requirement** to add one; it is created in that task. You can also use
**+ New** in the top bar and choose **Requirement**, or **New Requirement** on the
Tasks tab: pick the task, or leave it empty to file the requirement under the
project's **Unassigned requirements** task (see below). Open a requirement to edit it
(each edit is a new version, the earlier wording is kept), move it to another task,
and link the test cases that cover it. The **Traceability Matrix** (the button on the
Tasks tab) shows coverage gaps: requirements with no linked test case yet. If AI
features are enabled you can generate draft test cases from a requirement's text.
The result is always a draft: a person reviews and accepts it before it becomes a
real test case.

**Unassigned requirements.** Every requirement belongs to a task. A requirement
created without one, or whose task is deleted, goes to the project's **Unassigned
requirements** task, marked *Default for requirements* in the Tasks list. It is a
holding place: open each requirement in it and move it to the task it belongs to. That
task cannot be deleted or moved and takes no sub-tasks; you can still give it an
assignee and dates.

### Planning and assigning runs

1. In **Test Runs** choose **New test run**, pick the project, name the run, and
   choose the cases (tick **Skip quarantined cases** to leave out flaky ones). A
   run does not record a build or an environment, so name it so that people can
   tell what was tested.
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
5. Give a run case a **due date**: set one for the whole run when you create
   it (**Due date (optional)**), or change it per case in the **Due** column of
   the run page (changing the date leaves the assignee alone; clear the field to
   remove it). A case that is still Pending or In Progress after its date is
   **overdue**: it shows an Overdue badge, in **My Work** and the Execution
   Console, and in the project Overview's **Overdue test cases** widget.

### Test case management

From the Test Cases list, tick rows (up to 100) and use the bar to **bulk edit**:
assign, change priority, move to a module or quarantine. **Import** takes Excel or
CSV through a wizard that checks the file first (see *Importing and exporting* below).
**Export** offers Excel or CSV with all 22 fields or only the
columns you selected, for the rows matching the current filters. A case's
**Review Status** (Draft, Ready for Review, Approved, Deprecated) is where you
approve or send changes back; its **Execution Status** only reflects the latest
run. Save a column set together with your filters as a **view** from the Views
menu to reuse it. You can submit cases for review where your workflow requires
it.

**Quarantine** a flaky test from its page or from the Flaky Tests card, giving a
reason. A Quarantined badge shows on the case. Quarantine never deletes
anything: history and verdicts in existing runs still count, and release
readiness and the leakage card always show the quarantined count separately, so
a quarantined case cannot hide a failure. Use **Remove quarantine** when it is
stable again.

#### Importing and exporting test cases and defects

Both the **Test Cases** and the **Defects** list have an import wizard (**More actions**,
then **Import test cases** or **Import defects**) and an **Export** menu. Importing needs
the permission to create (or import) test cases or defects; Testers can import into the
projects they are assigned to.

1. **Choose the file.** Download the Excel or CSV template first. It has all 22 fields
   with the same headers as the list, an example row, an Instructions sheet and dropdown
   lists of the allowed values (amber headers are mandatory). Fill one row per test case or
   defect and upload the file as `.xlsx` or `.csv` (up to 10 MB and 20,000 rows; formulas
   and macros are not accepted). On the defect list pick the project first.
2. **Write the steps in one cell**, one step per line, as
   `1. Open the page | url=/login | The page opens`: action, test data and expected result
   separated by bars (keep the bars when a part is empty). The Module column is a path such
   as `Claims/Total Loss/Settlement`; missing modules are created. Leave the ID column empty
   to get the next ids; an id such as `TC_000250` is kept when it is not used yet.
3. **Review.** The wizard checks every row without importing anything and shows how many
   rows are valid, have warnings or have errors, each problem with the row number and the
   column, the modules that would be created and, with **Show errors and warnings only**,
   just the rows that need attention. **Download error report (CSV)** gives the list to
   fix the file with. Warnings (a title that already exists, an id that is already used and
   will be replaced by a new one) never block the import.
4. **Confirm.** Choose **All or nothing** (the default: nothing is imported unless every
   row is valid) or **Skip invalid rows** (the valid rows are imported). Large files (more
   than 2,000 rows) are imported in the background and the wizard shows the progress. The
   result lists the counts and the skipped rows, and **View imported** opens the list.

Defect imports follow the status rules: any status is accepted when its resolution fits
(Fixed, Rejected and Closed need one), the reporter is you and the date is the import time.
Linked test cases are given by their ids (`TC_000012; TC_000013`) and must exist in the
project. Assignees are given by email and must be project members; assigning needs the
assign permission, and importing a defect as Closed or Rejected needs the close permission.

The last column, **Task**, is optional. Give a defect the id of one task in the project
(`TASK_000012`). A test case can be linked to several (`TASK_000012; TASK_000013`), which
needs the permission to manage tasks. An id that is not a task of the chosen project makes
the row an error, so clear or replace the column when you move a file between projects.
The older column-mapping import does not read this column.

**Export** offers Excel or CSV with all fields, the columns shown in the list, or only the
rows you selected. The exported file uses the template's headers, so it can be imported
again as it is (the columns that only describe results, such as Execution Status or
Reporter, are ignored on import). An export holds at most 50,000 rows; narrow the filters if
you see the "truncated" notice.

### Defect triage

On **Defects**, review new defects (the **Open** tab, or tick several statuses in
**Filters**), set severity and priority, assign them, change their status and close
them. **Assign** and **Change status** are in each row's menu and on the defect's
page; a New defect can be set to Assigned in the same step. Moving a defect to
Rejected or Closed asks for a resolution, and closing needs the verification
confirmation. Reopening and closing need the close permission, which Managers and
Admins have; you can also confirm a retest result with **Retest passed: Close** or
reopen the defect with **Retest failed: Reopen**. A defect you reported being
closed notifies the reporter, and assigning or reopening one notifies the assignee.
Use saved **Views** (for example "Open and critical", with the columns you want)
to keep a triage list one click away, and **Export** to hand a filtered list, or
only the rows you ticked, to someone else as Excel or CSV. Deleting a defect hides
it from lists and reports; its history is kept.

### Reports

**Reports** has the tabs **Overview**, **Compliance** and **Report builder**.
Overview holds dashboards and exportable reports: execution summaries, defect
trends and aging, requirement coverage, release readiness and workload. **Release
readiness always covers the whole project, not one release**: it cannot yet tell
which runs, test cases or defects belong to a release, so do not read it as one
release's result. Filter by project and date. The **Defect Leakage & Test Effectiveness** card shows how many
defects reached users. A defect has *escaped* when it is linked to a release
whose release date has passed, or when its environment is named Production or
Prod. *Leakage* is escaped defects divided by all defects, and *detection
effectiveness* is the rest; both read "No defects" when there is nothing to
measure. The card lists open escaped defects by age and severity, a per-release
table and a monthly trend, and exports to Excel.

**Compliance** (a tab of **Reports**) opens print-ready
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

### Project Overview dashboard

Every project opens on its own **Overview**. It shows **this project only**; the
Dashboard at the top of the sidebar is the separate page for **all projects**
(use **See all projects** on the Overview to go there).

The row of **Key numbers** shows Total test cases, Executed, Passed, Failed,
Blocked, Not run, Open defects and Critical defects. Each tile opens the list it
counts (for example **Failed** opens the project's test cases filtered to a
failed latest result), and the number on the tile equals the total shown there.
A tile shows a change against 30 days ago only for the figures that have real
history (total test cases and open defects). A test case counts by its **latest
executed result**; a case that has never been executed is Not run, and deleted
test cases are not counted. The progress bar in the project header shows the
same executed share and pass rate.

Below it are the widgets: Pass / fail distribution, Test execution trend, Defect
severity, Module-wise coverage, Requirement traceability, Tester performance,
Tester workload, Upcoming milestones, Release readiness, My pending activities,
Overdue test cases, Recent activity and Recently reported defects. Each has a
**View** link to the records behind it, a table view and a CSV download on the
charts, and its own Retry if it cannot load. A widget your role may not see (for
example the Tester comparisons when Reports are hidden from Testers) says so
instead of showing numbers. If you are a Tester whose workspace limits you to
your assigned test cases, every figure counts only those cases.

**Customise** (top right of the Overview) lets you choose which widgets show and
their order: tick or untick a widget and use the arrow buttons to move it (sizes
are fixed). **Save** keeps the layout for you only, in this project;
**Reset to default** returns to the project default, or to the built-in layout
when there is none. People who can edit the project (an Admin, or a Manager
assigned to it) also see **Save as project default** and **Remove project
default**: the default is what everyone sees until they save their own layout.
Hiding every widget is allowed.

**Upcoming milestones** lists dated releases that are Planned, In Progress or
have no status yet, and the next due date of each open run. **Overdue test
cases** lists run cases past their due date and not yet executed; **View** opens
the Execution Console narrowed to this project and to overdue cases.

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

### Task Statuses

**Task Statuses** (under Admin) lists the statuses tasks and sub-tasks move
through. Rename a status, give it a colour, or add your own with **New Status**.
Every status belongs to one of three kinds that the product relies on: *To do*,
*In progress* or *Done*. A task counts as finished only in a *Done* status, which
is also what progress and "overdue" are measured against. Rules:

- exactly one status is the **default** for new tasks, and it is a *To do* status;
- there is always at least one *To do* and one *Done* status;
- a status that tasks use (even deleted ones) cannot be deleted and keeps its
  kind; move the tasks to another status first.

The people who may create and edit tasks, change a task's status, and edit these
statuses are set under **Roles & Permissions** (Tasks: manage, change status,
manage statuses). A release freeze can include task changes: choose the action
`task` when you create the freeze.

### Settings

**Settings** has these tabs:

- **General**: organization-wide configuration.
- **Branding**: the look of your workspace.
- **Fields**: the organization's own option sets and fields: defect severities
  and priorities, test case priorities, defect and test case status labels (a
  defect has eleven statuses; their workflow and resolution rules are fixed, only
  the names you show are yours), and custom fields for test cases, defects and
  requirements. Users see these automatically on the matching screens. The
  permissions that control defects are Create, Edit, Assign, Change status,
  Close, Delete and Export (under **Access Control**); the built-in Tester role
  cannot assign, close or export.
- **Security & SSO**: single sign-on and sign-in requirements such as MFA.
- **Teams** (Admin > Teams): named groups, with an optional lead, that can be
  added to a project in one step. A team gives no access by itself.
- **Project domains** (in Settings): the choices for a project's Domain, one per
  line. Until you change it, it is the built-in insurance list. Leave it empty if
  you do not use domains. Projects keep a domain you remove.
- **Integrations**: SCIM and service tokens for connecting other systems.
- **Data**: **Tester visibility** (limit Testers to assigned cases, hide Reports
  from Testers), AI features, your subscription and seat usage, data export and
  scheduled reports. The data export is a zip of your organization's records,
  including settings and the audit log. It leaves out passwords, keys and sign-in
  tokens, and lists attachments without the files themselves.

### Workspace

**Workspace** (Admin > Workspace, needs the Settings permission) sets the defaults
for how everyone in your organization sees the application. It has three parts
and one **Save changes** button. Hiding only removes something from a menu: the
page still opens from a direct link, and nobody gains or loses access to any
data. People who may not open an area never see it, whatever you choose here.

- **Sidebar**: the entries of the left sidebar, the phone menu and the command
  palette. Untick **Show** to hide an entry (Test Cases, Test Runs, Defects,
  Reports) and use the up and down buttons to put them in
  order. Dashboard, Projects, My Work and Admin are always shown. Each person
  keeps their own favourites and recent items.
- **Project tabs**: the default tabs of a project (Tasks, Planning and Team can
  be hidden; Overview, Test Cases, Test Runs, Defects and Reports are always
  there), and their order. A project that was given its own tabs in Project
  settings keeps them; every other project follows this default.
- **List views**: whether the Board (Defects, Test cases, Test runs) and the
  Calendar (Test runs) are offered. The list view is always available; a list
  with only the list view shows no view switch.

**Reset to defaults** brings back every entry, tab and view in the original
order (projects with their own tabs keep them). Every change is recorded in the
Audit Logs.

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
