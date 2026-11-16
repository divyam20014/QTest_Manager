# QTestHub UI/UX Remediation Plan

Maps every issue in `UI_UX_AUDIT_REPORT.md` to a phase. Phases A, B, C, D and E are complete. Each remaining phase ends with a report and waits for approval before the next begins (decision recorded in `UI_UX_IMPLEMENTATION_STATUS.md`).

**Standing constraints (all phases):** no backend, API, database, migration, authentication or RBAC changes; no removed features; no fake data; no new dependencies without a compelling reason; the tactile identity stays; the marketing site keeps its own palette; existing tests must keep passing. If a fix needs a backend change, it is documented here instead of implemented.

## Phase C — Application shell and page structure (DONE 2026-11-16)

Outcome: all listed issues fixed; see `UI_UX_IMPLEMENTATION_STATUS.md`. Deviations: the Execution Console three-panel layout now starts at `xl` (not `lg`) and its case list is collapsed below `xl`; sidebar groups were not made collapsible; Compliance Reports opens in a new tab rather than moving into the shell.

Goal: the frame every screen lives in is correct at every width and every page opens the same way.

| Work | Issues |
|---|---|
| Fix the 768–899px header overflow (collapse header controls below `lg` or default-collapse the sidebar at `md`), re-measure 768/810/820/900 | UX-001 |
| Account menu accessible name matches visible text | UX-006 |
| Toasts clear the mobile tab bar and safe area; `role="alert"` for errors; pause on hover/focus; Escape to dismiss | UX-009, UX-018 |
| Sidebar tidy: remove the duplicate Organization link, distinct Profile icon; decide how Compliance Reports opens | UX-024, UX-025 |
| Roll `PageHeader` out to all signed-in screens (title, optional one-line description, actions); one primary action per view, rightmost | UX-010 |
| `CardTitle` heading level (`as` prop) | UX-023 |

Verify: overflow sweep at 768/810/820/900/1024, axe on every route, e2e smoke + mobile specs.
Risk: header changes touch every page; the e2e suite relies on header labels (search, Ask AI), so selectors must be kept or updated deliberately.

## Phase D — Dashboard (DONE 2026-11-16)

Outcome: see `UI_UX_IMPLEMENTATION_STATUS.md` ("Phase D"). Deviations: the seven KPI tiles became four (Projects, Test Cases, Active Test Runs, Open Defects) with the other three numbers kept as second links; the Dashboard's chart colours now follow the in-app theme toggle (the old code followed only the OS setting).

| Work | Issues |
|---|---|
| Resolve the half-empty KPI tiles (span the gauge across two rows, or align tiles to content) | UX-026 |
| Chart chrome from `--chart-*` tokens (Dashboard share of the hard-coded colours) | UX-012 (part) |
| Keep the gauge/tactile design, check data labels and tooltips at all widths in both themes | – |

Verify: screenshots at 1920/1440/1280/1024/768/390 in both themes **viewed**, not only measured. Risk: chart animation makes pixel comparisons flaky (an in-progress animation was seen in Phase B); wait for settle.

## Phase E — Module-by-module modernisation (DONE 2026-11-16)

Outcome: see `UI_UX_IMPLEMENTATION_STATUS.md` ("Phase E"). Deviations: Repository uses "Load more" at 50 per project (decision 3 defaulted); Delete Project requires the typed name (decision 1 defaulted); the app font stays the system stack (decision 2 defaulted); Defects and Runs overview were not paginated; Test Repository is not virtualised; form work was limited to the required-field label standard (the rest is Phase F). Extra fixes found on the way: stacked-overlay key handling, shortcut keys firing while typing in the Execution Console comment box, "Next case" after the last step, and the Dashboard-vs-lists High severity colour mismatch.

Order chosen by user impact:

