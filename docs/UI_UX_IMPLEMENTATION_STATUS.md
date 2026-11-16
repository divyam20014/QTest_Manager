# QTestHub UI/UX Implementation Status

Live tracker for the UI/UX programme. Update after every phase.

**Decisions on record:** keep and formalise the tactile identity (not a flat redesign); proceed phase by phase with approval between phases. Last updated 2026-11-16 (Phase F).

## Phases

| Phase | Scope | Status |
|---|---|---|
| A | Discovery and audit | **Done** — `UI_UX_AUDIT_REPORT.md`, `UI_UX_REMEDIATION_PLAN.md` |
| B | Design system and reusable components | **Done** — `DESIGN_SYSTEM.md`, tokens, components, guard tests |
| C | Application shell and page structure | **Done** — see "Phase C — what was built" |
| D | Dashboard | **Done** — see "Phase D — what was built" |
| E | Module-by-module modernisation | **Done** — see "Phase E — what was built" |
| F | Forms, tables, dialogs, interactions | **Done** — see "Phase F — what was built" |
| G | Responsive, accessibility, performance | Not started |
| H | Regression and final verification | Not started |

## Issues

29 logged (0 Critical, 4 High, 13 Medium, 12 Low). 23 fixed (2 in Phase B, 8 in Phase C, 1 in Phase D, 6 in Phase E, 6 in Phase F), 4 partially addressed, 2 open (UX-007 bundle size and UX-028 font decision, both Phase G). Full table in the audit report.

