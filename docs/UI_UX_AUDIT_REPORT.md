# QTestHub UI/UX Audit Report

**Phase A of the UI/UX programme.** Audit of the signed-in application, run on 2026-11-16 against the committed code (`dec4820`) plus the Phase B design-system work. The tactile/embossed identity was kept as a decision; nothing here proposes a flat redesign.

Companion documents: `UI_UX_REMEDIATION_PLAN.md` (what to fix and in which order), `UI_UX_IMPLEMENTATION_STATUS.md` (live tracker), `DESIGN_SYSTEM.md` (the system built in Phase B).

## 1. How the audit was done — and what was *not* measured

| Method | Coverage | Evidence quality |
|---|---|---|
| Playwright sweep against the running app (Meridian demo tenant, Admin role) | **23 signed-in routes × 9 widths (1920, 1440, 1366, 1280, 1024, 768, 430, 390, 375) × light + dark = 414 page loads** | Measured: horizontal overflow, console and HTTP errors, DOM size, control heights, unlabeled fields, heading order, tap targets (<768px) |
| axe-core (WCAG 2.0/2.1 A + AA) | the 23 routes at 1280 and 390, both themes (92 scans) | Measured |
| Screenshots | 1440 (light + dark), 768 and 390 (light), all 23 routes | Captured; **only a handful were viewed by eye** (Dashboard, the design catalogue). Most conclusions are from measurement, not visual review |
| Source search (`grep`) | all of `src/routes` and `src/components`, marketing excluded | Read from code; not all behaviours were exercised |
| Bundle inspection | production `vite build` output | Measured |

**Not covered:** Login, Signup, Accept-invite, Not-found, Compliance print view and Platform Admin were not part of the width sweep (Platform Admin was checked at phone widths during the mobile work). Only the **Admin** role was driven; Manager and Tester views of the same screens were not audited. No real devices, no screen reader, no touch gestures. Timings were taken on a heavily loaded development machine against the Vite dev server, so load times and "requests per page" (which count dev-server module fetches) are **not** reliable performance numbers; they are not used below except where stated.

## 2. Summary

| Severity | Count | Fixed | Partial | Open |
|---|---|---|---|---|
| Critical | 0 | – | – | 0 |
| High | 5 | 5 | 0 | 0 |
| Medium | 16 | 14 | 1 (UX-008) | 1 (UX-030) |
| Low | 18 | 17 | 0 | 1 (UX-039) |
| **Total** | **39** | **36** | **1** | **2** |