1. **Safety first:** `ConfirmDialog` on every destructive action (UX-002) — Project, Requirement, Test Case, Suite/Plan/Build/Release, members, users, roles, tokens, schedules, environments, custom fields, shared steps, modules, run cases. `requireText` for deleting a project. Success/failure toasts are already present.
2. **Execution Console:** Pass/Fail/Ignore buttons from a solid success/destructive/neutral token set (UX-004, NotificationBell badge from UX-005). Keep the pinned verdict bar and step layout.
3. **Test Repository and cross-project lists:** pagination/"Load more" with a visible total and a truncation notice (UX-003, UX-008, UX-016). No backend change — the API already pages.
4. **Status display:** one tone mapping per domain feeding `StatusBadge`; delete the duplicates (UX-011).
5. **Colour migration:** Reporting (66), Audit Logs (12), Dashboard (8, with Phase D), Test Case Detail (6), Execution Console (2), Settings (1), Compliance print (1); lower the ratchet baseline each time (UX-012).
6. **States:** standard loading → error → empty → data on every list and detail screen; skeletons replace "Loading…"; add the missing failure states on Execution Overview and Audit Logs (UX-014).
7. **Per-module review** (Organisation/Tenant admin, Users, Roles & Permissions matrix, Projects, Requirements, Test Repository, Test Planning, Execution, Defects, Reports, Audit Logs, Settings): apply the list/detail/form patterns from `DESIGN_SYSTEM.md`, improve the Roles permission matrix readability (grouping, expand/collapse, descriptions) without touching permission logic.

Verify: a role matrix (Admin, Manager, Tester) on every touched screen; full e2e journeys 1–4; axe on every route.
Risk: largest phase. Roles other than Admin have not been audited yet — do that at the start of E.

## Phase F — Forms, tables, dialogs and interactions

Outcome: see `UI_UX_IMPLEMENTATION_STATUS.md` ("Phase F"). UX-015, 017, 019, 020, 022 and 027 fixed; UX-013 and UX-021 partly (control heights are not fully unified; a few deliberate custom buttons remain). Extra work: a `FormField` / `FormError` form standard (it exposed silent validation failures on the Project form), an unsaved-changes guard on dialogs and drawers, client-side paging for Defects, and a fix for an unlayered `* { border-color }` rule that had disabled every Tailwind border-colour utility.

| Work | Issues |
|---|---|
| Control-height rule (header actions default, toolbar/row actions `sm`); remove 28px inputs | UX-013 |
| `aria-label` on every data table; sticky headers kept; column-visibility consistency | UX-015 |
| Inner card links ≥ 44px on phones | UX-017 |
| Placeholder-only inputs get labels | UX-022 |
| Radius and type-scale normalisation (`rounded` → scale; 10px → 11px) | UX-019, UX-020 |
| `buttonVariants()` for link-buttons; `TactileButton` stays hero-only | UX-021 |
| `Tooltip` replaces `title=` where the text matters | UX-027 |
| Form standard: required markers, helper text, error placement, preserved input on failure, no double submit | – |

## Phase G — Responsive, accessibility and performance

| Work | Issues |
|---|---|
| Route-level code splitting (`React.lazy`) for admin, reporting, platform admin, detail screens, Recharts; check the production bundle | UX-007 |
| Re-run the full 414-load sweep, axe on all routes, keyboard-only pass, reduced-motion pass | – |
| Decide the app font (system vs Inter) | UX-028 |
| Real-device and screen-reader checks (needs the user or a device lab) | – |

## Phase H — Regression and final verification

Full unit, lint, typecheck, production build, all e2e specs one at a time, before/after screenshots viewed, role matrix, updated report and status files.

## Decisions needed from the user

1. **Project deletion:** require typing the project name (recommended) or a plain confirm?
2. **App font:** keep the system font stack or switch the app to Inter to match the marketing site?
3. **Repository pagination style:** numbered pages or "Load more"?
4. **Roles to audit:** confirm Manager and Tester seeded accounts may be used in Phase E.

## Backend follow-ups (documented, not implemented)

- A cross-project test-case endpoint would replace the one-request-per-project pattern in Test Repository (UX-008).
- Totals/pagination metadata on any list that currently returns a bare array would let the UI show "N of M".