| ID | Sev | Short name | Status | Phase |
|---|---|---|---|---|
| UX-001 | High | Tablet header overflow (768–899px) | **Fixed** (Phase C) | C |
| UX-002 | High | ~21 destructive actions without confirmation | **Fixed** (Phase E: 26 actions behind `useConfirm`; Delete Project needs the name typed) | E |
| UX-003 | High | Repository truncates at 100 cases per project | **Fixed** (Phase E: 50 per project, "Load more" with the real total; a failed project shows an error instead of vanishing) | E |
| UX-004 | High | Execution "Pass" button contrast 3.49 : 1 | **Fixed** (Phase E: `success` button variant, 5.48 : 1 light; dark text on light green in dark mode; axe clean) | E |
| UX-005 | Medium | Destructive button contrast in dark mode | **Fixed** (Button in Phase B; NotificationBell badge in Phase E) | B / E |
| UX-006 | Medium | Account menu label mismatch | **Fixed** (Phase C) | C |
| UX-007 | Medium | Single 1.29 MB bundle | Open | G |
| UX-008 | Medium | Repository renders every row | **Partial** (Phase E: DOM bounded by what has been loaded, 50 per project to start; still one request per project and no virtualisation) | E |
| UX-009 | Medium | Toasts overlap mobile tab bar | **Fixed** (Phase C) | C |
| UX-010 | Medium | Hand-built page headers | **Fixed** (Phase C; 3 deliberate exceptions) | C |
| UX-011 | Medium | 14 status-tone maps | **Fixed** (Phase E: shared `lib/statusTones.ts` for the level scale, run-case status and verdict; state badges use `StatusBadge`) | E |
| UX-012 | Medium | 96 hard-coded colours | **Fixed** (Phase E: 0 left in 5 files; 2 deliberate remain: the brand-colour input default in Settings and the print stylesheet) | D / E |
| UX-013 | Medium | Control height mix | **Partial** (Phase F: the 28px inputs are gone (row selects are 32px), link-buttons use `buttonVariants`, the `h-6` Save/Cancel buttons are standard `sm`. Measured at 1280: buttons 32px ×363, 36px ×14, 38px ×6, 30px ×5, plus 16–24px inline text buttons — not fully unified; I did not hunt every one-off) | F |
| UX-014 | Medium | Missing error/loading states | **Fixed** for the screens audited (detail pages, Audit Logs, Execution Overview, Repository, Settings cards); list pages elsewhere unchanged | E |
| UX-015 | Medium | Unlabeled data tables | **Fixed** (Phase F: `ResponsiveTable` names its `<table>`; Audit Logs, both Roles tables and Requirement Detail named; 12 of 12 desktop tables named in the sweep) | F |
| UX-016 | Medium | Three pagination patterns | **Partial** ("Load more" on Repository and Audit Logs; numbered pages elsewhere; Defects now pages on the client, 50 per page (the API still returns every defect); Runs overview still unpaged) | E / F |
| UX-017 | Medium | Small inner links on phone cards | **Fixed** (Phase F: links and buttons inside a card are 44px and sit above the stretched title link; traceability count links and the Dashboard range buttons too. The Dashboard KPI tile title links are 19px but stretched over the whole tile, so the tile is the target) | F |
| UX-018 | Low | Toast accessibility | **Fixed** (Phase C) | C |
| UX-019 | Low | Radius mix | **Fixed** (Phase F: bare `rounded` / `rounded-sm` → scale; guard test keeps it at 0) | F |
| UX-020 | Low | Type-size mix, 10px text | **Fixed** (Phase F: all `text-[10px]` → 11px; guard test keeps it at 0. Other sizes already map onto the scale's utilities) | F |
| UX-021 | Low | Two button systems | **Partial** (Phase F: six hand-styled link-buttons → `buttonVariants()`; the AI assistant suggestion chips and the shell's "Jump to…" hint are deliberately custom) | F |
| UX-022 | Low | Placeholder-only inputs | **Fixed** (Phase F: 14 inputs now have accessible names; unlabeled fields 5 → 0 in the sweep. Also found a real bug: custom-field inputs were never linked to their labels) | F |
| UX-023 | Low | Heading level skips | **Fixed** (Phase C) | C |
| UX-024 | Low | Sidebar duplicates | **Fixed** (Phase C) | C |
| UX-025 | Low | Compliance print outside shell | **Fixed** (Phase C: opens in a new tab) | C |
| UX-026 | Low | Dashboard KPI empty space | **Fixed** (Phase D) | D |
| UX-027 | Low | Native `title` tooltips | **Fixed** (Phase F: the 8 native-element `title=` attributes are gone — Tooltip, an accessible name, or removed where the text was already visible) | F |
| UX-028 | Low | App vs marketing font | Open (decision) | G |
| UX-029 | Low | Duplicated dark tokens | **Fixed** (guarded) | B |

## Phase F — what was built

**Form standard.** New `FormField` / `FormError` (`components/ui/form-field.tsx`): label (shared required marker), control, helper text and the error under it, wired with `id`, `aria-invalid` and `aria-describedby`; errors are `role="alert"`. Adopted on the Project form and the Test Case form. This surfaced a real defect: the Project form validated Manager name, Start date, Budget and Region but only ever showed the message for Name and End date, so a bad submit failed silently. All errors now show. Test-case step rows now show a message when an action or expected outcome is empty. Invalid inputs get a red border (`aria-invalid` styling on `Input`, `Select`, `Textarea`). `FormError` replaced 42 hand-written `<p class="text-xs text-destructive">` server-error lines across 23 files (now announced by screen readers); `noValidate` on the two zod forms.

**Unsaved-changes guard.** `Dialog` and `Drawer` ask "Discard unsaved changes?" when closed by Escape, the backdrop or the X while a form inside reports dirty edits (`useReportDirty` in `components/ui/dirtyForm.ts`, used by the Project and Test Case forms). Closing from the parent after a save is unaffected. Other forms in dialogs (not react-hook-form) are not guarded yet.

**Tables.** `ResponsiveTable` passes `label` to the `<table>`; long tables (more than 25 rows) scroll inside a 70svh region (focusable, labelled) so the sticky header actually sticks. Defects pages on the client, 50 per page, with the existing `Pagination` footer; the page resets when a filter changes. Phone cards: `.qth-card` makes inner links and buttons 44px and lifts them above the stretched title link; the title link is 44px tall.

**Controls and buttons.** Six hand-styled link-buttons (Audit Logs and Test Cases "Export CSV", Reports ×3, Traceability, Compliance print) now use `buttonVariants()`. The two 28px row selects are 32px; Roles Save/Cancel lost their `h-6` override; the Dashboard dismiss button is 32px (44px on phones).

**Labels and tooltips.** 14 inputs that relied on a placeholder or an unlinked `<label>` got accessible names (build, release, suite, plan and data-set names, data-row fields, AI question, saved-view name, import preset and column mapping, custom fields). The 8 native `title=` attributes became `Tooltip` (theme toggle, Audit Logs action code, disabled self-deactivate), an accessible name (unsaved-changes dot) or were removed. `Tooltip` renders only its trigger when it has no content, and its bubble is `visibility: hidden` until hover/focus so it is not in the accessibility tree.

**Scales.** All bare `rounded` / `rounded-sm` (37 lines) moved onto the radius scale (bordered containers `rounded-lg`, controls and menu items `rounded-md`), and all `text-[10px]` became 11px. `designSystem.test.ts` now fails if either returns.

**Border colour layer (found on the way).** `* { border-color: var(--border) }` in `index.css` was unlayered, so it beat every Tailwind border-colour utility: `border-[var(--ring)]`, `border-[var(--primary)]`, `border-[var(--brand)]` and the new invalid-field red all silently did nothing. It now sits in `@layer base`. Visible effect: the current step in the Execution Console, selected cards and selected options now show their intended coloured border. A before/after screenshot comparison of 230 sweep images showed no other layout change (differences were live data on Audit Logs and Account).

### Files created (Phase F)

`frontend/src/components/ui/form-field.tsx`, `frontend/src/components/ui/dirtyForm.ts`, `frontend/e2e/forms-phase-f.spec.ts`.

### Files modified (Phase F)

Core: `components/ui/dialog.tsx`, `input.tsx`, `select.tsx`, `textarea.tsx`, `tooltip.tsx`, `ChartPanel.tsx`, `components/table/ResponsiveTable.tsx`, `index.css`, `test/designSystem.test.ts`. Forms: `routes/projects/ProjectForm.tsx`, `routes/testcases/TestCaseForm.tsx`. Screens and components touched by the sweeps (labels, tooltips, link-buttons, radius, `FormError`): about 45 files under `routes/` and `components/` (Audit Logs, Reports, Traceability, Test Cases list, Defects list, Roles & Permissions, Users, Platform Admin, Project Detail, Import dialog, Test Data Sets, Custom Fields, Saved Filters, Theme toggle, AI Assistant, Dashboard, Login, Signup and others). Docs: this file, `DESIGN_SYSTEM.md`, `UI_UX_AUDIT_REPORT.md`, `UI_UX_REMEDIATION_PLAN.md`.

## Verification — Phase F

- Typecheck clean; lint 7 warnings (the same 7 as before; moving `useReportDirty` into its own file avoided an eighth); unit tests 10/10 (one new: radius and type scale); production build passes (main JS 1,318 KB vs 1,294 KB before).
- E2E, one Playwright process at a time: accessibility 4/4, smoke 6/6, mobile-shell, mobile-components, mobile-screens (2), shell-phase-c 3/3, modules-phase-e 3/3, forms-phase-f 4/4 (new), journeys 1–4, tier3-features, reliability. `dashboard-phase-d` failed 2 of 3 in the full chain (the run reported 2.0 hours, so the machine stalled) and passed 3/3 when run alone straight after.
- Sweep (Meridian demo tenant, Admin): 23 routes × 9 widths × light and dark = 414 loads, run twice (before and after the border-layer fix). Overflow 0, console and HTTP errors 0, unlabeled fields 0 (was 5), icon buttons without a name 0, heading skips 0, desktop tables unnamed 0 of 12, font under 16px on phones 0. axe (WCAG 2.0/2.1 A + AA): 92 of 92 scans clean (it was 74 of 92 after Phase C; the Execution Console contrast finding was fixed in Phase E). Small tap targets under 768px: only the visually hidden skip link on every route, and four Dashboard KPI title links that are stretched over the whole tile.
- Screenshots viewed: Project form with errors (390 light, 1280 dark), the discard prompt (1280 dark), Audit Logs and Execution Console (1280 light, after the border fix). The rest were compared by pixel difference (230 images) or measured.

## Not verified / limitations (Phase F)

- Only the Admin role was driven; Manager and Tester screens were not re-checked. No real device, touch or screen reader.
- The discard prompt is tested for the Project dialog only; the Test Case drawer uses the same hook but has no e2e test. The prompt has no focus trap of its own beyond the dialog's (Tab can reach the form behind it).
- Control heights are not fully unified (UX-013): the measured mix is above. `FormField` is on 2 of the roughly 15 forms; the rest only got `FormError` and labels.
- The nested-scroll table (more than 25 rows) was not viewed with a long list (the demo data has no table that long); it is covered by typecheck only.
- Defects paging is client-side; the API still sends every defect. Runs overview is still unpaged.
- The border-layer fix changes colours app-wide (intended borders now show). I compared 230 screenshots and looked at two, not all.

## Dev data changes (Phase F)

No code-side schema, backend or auth changes. The e2e runs created more throwaway tenants named "PhaseF …". Sweeps only read the Meridian demo tenant (each sign-in adds audit-log entries). An Execution Console timer on step 1 of one pending demo case, started in an earlier phase, is still running (it shows as elapsed time in screenshots).

## Phase E — what was built

**Destructive actions (UX-002).** New `useConfirm()` hook (`components/ui/useConfirm.tsx`, wrapping `ConfirmDialog`): a button calls `ask({ title, description, confirmLabel, run })` and the page renders `dialog` once. `run` returns the mutation promise, so the dialog stays open with the confirm button disabled until it settles (no double submit) and a failure leaves the user in place with the mutation's own toast. 26 actions are behind it: delete project (the project name must be typed), remove project member, delete test case (Repository row, bulk, context menu, detail), deprecate test case (Repository, bulk advance when it includes approved cases, detail), delete requirement, delete suite, plan, build, release, delete module, delete shared step, delete data set and data row, delete comment, remove case from run, finish run (not destructive-styled), remove environment, deactivate user, deactivate role, remove custom field and field option, revoke SCIM token, revoke CI token, delete scheduled report. Each says what is lost and whether it can be undone. Missing failure toasts were added for suites, plans, modules, data sets and rows. Already confirmed before this phase: attachments and session revoke. Deliberately not confirmed: unlinking a test case from a requirement (re-linkable), Pause/Resume a run, Submit/Approve (reversible lifecycle steps).

**Stacked overlays.** A confirmation opened from inside a dialog used to share one global key handler with the dialog below it (Escape closed both; the lower focus trap pulled focus out of the confirmation). `useOverlayBehavior` now keeps a stack and only the topmost overlay handles Escape and Tab.

**Execution Console (UX-004).** `Button` gained a `success` variant using new `--success-solid` / `--success-solid-foreground` tokens (white on #047857 = 5.48 : 1; dark mode is dark text on the light green). The two hard-coded `bg-emerald-600` Pass buttons use it. Also fixed: the P / F / I shortcuts fired while typing in the comment box in the right panel (typing "pass" recorded verdicts); they now ignore text fields and modifier keys. After the last step of a case, the console shows "All N steps recorded" with a "Next case: …" button (the next pending or in-progress case in the run) or "Back to the run", pinned above the tab bar on phones.

**Test Repository (UX-003, UX-008).** Each project loads 50 cases; the footer reads "50 test cases shown of 120 matching" with "Load more (70 remaining)", which fetches the next page for every project that has more. Extra pages reset when filters change or after a delete or status change; stale responses are discarded. A project whose request fails now shows an error with a retry instead of silently disappearing from the list.

**Reports (UX-012).** `Reporting.tsx` has no hard-coded colours (was 66): chart chrome uses the `--chart-*` tokens and tooltips match the Dashboard's. Charts now follow the in-app light/dark toggle instead of the OS setting. Execution Trends and Defect Trend are `ChartPanel`s with "View as table" and a screen-reader summary; the Aggregate Report has its own "View as table". Audit Logs, Test Case Detail and Execution Console colours were migrated to `--status-*` tokens too.

**Status display (UX-011).** `lib/statusTones.ts` holds the level scale (Low / Medium / High / Critical, used for both priority and severity), run-case status and step verdict; the old copies in Dashboard, Execution Console, Execution Overview, Test Run Detail and the three `statusDisplay.ts` files now delegate to it. This also removes one real inconsistency: the Dashboard painted a High-severity defect red and every list painted it amber (High now reads amber everywhere). State badges (defect status and severity, project status and priority, run-case status, verdict, test case status and priority) use `StatusBadge`, so each carries an icon as well as a colour.

**States (UX-014).** `DetailSkeleton` replaces "Loading…" on the five detail screens; a failed load shows `ErrorState` with a retry and a missing record shows `EmptyState`. Audit Logs and Execution Overview gained loading, error and empty states (Execution Overview previously showed "Nothing in progress" even when requests had failed). Remaining "Loading…" text in Settings, the QA Manager card and the console became skeletons.

**Roles & Permissions.** The matrix gained a "Filter permissions" box, Expand all / Collapse all, and "No permissions match" feedback. A group's All / None buttons still act on the whole group, never on the filtered rows. Permission logic is untouched.

**Forms.** `Label` takes `required`, which renders the one standard marker (a red asterisk plus "(required)" for screen readers). Project and test-case forms and the Repository create drawer use it in place of hand-rolled asterisks. Submit buttons were already disabled while pending and forms already kept their input on a failed save, so no change was needed there.

### Files created (Phase E)
`frontend/src/components/ui/useConfirm.tsx`, `frontend/src/lib/statusTones.ts`, `frontend/e2e/modules-phase-e.spec.ts`.

### Files modified (Phase E)
`components/ui/{button,label,skeleton,useOverlayBehavior,confirm-dialog}`, `components/{CommentsCard,TestDataSetsCard,NotificationBell}.tsx`, `index.css`, `test/designSystem.test.ts` (ratchet lowered), and under `routes/`: `Dashboard`, `admin/{AuditLogs,Environments,RolesPermissions,Settings,UsersRoles}`, `defects/{DefectDetail,DefectsList,statusDisplay}`, `execution/{ExecutionConsole,ExecutionOverview,TestRunDetail}`, `projects/{ProjectDetail,ProjectForm,ProjectsList,statusDisplay}`, `reporting/{QAManagerIntelligenceCard,Reporting}`, `requirements/RequirementDetail`, `testcases/{SharedStepsDialog,TestCaseDetail,TestCaseForm,TestCasesList,statusDisplay}`, `testrepository/TestRepository`; `e2e/journey4-defect-lifecycle.spec.ts` (unique tester address per run).

## Verification — Phase E

| Check | Result |
|---|---|
| TypeScript, lint, unit tests, production build | Clean; 7 lint warnings, all pre-existing (a new one from the first version of `useConfirm` was fixed by moving it to its own file); unit 9 / 9; build via `docker compose up --build -d web` |
| e2e (one worker, one spec at a time) | 28 / 28 pass: accessibility x4, smoke x6, mobile-shell, mobile-components, mobile-screens x2, shell-phase-c x3, dashboard-phase-d x3, modules-phase-e x3 (new), journey1 x2, journey2, journey3, journey4 x2 (after the fix below), tier3-features, reliability |
| New e2e coverage | Delete Project needs the name typed, Escape cancels and the project stays, then a real delete; Environment remove asks first (cancel keeps it, confirm removes); Repository with a mocked 120-case project: "50 shown of 120 matching", Load more to 100, then to 120, button gone |
| Accessibility | axe spec passes including the Execution Console (Pass contrast was the open finding) |
| Viewed screenshots | Delete Project confirmation (1280 light, 390 dark); Reporting 1280 dark (full page, charts settled); Roles & Permissions 1280 light; Repository 390 light; Audit Logs 390 light; Environments 390 light; Execution Console 390 dark (Pass / Fail / Ignore bar). Measured but not viewed: the rest of the 28 captures (1280 and 390, light and dark) |

## Not verified / limitations (Phase E)

- Real devices, touch, screen readers, and Manager / Tester screens were not driven (Admin only this phase).
- Of the 26 confirmations, three are covered by e2e (project, environment, Repository flows); the other 23 were verified by typecheck and by the shared hook, not exercised one by one. The nested case (confirmation opened from inside the Manage Modules or Shared Steps dialog) was not exercised in a browser.
- The "next case" button and the shortcut guard were not covered by an e2e test (the shortcut change needs a run with a comment box open).
- A first screenshot of Reporting caught the bar chart mid-animation (empty bars); a recapture after 5 s showed it correctly. Repository at 390 dark was still on skeletons at 1.8 s on this loaded machine; the settled view was checked in light only.
- Load more makes one extra request per project that still has cases; a cross-project endpoint (backend) would replace this. The project list itself still asks for at most 100 projects.
- Defects list, Runs overview and Requirements are unchanged for pagination (UX-016 partial). Forms: only the label standard was applied; field heights, placeholder-only inputs and tooltips are Phase F.
- Roles & Permissions: no change to what an Admin can do; the matrix improvements were not tested with a custom role that has unsaved edits while filtering.

## Dev data changes (Phase E)

- The e2e runs created more throwaway tenants ("PhaseE" x3 and the usual journey tenants).
- Four stale "J4TesterGate" throwaway tenants were set to **suspended** (reversible; the platform API has no delete) while diagnosing `journey4`. Their shared fixed tester address was the cause of the failure; the spec now uses a per-run address, so no tenant needed deleting. They still appear in the sign-in organisation picker for tester@example.com but no test uses that address any more.
- Opening an Execution Console on the Meridian demo tenant (for a screenshot) started the server-side timer on step 1 of one pending case ("Agent can submit FNOL on behalf of a policyholder"). No verdict was recorded.
- No schema, migration, backend or authentication change.

## Phase D — what was built

**Layout.** The pass-rate dial is the hero (two columns by two rows from 1024px, full width below) followed by four KPI tiles: Projects, Test Cases, Active Test Runs, Open Defects. The old seven tiles were reduced to four so nothing is half-empty (UX-026); the numbers that disappeared as tiles are kept as **second links** inside their tile: "N active" (to Projects, Active), "N approved" (to Repository, approved), "N critical" (to Defects, Critical). Each tile has one stretched primary link (its title) plus the optional second link; there are no nested anchors. Open Defects severity detail is now ordered Critical, High, Medium, Low (it was alphabetical). The dial caption states the real count ("923 of 971 executed steps passed").

**Charts.** New `ChartPanel` (title, header actions, "View as table" / "View as chart" toggle, screen-reader summary, fixed-height body so nothing shifts), `ChartLegend` (HTML legend with the value beside each label) and `RangeControl` (7d / 30d / 90d, `aria-pressed` buttons) in `components/ui/ChartPanel.tsx`; `GaugeDial` gained `size="lg"`. Execution Trend now has a real 7/30/90-day filter using the existing `days` parameter (the API allows up to 180); the Pass/Fail totals for the window are shown beside the legend and the x-axis uses short dates. Test Case Status shows the total in the donut centre and `count · percent` per status. All chart chrome (grid, axes, cursor) comes from the `--chart-*` tokens, so the 8 hard-coded colours in `Dashboard.tsx` are gone (ratchet entry removed). Status colours are now fixed per lifecycle state (draft, ready for review, approved, deprecated), never by rank in the current data.

**Real bug fixed.** The charts picked their palette from the OS dark-mode setting, not the app's light/dark toggle, so with the toggle on dark and the OS on light they drew the light palette, bright grid lines and dim axis text on a dark card. The Dashboard now reads `useThemePreference()`. (`Reporting.tsx` still uses the OS setting; that is part of its Phase E colour migration.)

**Recent Activity.** Relative time ("10 hours ago", full date on hover via `<time>`), the entity type as a small badge instead of "(Defect)" appended to every sentence, and the first 8 of N rows with "Show all N".

**States.** Loading skeletons mirror the new layout; each card has its own error state with a retry; empty states for no test cases, no execution activity, no urgent defects and no activity; the Needs Attention list says "Showing 6 of 15" when it is truncated. The dashboard queries retry once instead of three times, so a failing API shows the error state in about 2 seconds instead of about 7.

**Files.** `frontend/src/routes/Dashboard.tsx`, `frontend/src/components/ui/ChartPanel.tsx` (new), `frontend/src/components/ui/GaugeDial.tsx`, `frontend/src/test/designSystem.test.ts` (ratchet entry removed), `frontend/e2e/dashboard-phase-d.spec.ts` (new).

## Verification — Phase D

| Check | Result |
|---|---|
| TypeScript, lint, unit tests, production build | Clean; 7 lint warnings, all pre-existing; unit 9 / 9; build via `docker compose up --build -d web` |
| e2e (one worker) | 22 / 22 pass: dashboard-phase-d x3 (new), accessibility x4, smoke x6, shell-phase-c x3, mobile-shell, mobile-components, mobile-screens x2, journey1 x2 |
| New e2e coverage | Real empty tenant (every empty state, no overflow at 1280/768/390, tile links, keyboard Enter on a tile link); API 500 then retry recovers; trend range re-queries with `days=7`; "View as table" shows N+1 rows; with the in-app toggle on dark and the OS on light the Pass line is the dark palette (`#199e70`) |
| Overflow | Meridian demo data at 9 widths (1920 to 375) x light and dark: 0 with horizontal overflow, 0 console errors; the empty and simulated-error states at 1440, 768 and 390 in both themes: 0 |
| Viewed screenshots | Demo: 1440 dark (before and after), 1920 light, 1440 light, 768 light, 390 dark and light; charts as element shots at 1280, 768, 390 and 375 in both themes; empty at 1440 light and 390 dark; error at 1440 dark and 390 light |

## Not verified / limitations (Phase D)

- `fullPage` screenshots can catch a donut or line chart mid-animation or not yet drawn at tablet and phone widths (Playwright resizes the page, so Recharts re-measures). Element screenshots at the same widths show the charts complete, and the e2e test asserts the line is rendered, so this is treated as a capture artefact; it was not checked on a real device.
- Only the Admin role was driven. Real devices, touch and screen readers were not tested. Keyboard access to the chart points rests on Recharts' built-in keyboard layer plus the "View as table" alternative; neither was tested with a screen reader.
- No pixel diff against the old layout was run, because the layout deliberately changed.
- The Dashboard has no project filter: only the trend endpoint accepts a project, the summary does not, so a project filter would show inconsistent numbers. It would need a backend change (not made).
- Only the Dashboard's colours were migrated; Reporting (66 colours), Audit Logs (12) and the others are unchanged.
- The e2e error-state test relies on a 15-second timeout; the live error state appears in about 2 seconds.

## Dev data changes (Phase D)

- The e2e runs created throwaway tenants named "DashD" and "DashProbe" (each with an admin user, sessions and audit-log entries). No schema, migration or backend change. The empty and error screenshots were produced by intercepting the browser's API calls, not by changing data.

## Phase B — what was built

**Tokens** (`frontend/src/index.css`): `--status-info(-bg)`, `--destructive-foreground`, chart chrome (`--chart-*`), radius scale, spacing scale, control heights, typography scale with `.qth-type-*` classes, z-index ladder, motion durations (zero under reduced motion), breakpoint documentation. Existing tactile tokens unchanged.

**Components** (`frontend/src/components/ui/`): `PageHeader`, `StatusBadge`, `ConfirmDialog` (optional type-to-confirm), `Pagination`, `Tooltip`; `Badge` gained an `info` tone; `Button` gained an `icon` size and a contrast-safe destructive text colour; toasts gained `info` and `warning` variants.

**Proof adoptions (deliberately minimal):** `PageHeader` on Projects and Audit Logs; `Pagination` on Projects; `ConfirmDialog` replaces the local confirm dialog in Platform Admin. No other screen was migrated.

**Living catalogue:** `frontend/src/routes/_DesignPreview.tsx`, served at `/_design-system` on the dev server only (excluded from production builds).

**Guard rails:** `frontend/src/test/designSystem.test.ts` — dark-token parity across the two dark blocks, dark values for every status/chart token, and a per-file ratchet on hard-coded colours.

**Docs:** `docs/DESIGN_SYSTEM.md`, `docs/UI_UX_AUDIT_REPORT.md`, `docs/UI_UX_REMEDIATION_PLAN.md`, this file.

### Files created
`docs/DESIGN_SYSTEM.md`, `docs/UI_UX_AUDIT_REPORT.md`, `docs/UI_UX_REMEDIATION_PLAN.md`, `docs/UI_UX_IMPLEMENTATION_STATUS.md`, `frontend/src/components/ui/{PageHeader,StatusBadge,confirm-dialog,pagination,tooltip}.tsx`, `frontend/src/test/designSystem.test.ts`.

### Files modified
`frontend/src/index.css`, `frontend/src/components/ui/{badge,button}.tsx`, `frontend/src/lib/toast.tsx`, `frontend/src/routes/_DesignPreview.tsx` (rewritten as the catalogue), `frontend/src/App.tsx` (dev-only route), `frontend/src/routes/projects/ProjectsList.tsx`, `frontend/src/routes/admin/AuditLogs.tsx`, `frontend/src/routes/PlatformAdmin.tsx`.

## Phase C — what was built

**Header and tablet fit (UX-001).** Below `lg` the inline search field is an icon button that opens the command palette; Ask AI shows its label and the account button shows "Name · role" only from `xl`; the "Jump to… Ctrl K" hint moved from `lg` to `xl`; header height is a fixed 56px from `md`. The Execution Console's three panels stack until `xl` (1280px) — at 768–1024px the side-by-side layout clipped the verdict buttons — with the case list collapsed behind a "N cases" toggle and the verdict bar sticky to the bottom of the viewport below `xl`.

**Account menu (UX-006).** Accessible name is "Name · role account menu" (starts with the visible text); Escape closes the menu; `aria-controls`/`aria-expanded` wired; "My Account" has its own icon.

**Toasts (UX-009, UX-018).** Errors are `role="alert"`; the 4s timer pauses on hover and focus; each toast has a dismiss button (44px on phones); Escape clears all; below `md` the stack sits above the tab bar and the safe area.

**Sidebar and navigation (UX-024, UX-025).** Duplicate "Organization" link removed (sidebar footer and More sheet); Profile uses a distinct icon; the active item has a tinted fill plus a 3px accent bar; collapsed links keep an `aria-label` and show a tooltip on hover/focus (Escape hides it); Compliance Reports opens in a new tab with an external-link icon and "(opens in a new tab)" for screen readers. Groups were deliberately **not** made collapsible (longest group has 5 items; collapsing only adds clicks). The breadcrumb on the run-case route no longer repeats "Execution" ("Dashboard › Execution Console › Test Case").

**PageHeader rollout (UX-010).** 21 screens now use `PageHeader` (Dashboard, Environments, Users & Roles, Settings, Roles & Permissions, Defects, Defect Detail, Execution Console overview, Test Runs overview and per-project list, Test Run Detail, My Account, Platform Admin, Project Detail, Test Repository, Requirement Detail, Requirements list, Traceability Matrix, Test Case Detail, Test Cases list, Reporting; Projects and Audit Logs already did). `PageHeader` gained `back` (the "← Parent" link) and `actionsClassName`. Short one-line descriptions were added to list and admin screens. **Visible side effect:** on Users & Roles the two buttons swap order so the primary "Invite User" is rightmost (the design-system rule). Deliberate exceptions: the Execution Console panel title (a workspace card with a progress bar, not a page header), the print-only Compliance report (outside the shell) and the 404 page.

**Heading levels (UX-023).** `CardTitle` is an `<h2>` by default with an `as` prop; 0 heading skips on all 23 routes (was 13).

**Extra accessibility fixes found by the Phase C axe re-run** (pre-existing, outside the plan): the Dashboard KPI tile links and the attachment drop zone had an `aria-label` that did not contain their visible text (WCAG 2.5.3); the labels were removed so the visible text names them.

### Files created (Phase C)
`frontend/e2e/shell-phase-c.spec.ts`.

### Files modified (Phase C)
`frontend/src/routes/AppShell.tsx`; `frontend/src/components/{UserMenu,GlobalSearch,AIAssistantPanel,MobileNav,Breadcrumbs,AttachmentsCard}.tsx`; `frontend/src/components/ui/{PageHeader,card}.tsx`; `frontend/src/lib/toast.tsx`; route files under `frontend/src/routes/`: `Dashboard`, `MyAccount`, `PlatformAdmin`, `admin/{Environments,Settings,RolesPermissions,UsersRoles}`, `defects/{DefectsList,DefectDetail}`, `execution/{ExecutionConsole,ExecutionOverview,TestRunsOverview,TestRunsList,TestRunDetail}`, `projects/ProjectDetail`, `testrepository/TestRepository`, `requirements/{RequirementDetail,RequirementsList,TraceabilityMatrix}`, `testcases/{TestCaseDetail,TestCasesList}`, `reporting/Reporting`; and `docs/` (this file, the audit report, the design system).

## Verification — Phase C

| Check | Result |
|---|---|
| TypeScript (`tsc -b`) | Clean |
| Lint (oxlint) | 7 warnings, all pre-existing; none new |
| Unit tests (vitest) | 9 / 9 pass |
| Production build | Passes (`docker compose up --build -d web` runs `vite build`) |
| Overflow sweep | 23 routes × 9 widths (1920, 1440, 1366, 1280, 1024, 768, 430, 390, 375) × light and dark = **414 loads: 0 with horizontal overflow, 0 console errors, 0 HTTP errors**. Before: 768px overflowed by 55px (74px on the Execution Console) on every route. The Execution Console was re-measured after its last layout change at 768/1024/1280/1366 in light and dark (0). |
| axe (92 scans at 1280 and 390, WCAG 2.0/2.1 A+AA) | 74 clean. The 18 findings were two patterns (Dashboard tile links, attachment drop zone; both fixed afterwards and re-scanned clean on those pages) and the known Execution Console "Pass" button contrast (UX-004, Phase E). The account-menu finding is gone. Heading skips: 0 of 23 routes. |
| Nav by role | Admin, Manager (seeded Elena Vasquez) and Tester (seeded Aisha Okafor) signed in read-only: sidebar and More sheet show the same items per role as before (Admin: everything incl. Users & Roles, Roles & Permissions, Audit Logs, Environments, Settings; Manager: adds Environments; Tester: nothing from Administration). |
| e2e (one worker at a time) | 17 / 17 pass after the final code change (accessibility ×4, smoke ×6, mobile-shell, mobile-components, mobile-screens ×2, shell-phase-c ×3). An earlier batch of journey1–3, tier3-features and reliability: 7 / 7 pass; journey4 1 / 2 (data problem below). First attempt with 4 parallel workers timed out on a busy machine, so all runs use `--workers=1`. |
| Viewed screenshots | Dashboard 1920 light; Execution Console 768 light, 1024 dark and 1280 light; Test Case Detail 768 dark; Project Detail 390 light; Reporting 390 dark; Users & Roles 1280 dark. The rest were measured, not viewed. |

## Not verified / limitations (Phase C)

- Roles other than Admin were checked only for **navigation visibility**; their screens were not driven.
- Toast placement was verified by bounding-box measurement in an e2e test, not by eye; collapsed-sidebar tooltips by assertion and a probe, not by screenshot.
- Real devices, touch gestures, screen readers and iOS safe-area insets are untested.
- "Compliance Reports" is still shown to every role in the sidebar (unchanged). Hiding it by permission is a navigation-logic change and was not made.
- Execution Console "Pass" button contrast (UX-004) and the NotificationBell badge colour remain open (Phase E).
- `journey4 › Tester cannot close a defect` fails on the current dev database (see below); it is test-data pollution, not a Phase C regression.

## Dev data changes (Phase C)

- e2e runs and probes created more throwaway tenants ("ShellC", "ShellD", "ShellT" …) and many demo-admin/manager/tester sign-ins (sessions and audit-log entries).
- `journey4` signs in as a fixed `tester@example.com`; two leftover "J4TesterGate" tenants now share that address, so the login shows the organisation picker and the test times out. Deleting one of those throwaway tenants fixes it; it was not deleted automatically.
- No schema, migration or backend change.

## Verification — Phase B

| Check | Result |
|---|---|
| TypeScript (`tsc -b`) | Clean |
| Lint (oxlint) | 7 warnings, all pre-existing; none new |
| Unit tests (vitest) | 9 / 9 pass (5 existing + 4 new design-system tests) |
| Production build | Passes; catalogue chunk absent from the build; CSS 62.0 → 66.9 KB |
| e2e (one Playwright process at a time) | 14 / 14 pass: accessibility ×4, smoke ×6, mobile-shell, mobile-components, mobile-screens ×2 |
| Visual regression | Before/after screenshots of Dashboard, Projects, Defects, Users, Audit Logs, Execution Console, Settings, Test Case Detail at 1440 light + dark and 390 light, pixel-compared. Projects, Defects, Settings identical. Other differences are live data (new audit-log entries from the test logins) or Recharts' entry animation caught mid-draw (Dashboard, viewed); Execution Console and Test Case Detail show small differences (under ~400 changed pixels each); the dark-mode destructive button is the expected one, the others were not individually traced |
| Design catalogue | Renders in light, dark and 390px; no overflow; axe clean; confirm dialog requires the typed phrase, Escape closes, toasts show |
| Platform Admin `ConfirmDialog` | Suspend dialog opens with the right title/buttons and closes on Escape and Cancel (checked in a browser; the destructive confirm itself was not executed) |
| Contrast after the destructive fix | Execution Console in dark mode now has zero axe violations at 390px |

## Not verified / limitations

- Regression coverage for the proof adoptions relies on the existing e2e suite plus the screenshot comparison; the Platform Admin tenant status change was **not** executed end to end.
- Visual review was by measurement and pixel comparison; only the Dashboard comparison and the catalogue were viewed by eye.
- Admin role only; real devices and screen readers not tested.
- The journey e2e specs (1–4), `tier3-features` and `reliability` were not re-run in Phase B (slow on this machine); no code they exercise was changed apart from shared components covered by the specs that did run.

## Dev data changes

- The e2e runs created more throwaway tenants (named like "MobileShell …") in the development database.
- The sweep and probes signed in as the Meridian demo admin many times, adding audit-log entries and sessions.
- No schema, migration or backend change.