(Status as of the end of Phase H; the issue table below carries the detail. Phase G added eight issues found by the Manager/Tester audit, the keyboard pass and the production measurements: UX-030 to UX-037. Phase H's screenshot review added two more: UX-038, fixed, and UX-039, open.)

No Critical issues: nothing crashes, no route returned a console or HTTP error in any of the 414 loads, and there is no horizontal overflow at any width except the tablet band described in UX-001.

### Top findings

1. **UX-001 (High)** — At tablet widths (768–~899px) every signed-in page scrolls sideways because the header's right-hand controls overflow by up to 74px.
2. **UX-002 (High)** — About 21 destructive actions run immediately with no confirmation (delete project, delete requirement, deactivate user, revoke tokens…).
3. **UX-003 (High)** — Test Repository requests at most 100 test cases per project and ignores the total, so larger projects are silently truncated; it also renders every row (no pagination).
4. **UX-004 (High)** — The Execution Console "Pass" button fails WCAG AA contrast (3.49 : 1).
5. **UX-005 (Medium, fixed)** — White text on the dark-mode destructive button was 2.76 : 1; fixed with a `--destructive-foreground` token.
6. **UX-007 (Medium)** — One 1.29 MB (351 KB gzip) JavaScript bundle loads for every signed-in user; no route-level code splitting.
7. **UX-010/011/012 (Medium)** — Design drift: 26 hand-built page headers, 14 separate status-colour maps, 96 hard-coded colours in 7 files.
8. **UX-006 (Medium)** — The account-menu button's accessible name does not contain its visible text (axe "serious", WCAG 2.5.3), on every signed-in route.
9. **UX-014/015 (Medium)** — Missing fetch-failure states on some screens, "Loading…" text instead of skeletons on detail pages, and none of the 12 desktop data tables has an accessible name.
10. **UX-009 (Medium)** — Toasts anchor to the bottom-right and overlap the new mobile tab bar.

### What is already good

- All 23 routes: one `<h1>` at the same size/weight (18px / 600) and the same 24px content padding at desktop width.
- Zero console errors and zero failed HTTP requests across 414 loads.
- No overflow at 1920, 1440, 1366, 1280, 1024, 430, 390, 375 in either theme.
- No form control below 16px on phones; every measured field has an accessible label except the five in UX-022.
- Dialogs trap focus, close on Escape and return focus; focus rings use `outline` so they survive tactile shadows; reduced-motion is respected.
- Phase B guard rails (token parity and a colour ratchet) now run in `npm test`.

## 3. Route inventory

Access: every signed-in user reaches a screen unless noted; individual actions are permission-gated by the backend and hidden in the UI by role helpers. Administration items are Admin-only (Environments: Manager and above).

| Route | Screen | Purpose | Main / secondary actions | API modules |
|---|---|---|---|---|
| `/` | Dashboard | Status at a glance (KPIs, pass-rate gauge, needs-attention, charts) | KPI links, "View all" | reporting, defects, projects |
| `/projects` | Projects list | Browse and create projects | New Project · filter, sort, page | projects, users |
| `/projects/:id` | Project detail | Config, members (project role), builds, releases, suites, plans | Edit, add member, create build/release/suite/plan, **Delete Project** | projects, roles, execution, users |
| `/projects/:id/requirements` | Requirements list | Browse/create requirements | New, import, filter | requirements |
| `/requirements/:id` | Requirement detail | Edit, links, AI change analysis | Edit, **Delete**, link tests | requirements, ai |
| `/projects/:id/traceability-matrix` | Traceability matrix | Requirement ↔ test coverage | Drill into rows | reporting |
| `/projects/:id/test-cases` | Test cases list (per project) | Browse, modules/folders | New, import, bulk | testCases, modules |
| `/test-cases/:id` | Test case detail | Edit, workflow (submit/approve/deprecate), data sets, attachments | Workflow actions, **Delete** | testCases, defects, ai |
| `/test-repository` | Test Repository | Cross-project case browser | New, import, bulk, filter | testCases, projects, modules |
| `/projects/:id/test-runs` | Runs (per project) | Run list/create | New run | execution |
| `/test-runs` | Test Runs overview | Cross-project run list | Filter | execution, projects |
| `/test-runs/:id` | Run detail | Cases in a run, progress | Execute, remove case, assign | execution, users |
| `/test-run-cases/:id` | Execution Console | Run one case step-by-step | Pass / Fail / Ignore, log defect | execution, defects |
| `/execution` | Execution overview | Active runs across projects | Open run | execution, projects |
| `/defects` | Defects list | Browse/triage | New, import, filter | defects |
| `/defects/:id` | Defect detail | Lifecycle, comments, history | Advance status, edit | defects, ai |
| `/reporting` | Reports | Release readiness, trends, aggregate reports, exports | Filters, export | reporting, projects |
| `/reporting/print` | Compliance print view | Printable compliance report (outside the shell) | Print | reporting |
| `/admin/users` | Users & Roles | Invite/create/deactivate users, assign roles | Invite, New User, **Deactivate** | users, roles |
| `/admin/roles` | Roles & Permissions | Permission matrix, custom roles | Save, **Deactivate role** | roles |
| `/admin/audit-logs` | Audit Logs | Tamper-evident event log | Filter, Export CSV, Verify chain, Load more | audit |
| `/admin/environments` | Environments | Test environments | Create, **Delete** | environments |
| `/settings` | Settings | Org, branding, SSO/SCIM, tokens, custom fields, schedules, AI | Many tabs; **revoke/delete** actions | settings and others |
| `/account` | My Account | Profile, MFA, sessions | Change password, revoke session | auth |
| `*` | Not found | 404 | Back to dashboard | – |
| outside the shell | `/login`, `/signup`, `/accept-invite/:token`, `/platform-admin`, 10 marketing paths; dev-only `/_design-system` | | | |

## 4. Issues

Status: **Open**, **Partial** (building blocks exist, screens not migrated), **Fixed**. IDs are stable; the tracker references them.

### High

| ID | Module / page | Issue | Cat. | Recommended fix | Status |
|---|---|---|---|---|---|
| UX-001 | Shell · all 23 routes | At 768px the page overflows horizontally by 55px (max 74px on the Execution Console), in both themes; 54px at 769, 23px at 800, 0 at 900. The header's right group (search, "Jump to…", Ask AI, theme, bell, user menu) is wider than the space left beside the 240px sidebar. Measured at 414/414 loads in the band; offender `div.flex.shrink-0.items-center.gap-2` right edge at 823px. | Responsive | Below `lg`: icon-only Ask AI, hide "Jump to…", compact user menu; or default the sidebar to collapsed at `md`. | **Fixed** (Phase C): inline search is an icon below `lg`, Ask AI / account text from `xl`, header 56px; Execution Console panels stack until `lg`. 0 overflow in 414 loads. |
| UX-002 | Many | ~21 destructive/irreversible actions call the mutation directly from `onClick` with no confirmation: Delete Project, Delete Requirement, Delete test case (Repository and detail), Delete suite/plan/build/release, Remove project member, Deactivate user, Deactivate role, Revoke SCIM/service tokens, Delete report schedule, Delete environment, Delete custom field/option, Remove case from run, Delete shared step, Delete module. Read and confirmed by code for Delete Project, Delete Requirement, Deactivate user; the rest by code search of `onClick={() => …mutate(…)}`. | Usability | Put every one behind `ConfirmDialog` (built in Phase B); `requireText` for project deletion. | **Fixed** (Phase E): 26 actions behind `useConfirm`; Delete Project requires typing the project name. |
| UX-003 | Test Repository (also Defects, Runs overview) | Per-project test cases are requested with `page_size: 100` and the response `total` is ignored, so a project with more than 100 cases is silently truncated; the project list is also capped at 100. Demo data (≤ ~35 cases per project) doesn't reproduce it, so this is **verified in code only**. | Functional | Server-side pagination or "Load more" with a visible total on all cross-project lists; show a notice when truncated. No backend change needed (API already pages). | **Fixed** (Phase E): Repository loads 50 per project with "Load more" and the real total; failed projects show an error. Defects and Runs overview were not changed. |
| UX-004 | Execution Console | The "Pass" button (white `#f9fafb` on emerald `#009966`) is 3.49 : 1 — fails AA for 14px text — on the primary action of the screen testers use most. Flagged by axe at 1280 and 390, light theme. | A11y | Add a solid success-button token pair (≥ 4.5 : 1 both themes) and use it; remove the hard-coded `bg-emerald-600`. | **Fixed** (Phase E): `success` button variant (5.48 : 1 light; dark text on light green in dark mode); axe clean. |
| UX-035 | Tabs (Settings and others) | Inactive tabs had `tabindex="-1"` but no arrow-key handling, so a keyboard user could never reach tabs after the first. | A11y | WAI-ARIA tabs: ArrowLeft/Right, Home, End, `aria-controls`, labelled panel. | **Fixed** (Phase G) |

### Medium

| ID | Module / page | Issue | Cat. | Recommended fix | Status |
|---|---|---|---|---|---|
| UX-005 | Button (destructive) | White text on the dark-mode destructive fill `#f87171` was 2.76 : 1 (seen on Project Detail, Test Case, Requirement, Execution Console in dark). | A11y | `--destructive-foreground` token (4.83 : 1 light, 7.16 : 1 dark). The `NotificationBell` badge still uses `text-white` on `--destructive`; not flagged by axe, fix with the same token. | **Fixed** (Button in Phase B; NotificationBell badge in Phase E). |
| UX-006 | UserMenu · all routes | `aria-label="Jordan Price account menu"` does not contain the visible text, so axe reports `label-content-name-mismatch` (serious, WCAG 2.5.3) — 54 of 92 scans, every route at 1280. | A11y | Start the label with the visible text or remove the label and let the content name the button. | **Fixed** (Phase C): accessible name = visible "Name · role" + "account menu"; no `label-content-name-mismatch` on the account menu in 92 axe scans. |
| UX-007 | Build | One main bundle, 1,294 KB (351 KB gzip), loads for every signed-in user; no `React.lazy` on app routes (only marketing is split). CSS is 66.9 KB. | Performance | Lazy-load route groups (admin, reporting, platform admin, detail screens) and Recharts. | **Fixed** (Phase G): every signed-in screen is a lazy route (`lazyRoute` + `RouteBoundary`); Recharts loads after the Dashboard renders. Initial JS 1,318 KB / 360 KB gzip → about 534 KB / 166 KB gzip (entry + 3 preloaded chunks); CSS 69.8 → 72.1 KB. |
| UX-008 | Test Repository | Renders every row: 161 rows → 2,920 DOM nodes (4,158 as cards at 430px), growing linearly; no virtualisation or pagination. Also one request per project. | Performance | Paginate (see UX-003); fetch with one cross-project query if the API allows (backend change — document only). | **Partial** (Phase E/G): bounded by what is loaded (50 per project to start, "Load more"); Defects and Runs overview page on the client (50). Still one request per project and every loaded Repository row is in the DOM (about 4,000 nodes at 1280px with the demo data); virtualisation was not added (risk to selection, bulk actions and the context menu). |
| UX-009 | Toast · phones | Toasts anchor 16px from the bottom-right; the mobile tab bar occupies 775–844px of an 844px viewport, so toasts sit on top of it and ignore the safe area. Geometry measured; **not viewed**. | Responsive | Offset toasts above the tab bar and safe area below `md`. | **Fixed** (Phase C): toasts sit above the tab bar and safe area below `md`; verified by measurement in e2e, not viewed. |
| UX-010 | All screens | 26 screens hand-build their header; classes vary (`text-lg font-semibold` ×17, with `break-words` ×8, `text-xl font-semibold`, `text-xl font-bold`); none has a description line. | Visual | `PageHeader` (built) on every screen. | **Fixed** (Phase C): `PageHeader` on every signed-in screen except the Execution Console panel title, the print-only Compliance report and the 404. |
| UX-011 | Status display | 14 separate status→tone maps (`statusDisplay.ts` ×3, Settings, Dashboard, ExecutionConsole, ExecutionOverview, TestRunDetail, PlatformAdmin ×2…); `Badge` had no information tone. | Visual | One mapping per domain feeding `StatusBadge`. | **Fixed** (Phase E): shared `lib/statusTones.ts`; state badges use `StatusBadge`. |
| UX-012 | Reporting, Audit Logs, Dashboard… | 96 hard-coded colours in 7 files (Reporting 66, Audit Logs 12, Dashboard 8 (migrated in Phase D, now 0), Test Case Detail 6, Execution Console 2, Settings 1, Compliance print 1), including per-chart `isDark ? '#…' : '#…'` chart chrome repeated ~15 times. | Visual | Use `--status-*` and the new `--chart-*` tokens; lower the ratchet as files are migrated. | **Fixed** (Phase E): 0 left except 2 deliberate (brand colour input default, print stylesheet). |
| UX-013 | All screens | Control heights vary: buttons measure 32px ×333, 36px ×9, 38px ×7, 30px ×5 (plus 16–22px inline text buttons); inputs 36px ×86, 28px ×10. Header actions mix `sm` and default sizes (Projects 36px vs Users 32px). | Visual | One rule: header actions `default`, toolbar/row actions `sm`; remove 28px inputs. | **Fixed** (Phase G): one documented scale — 32 / 36 / 40px, 44px on phones. The 30px menu triggers and 38px Settings tabs are on the scale; the 1280px sweep finds no other control height between 28 and 44px (inline text buttons of 16–24px are links in running text). |
| UX-014 | ExecutionOverview, Audit Logs, detail pages | No fetch-failure state on Execution Overview and Audit Logs (read in code); 18 plain "Loading…" strings (detail pages, Execution Overview) instead of skeletons; list screens differ in empty-state wording. | Functional UX | Standard loading → error (retry) → empty → data sequence using `Skeleton`/`ErrorState`/`EmptyState`. | **Fixed** for detail pages, Audit Logs, Execution Overview, Repository and Settings cards (Phase E). |
| UX-015 | Data tables | None of the 12 desktop `<table>`s has a caption or `aria-label` (`ResponsiveTable` passes `label` only to the phone card list). | A11y | Pass `label` to the `<table>` as `aria-label`. | **Fixed** (Phase F): all 12 desktop tables named. |
| UX-016 | Lists | Three pagination patterns: numbered pages (Projects, Requirements, Test Cases, Platform Admin ×2), "Load more" (Audit Logs), none (Defects, Repository, Runs overview). Numbered footers were hand-copied five times. | Usability | `Pagination` component (built); adopt everywhere; decide numbered vs load-more per list. | **Fixed** (Phase G): the decision is recorded — numbered `Pagination` for lists, "Load more" for the Repository and Audit Logs. Runs overview now pages on the client like Defects (50 per page). |
| UX-017 | Phone card lists | Secondary links inside cards are 30–32px tall (e.g. the project link under a run name is 118×32). The card itself is the target, so this is lower impact than it looks. My sweep counts all small targets (Runs 53, Repository 53/19, Traceability 21–23, Defects 4–14, Requirements 10–12) without separating stretched title links from genuinely small ones; only Test Runs was inspected element by element. | Mobile | Give inner links `min-h-11` or move them out of the card's tap area. | **Fixed** (Phase F): inner card links 44px, above the stretched title link. |
| UX-030 | Admin screens opened by direct URL (Manager, Tester) | The sidebar hides Users & Roles, Roles & Permissions, Audit Logs and Settings, but the URLs still render the page, which then shows a generic load error after a 403 (4 requests per page because of retries). Enforcement is correct (the API refuses); the experience is not. | IA / UX | A route guard that shows "You do not have access" using the same permission codes as the API (a frontend-only change, but it duplicates the permission map, so it needs your decision). | Open |
| UX-031 | Notifications button (Manager, Tester) | `aria-label="Notifications"` did not contain the unread count shown on the button, so axe reported `label-content-name-mismatch` on every page for any user with unread items (the Admin demo user has none, so Phase C missed it). | A11y | Label becomes "Notifications, N unread". | **Fixed** (Phase G) |
| UX-034 | Dashboard | The loading skeleton was 76px (desktop) to 146px (phone) shorter than the loaded headline row, so everything below jumped when data arrived: CLS 0.066 unthrottled, 0.102 throttled. | Performance | Skeleton reserves the measured loaded height. | **Fixed** (Phase G): CLS 0.024; skeleton and loaded row are the same height at 1350, 1024, 768 and 390px (768px is within 8px per tile). |

### Low

| ID | Module / page | Issue | Cat. | Recommended fix | Status |
|---|---|---|---|---|---|
| UX-018 | Toast | Every toast is `role="status"` (errors should announce assertively); 4s auto-dismiss never pauses on hover/focus; dismiss is click-only. | A11y | `role="alert"` for errors; pause on hover/focus; Escape to dismiss. | **Fixed** (Phase C): errors `role="alert"`, timer pauses on hover/focus, dismiss button, Escape clears. |
| UX-019 | All | Radius mix: `rounded-md` 79, `rounded` 28, `rounded-full` 20, `rounded-lg` 19, `rounded-xl` 12, `rounded-sm` 2. | Visual | Normalise to the radius scale (control / card / panel / sheet / pill). | **Fixed** (Phase F): 0 off-scale radii, guarded by test. |
| UX-020 | All | Type mix: `text-xs` 337, `text-sm` 231, `text-lg` 25, `text-base` 24; `text-[10px]` ×10 and `text-[11px]` ×4 (10px is below the 11px floor in Execution Console, Defect Detail, Roles). | Visual | Use the type scale; raise 10px to 11px. | **Fixed** (Phase F): 10px text raised to 11px, guarded by test. |
| UX-021 | Buttons | Two button systems (`Button`, `TactileButton`) and hand-styled links that copy `buttonVariants` (e.g. Audit Logs "Export CSV"). | Visual | Use `buttonVariants()` for link-buttons; keep `TactileButton` hero-only. | **Fixed** (Phase G): `TactileButton` is used only on the Dashboard hero; link-buttons use `buttonVariants()`; the remaining pill chips (AI suggestions) are deliberate. |
| UX-022 | Project Detail, Test Case Detail | Five inputs use only a placeholder as their label (new build / release / suite / plan name; new data set name). | A11y | Add `aria-label` or a visible label. | **Fixed** (Phase F): 14 inputs named; unlabeled fields 5 → 0. |
| UX-023 | 13 pages | Heading levels skip (h1 → h3) because `CardTitle` renders `h3`. | A11y | Let `CardTitle` take an `as` prop (default `h2`). | **Fixed** (Phase C): `CardTitle` is `<h2>` by default with an `as` prop; 0 heading skips on 23 routes. |
| UX-024 | Sidebar | "Settings" (Administration) and the footer "Organization" both open `/settings`; "Profile" uses the same icon as "Users & Roles". | IA | Remove the duplicate entry; distinct icon for Profile. | **Fixed** (Phase C): duplicate Organization link removed (sidebar and More sheet); Profile has its own icon. |
| UX-025 | Sidebar | "Compliance Reports" opens `/reporting/print`, which is routed outside the shell (no sidebar or header) without warning. | IA | Open it in a new tab with an indicator, or keep the shell with a print-only inner view. | **Fixed** (Phase C): Compliance Reports opens in a new tab with an external-link icon and "(opens in a new tab)". |
| UX-026 | Dashboard | In the second KPI row the tiles stretch to the gauge tile's height, leaving roughly half of each tile empty (visible at 1440). | Visual | Let the gauge span two rows or align tiles to content height. | **Fixed** (Phase D: gauge is a two-row hero, four content-height KPI tiles) |
| UX-027 | All | `title=` is used 69 times as the only tooltip (hover-only; invisible on touch and keyboard). | A11y | `Tooltip` component (built) for anything that matters. | **Fixed** (Phase F): native `title=` on elements 8 → 0. |
| UX-028 | App vs marketing | The app uses the system font stack; the marketing site uses Inter, so the brand type differs after sign-in. | Visual | **Decision needed:** keep system fonts (zero cost) or load Inter in the app (already bundled, ~75KB latin). | **Fixed** (Phase G, on your instruction): the app uses self-hosted Inter Variable with a metric-matched fallback; the latin file is preloaded. No overflow or truncation appeared in the 414-load sweep afterwards. |
| UX-029 | Tokens | Dark-theme tokens are duplicated in two CSS blocks (OS preference and forced dark), a drift risk. | Maintainability | Guard test added; consider a single source later. | **Fixed** (guarded) |
| UX-032 | Tester role | Nine screens requested `GET /users` (needs `user.manage` or `project.members.manage`) just to resolve names; a Tester got a guaranteed 403 plus three retries on each, filling the console. | Performance | `useCanListUsers()` skips the request when the permission is missing (mirrors the API check; nothing is enforced client-side). | **Fixed** (Phase G): 0 on content pages; the 403s that remain are the admin-only pages in UX-030. Names fall back to ids for those users, as before. |
| UX-033 | Sign-in, Sign-up, Accept invite | No `<main>` landmark (Lighthouse `landmark-one-main`; accessibility 97). | A11y | `<main id="main-content">` wrapper. | **Fixed** (Phase G) |
| UX-036 | Dashboard and Reports charts | Recharts animated even when the user asked for reduced motion (CSS cannot reach JS animation). | A11y | `usePrefersReducedMotion()` turns chart animation off; a global reduced-motion rule flattens any remaining CSS motion. | **Fixed** (Phase G) |
| UX-037 | Discard prompt | Tab could leave the "Discard unsaved changes?" prompt and reach the form behind it; "Keep editing" dropped focus to the page. | A11y | The form and close button are `inert` while the prompt is open; focus returns to where it was. | **Fixed** (Phase G): tested for the Project dialog; the Test Case drawer uses the same code. |
| UX-038 | Test Case Detail · Test Data Sets | The "Add Set" button (and the per-set row "Add" button) wrapped onto two lines at 1440px, because the full-width input squeezed the flex row. Found by viewing the Phase H screenshots; no measurement had flagged it. | Visual | `shrink-0 whitespace-nowrap` on the two buttons. | **Fixed** (Phase H); re-captured at 1440px light and dark, one line. |
| UX-039 | Reports | The page mixes two card styles: "Project & Test Case Distribution by Domain" is a plain white `Card`, while the two `ChartPanel`s below it use the tactile `EmbossedCard`, so they look grey and raised next to the first. Seen at 1440px in light and dark. | Visual | Put the Distribution chart in a `ChartPanel` too (this also gives it "View as table"). Not done in Phase H: it changes a chart's markup and needs its own check. | Open (Low) |

## 5. Measurements reference

- **Overflow:** 0 at every width except 768 (23/23 routes × 2 themes; 55px typical, 74px Execution Console). Spot checks: 769 → 54px, 800 → 23px, 900 and above → 0.
- **Console/HTTP errors:** none in 414 loads.
- **axe (92 scans):** 35 scans fully clean; findings: `label-content-name-mismatch` (UX-006), `color-contrast` ×10 (UX-004 light; UX-005 dark, now fixed). After Phase B the dark Execution Console is clean at 390px.
- **Unlabeled fields:** 5 (UX-022). **Icon buttons without a name:** 0.
- **Heading skips:** 13 of 23 routes.
- **Bundle (production build):** main JS 1,294 KB / 351 KB gzip; CSS 66.9 KB (+4.9 KB over the previous build, from the new tokens and component classes); marketing 100.9 KB and two small lazy chunks, loaded only for signed-out visitors. The design catalogue is not in the production build.
- **DOM size at 1280px, light:** Repository 2,920 nodes, Account 1,307, Reports 908, Defects 822, Audit Logs 749; all others under 800.
- **Dev-server note:** the "37–48 requests per page" seen in the sweep are mostly Vite module requests; only ~5 are API calls (counted for Projects). Not a real finding.

### Phase G measurements

- **Sweep (Admin, Meridian demo tenant):** 23 routes × 9 widths (1920 to 375px) × light and dark = 414 loads. Overflow 0, console and HTTP errors 0, 92 of 92 axe scans clean (WCAG 2.0/2.1 A and AA), unlabeled fields 0, unnamed icon buttons 0, heading skips 0, no input under 16px on phones. The only touch target under 44px at phone widths is the visually hidden skip link. The sweep hung twice (a screenshot or axe call that never returned) and was killed and resumed in pieces; the 414 loads come from four partial runs of the same script, not one.
- **Manager and Tester (read-only, 22 routes × 1280 and 390px = 44 loads each):** 0 overflow, 0 axe violations after the fixes (before: `label-content-name-mismatch` on every page). Remaining 403s are the admin-only screens opened by direct URL (UX-030). The Execution Console case route was not in the role script.
- **Bundle (production build):** initial JavaScript 1,318 KB / 360 KB gzip → about 534 KB / 166 KB gzip (entry 469 KB plus three preloaded shared chunks); CSS 69.8 → 72.1 KB (the Inter font-face blocks). Recharts (386 KB, 109 KB gzip) loads after the Dashboard or Reports render. 82 JavaScript chunks. The Inter latin file (48 KB) is preloaded; other subsets download only when a page needs them.
- **Lab timings, production build, Chromium on a loaded development machine, cold cache:** unthrottled Dashboard FCP 276 ms, LCP 588 ms, CLS 0.024; throttled (4× CPU, 1.6 Mbps, 150 ms RTT) FCP 2.0–2.4 s and LCP 4.5–5.5 s on Dashboard, Projects, Repository, Reports and Defects. The throttled long-task total is high on Reports (about 5.9 s on one run) because the chart library has to evaluate and render at 4× CPU. These are single runs on a noisy machine, not Lighthouse scores for the signed-in app.
- **Lighthouse 13 (mobile emulation, simulated throttling) against the production build:** `/login` performance 86, accessibility 97 (the missing `<main>`, now fixed; not re-run), best practices 96; marketing home `/` performance 41 (LCP 6.3 s, TBT 3.7 s), accessibility 100, best practices 96. The marketing site is outside the remediation scope but is the weakest measured page. The signed-in app could not be run through Lighthouse (it needs a session).

### Phase H measurements (final verification)

- **Backend:** full `pytest` run once: 683 passed, 1 failed in 27 min 32 s. The failure is `test_csv_import.py::test_bulk_import_2000_rows_under_2_5_seconds`, the known timing test (GAP-69) that is sensitive to machine load. It is unrelated to this frontend-only programme, and `git diff HEAD -- backend` is empty.
- **Sweep (Admin, Meridian demo tenant):** 23 routes x 9 widths x light and dark = 414 loads, this time in one pass of six timed pieces with no hang. Overflow 0, console and HTTP errors 0, 92 of 92 axe scans clean, unlabeled fields 0, unnamed icon buttons 0, heading skips 0, no input under 16px on phones, 12 of 12 desktop tables named. Body font is Inter Variable on all 414. Phone tap targets under 44px: the hidden skip link on every route, plus four Dashboard tile title links that are stretched over their whole tile (the tile is the target).
- **Screenshots viewed:** about 60 captures by eye. Before/after contact sheets (before, after light, after dark) at 1440px for Dashboard, Repository, Execution Console, Reports, Roles & Permissions, Users, Audit Logs, Defects, Projects, Settings and Test Case Detail; at 390px for Dashboard, Repository, Console, Defects, Users, Roles, Audit Logs and Reports; plus Dashboard, Console, Repository and Users at 768px, Dashboard and Reports at 1920px, and the Console at 1024px. Defects found: UX-038 (fixed) and UX-039. Not defects: the Console's "42506s elapsed" is a step timer left running on one demo case, and the Users table scrolls sideways inside its own box at 768px (by design; nothing is hidden). Screens not viewed by eye (measured only): Requirements, Traceability, Test Cases list, Project Detail, Runs, Run Detail, Defect Detail, Requirement Detail, Execution overview, Environments, Account and Platform Admin at most widths.
- **Keyboard only** (new `e2e/phase-h.spec.ts`, throwaway tenant): sign-in with Tab, typing and Enter across the email, password and code steps; the skip link is the first Tab stop and moves focus to `<main>`; the sidebar is reachable by Tab alone; "New Project" opens from the keyboard, Escape closes it and focus returns to the trigger; a case is run with the P and F keys and the defect is filed entirely from the keyboard; typing "pif" in the step comment box records nothing. The **I** (Ignore) shortcut itself was not exercised.
- **Session:** Logout returns to `/login`; `/projects` and `/admin/users` redirect an anonymous visitor to `/login`; clearing every cookie and reloading redirects to `/login`. A session that expires while the user is clicking around (no reload) was not tested.
- **Roles (demo tenant, read-only GETs):** Admin sees 14 sidebar entries; Manager sees Environments but no admin pages; Tester sees neither. API: Admin 200 on `/users`, `/roles`, `/audit-logs` and `/environments`; Manager 200 on `/users` and `/environments`, 403 on `/roles` and `/audit-logs`; Tester 403 on `/users`, `/roles` and `/audit-logs`, 200 on `/projects` and `/environments`. Opening `/admin/users` or `/admin/audit-logs` directly as Manager or Tester still renders the page shell (UX-030, open).
- **Marketing site:** 10 public pages at 1440 and 390px: 0 overflow, no console or HTTP errors apart from the expected signed-out `/auth/me` 401, Inter on all. The "Explore QTestHub in 2 Minutes" walkthrough opens, steps through with the arrow keys, closes with Escape and returns focus; the Quality Intelligence Center shows its 6 nodes; submitting the empty demo form shows validation and sends no request; the Sign In link reaches `/login`. The lead form was not submitted (it would add a lead to the dev database).
- **Lighthouse 13, mobile, production build:** `/login` performance 85, accessibility **100** (was 97 before the `<main>` fix), best practices 96, LCP 2.2 s, TBT 430 ms, CLS 0. Marketing home `/`: performance 51 (was 41), accessibility 100, best practices 96, LCP 5.9 s, TBT 1,040 ms (outside this programme; reported only). Single runs on a loaded machine.
- **Signed-in production timings** (Chromium, loaded machine, single cold runs): unthrottled Dashboard FCP 264 ms, LCP 552 ms, CLS 0.024; throttled (4x CPU, 1.6 Mbps) LCP 4.6 to 4.9 s on Dashboard, Projects, Repository, Reports and Defects, the same as Phase G within noise. The signed-in app itself was not scored by Lighthouse (it needs a session).
- **Bundle (production build):** initial JavaScript about 534 KB (about 166 KB gzip; entry 469 KB / 144 KB gzip plus three preloaded shared chunks) against the 1,318 KB / 360 KB gzip baseline. Recharts' 386 KB (111 KB gzip) loads only on the Dashboard and Reports. `vite build` takes about 8 s; `npm run build` including `tsc -b` about 18 s.

## 6. Recommended future improvements (beyond remediation)

- Real-device and screen-reader testing (the Manager and Tester role audit was done in Phase G).
- A visual-regression baseline (Playwright screenshots) once the shell is stable.
- Performance budget in CI (bundle size, CSS size) alongside the new design-token tests.
- Marketing home performance (LCP 6.3 s, TBT 3.7 s on Lighthouse mobile): split the walkthrough and screenshots further, or defer below-the-fold sections.
- A route guard for admin-only screens (UX-030) once you decide how it should look.
- A cross-project test-case endpoint (one request instead of one per project) and totals on list endpoints.
