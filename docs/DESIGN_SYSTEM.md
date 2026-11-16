# QTestHub Design System

Single reference for how the signed-in QTestHub application looks and behaves. It formalises the tokens and components that already exist (the tactile / embossed identity is **kept**, not replaced) so new screens stay consistent.

- **Source of truth for tokens:** `frontend/src/index.css`
- **Shared components:** `frontend/src/components/ui/` and `frontend/src/components/table/`
- **Living catalogue (dev server only):** `http://localhost:5173/_design-system` — every section renders the real shared component, in light and dark. It is registered only when `import.meta.env.DEV` is true and is absent from production builds.
- **Guardrails:** `frontend/src/test/designSystem.test.ts` (run with `npm test`)
- **Scope:** the signed-in app. The public marketing site has its own palette in `routes/marketing/marketing.css` and is deliberately separate.

## 1. Principles

1. **Tokens, not literals.** Colours, radii, type sizes and z-indexes come from tokens. No new `#rrggbb` values or Tailwind palette classes (`text-red-700`) in screens.
2. **One component per job.** Use the shared Button, Badge/StatusBadge, Dialog/ConfirmDialog, Pagination, EmptyState/ErrorState/Skeleton. Do not hand-roll a second version.
3. **Tactile where it earns its place.** Raised/embossed surfaces are for hero elements (Dashboard widgets, primary buttons, dialogs). Dense list, table and form screens stay flat and calm.
4. **State is never colour alone.** Status colours are reserved for state and always travel with text, and with an icon when using `StatusBadge`.
5. **Mobile is a layout, not a shrink.** Below `md` (768px): bottom tab bar, bottom-sheet dialogs, card rows instead of tables, 44px touch targets, 16px inputs.
6. **Both themes, always.** Every colour token has a light and a dark value. Check new UI in both.

## 2. Colour

All colours are CSS custom properties on `:root`, overridden for dark mode. Dark values live in **two** blocks (OS preference and forced `data-theme="dark"`); the test suite fails if the two drift or if a status/chart token lacks a dark value.

| Role | Token(s) | Light | Notes |
|---|---|---|---|
| Page / text | `--background`, `--foreground` | `#ffffff` / `#0a0a0a` | |
| Secondary text | `--muted-foreground` | `#5f5f68` | 6.3:1 on white |
| Muted surface | `--muted` | `#f4f4f5` | table header, hover |
| Border | `--border` | `#e4e4e7` | |
| Primary (ink) | `--primary` / `--primary-foreground` | `#111827` / `#f9fafb` | default button fill (deep navy ink) |
| Accent | `--brand`, `--brand-muted`, `--link` | `#2a78d6`, `#eaf1fb`, `#15539e` | `--brand` for icons/active states; **`--link` for small text** (4.42:1 for `--brand` on white fails AA) |
| Destructive | `--destructive` | `#dc2626` | |
| Focus ring | `--ring` | `#a1a1aa` | applied as `outline`, not `box-shadow` |
| Sidebar | `--sidebar-*` | dark navy `#11182b` | fixed dark in both themes |
| Tactile | `--tactile-surface`, `-raised`, `-highlight`, `-shadow-dark`, `-shadow-darker` | see file | independent dark variants |

### Status colours (reserved)

Each has a foreground and a tinted background. Never reuse them as chart series colours.

| State | Tokens | Light fg on bg | Dark fg on bg |
|---|---|---|---|
| Success | `--status-good` / `-bg` | 5.45 : 1 | 8.16 : 1 |
| Warning | `--status-warning` / `-bg` | 4.58 : 1 | 7.48 : 1 |
| Error | `--status-serious` / `-bg` | 5.51 : 1 | 5.88 : 1 |
| Information | `--status-info` / `-bg` | 5.85 : 1 | 7.69 : 1 |
| Critical | `--status-critical` / `-bg` | 7.77 : 1 | 7.10 : 1 |
| Neutral | `--status-neutral` / `-bg` | 6.85 : 1 | 6.12 : 1 |

(Ratios computed from the token values; WCAG AA for text is 4.5 : 1.)

### Chart chrome

`--chart-grid`, `--chart-axis-text`, `--chart-axis-line`, `--chart-tooltip-bg`, `--chart-tooltip-border` replace the per-page `isDark ? '#…' : '#…'` ternaries in Recharts props. Series colours follow the dataviz rules (fixed order, validated palette) and are not tokens here. Colour follows the entity (a status keeps its palette slot whichever statuses exist). Charts must read the theme from `useThemePreference()` (the in-app toggle), never from `prefers-color-scheme` alone.

## 3. Typography

Font: **Inter Variable**, self-hosted from `@fontsource-variable/inter` (imported once in `main.tsx`; no external font CDN), at a 15px base. The token is `--font-sans: "Inter Variable", "Inter Fallback", system-ui, "Segoe UI", Roboto, sans-serif`. "Inter Fallback" is a local Arial face with `size-adjust: 107.4%` and matched ascent/descent so the swap from fallback to Inter does not move layout; `font-display: swap` comes from the fontsource face, and the latin subset (about 48 KB) is preloaded from `index.html`. Other subsets download only when a page needs those characters. The marketing site uses the same font family. Use the token (`var(--font-sans)`), never a hard-coded font stack.

| Role | Class | Size / line / weight | Tailwind equivalent |
|---|---|---|---|
| Page title | `qth-type-page-title` | 18 / 28 / 600 | `text-lg font-semibold` |
| Section title | `qth-type-section-title` | 16 / 24 / 600 | `text-base font-semibold` |
| Card heading | `qth-type-card-heading` | 14 / 20 / 600 | `text-sm font-semibold` |
| Body | `qth-type-body` | 14 / 20 / 400 | `text-sm` |
| Label | `qth-type-label` | 12 / 16 / 500 | `text-xs font-medium` |
| Helper | `qth-type-helper` | 12 / 16, muted | `text-xs text-[var(--muted-foreground)]` |
| Table header | `qth-type-table-head` | 12 / – / 500, muted | `text-xs font-medium` |
| Table value | `qth-type-table-value` | 14 | `text-sm` |
| Button | – | 14 / 500 | built into `Button` |
| Overline | `qth-type-overline` | 11 / 600, uppercase | nav group labels only |

The classes sit in `@layer components`, so a Tailwind utility on the same element still wins for a genuine one-off. Avoid `text-[10px]`; 11px (`--type-micro-size`) is the floor and only for overlines and `<kbd>` hints.

## 4. Spacing, radius, elevation, motion, layers

- **Spacing:** Tailwind's 4px scale. Page gutter 16px (`p-4`) below `md`, 24px (`p-6`) from `md`. Stack page sections with `gap-4`. Tokens: `--space-1…--space-10`, `--page-gutter`.
- **Control height:** one scale — small 32px (toolbar and row actions, menu triggers), default 36px (inputs, header actions), large 40px (page tabs), **44px on phones** (`max-md:`). Anything else (30px, 38px) is a defect; the Phase G sweep found none on any route at 1280px.
- **Radius:** `--radius-control` 6px (buttons, inputs, tabs) · `--radius-card` 8px (cards, tables, menus) · `--radius-panel` 12px (dialogs, embossed cards) · `--radius-sheet` 16px (phone sheets) · `--radius-pill` (badges).
- **Elevation:** `qth-raised-sm|md|lg`, `qth-pressed-sm|md`, `qth-texture`. Light source is fixed top-left. Flat `Card` uses `shadow-sm`.
- **Motion:** `--motion-fast` 120ms, `--motion-base` 150ms, `--motion-slow` 200ms, `--ease-standard`. All collapse to 0 under `prefers-reduced-motion`; use `motion-reduce:` on any new transition. Animate only to explain a state change.
- **Z-index ladder:** sticky 10 · dropdown 30 · backdrop 40 · overlay (dialogs, sidebar) 50 · toast and skip-link 100. Do not invent other values.
- **Breakpoints:** `sm` 640 · `md` 768 (phone ↔ tablet; shell, sheets and card lists switch here) · `lg` 1024 · `xl` 1280 · `2xl` 1536.

## 5. Component catalogue

| Need | Component | File | Rules |
|---|---|---|---|
| Action | `Button` (`default`, `outline`, `ghost`, `destructive`; sizes `sm`, `default`, `lg`, `icon`) | `ui/button.tsx` | One primary per view, rightmost. `outline` = secondary, `ghost` = tertiary. Icon-only buttons need `aria-label`. For link-as-button use `buttonVariants()`. |
| Hero action | `TactileButton` | `ui/TactileButton.tsx` | Dashboard/hero only. |
| Text input | `Input`, `Textarea`, `Select`, `Label` | `ui/input.tsx` … | Inset "well" look; 36px on desktop (32px `h-8` only for an inline control inside a table row), 44px / 16px text on phones. `aria-invalid="true"` turns the border red. Every field has a visible label or `aria-label` — a placeholder is never the label. |
| Form row | `FormField`, `FormError` | `ui/form-field.tsx` | Label (+ required marker), the control, helper text and the error under it, wired with `aria-describedby` / `aria-invalid`; errors are `role="alert"`. `FormError` is the form-level (server) message above the submit button. |
| Date range | `DateRangePicker` | `ui/date-range-picker.tsx` | |
| Page title block | `PageHeader` | `ui/PageHeader.tsx` | One `<h1>`, optional description and meta, actions right, optional `back` link above the title and `actionsClassName` (e.g. a phone grid). Breadcrumb lives in the shell header. Used on every signed-in screen except the Execution Console workspace panel, the print-only Compliance report and the 404. |
| Card | `Card` / `CardHeader` / `CardTitle` / `CardContent` | `ui/card.tsx` | Flat, for dense screens. `CardTitle` renders an `<h2>` by default; pass `as="h3"` when the card sits under another section heading so levels never skip. |
| Hero card | `EmbossedCard`, `GaugeDial` | `ui/` | Dashboard widgets only. |
| Tabs | `Tabs` | `ui/tabs.tsx` | |
| Label / count | `Badge` (`neutral`, `positive`, `warning`, `critical`, `info`) | `ui/badge.tsx` | Plain labels, roles, counts. |
| State | `StatusBadge` | `ui/StatusBadge.tsx` | Anything that is a state; adds an icon. Pick the tone from one mapping per domain (`statusDisplay.ts`), never at the call site. |
| Chart card | `ChartPanel`, `ChartLegend`, `RangeControl` | `ui/ChartPanel.tsx` | Every chart: title, optional range control, "View as table" alternative, screen-reader summary, fixed-height body, HTML legend with values beside labels. Loading, empty and error states go inside it. |
| Table | `ResponsiveTable` (+ `FilterBar`, `FilterField`) | `table/` | Table on desktop, cards on phones. Column config drives both. `label` names the `<table>` (and the card list) for screen readers — always pass it. Above 25 rows the table scrolls inside a 70svh box so the header row stays visible. Links and buttons inside a phone card are 44px tall (`.qth-card`). |
| Pagination | `Pagination` (page numbers) · "Load more" (cursor lists) | `ui/pagination.tsx` | |
| Dialog | `Dialog`, `DialogFooter`, `Drawer`, `useReportDirty` | `ui/dialog.tsx`, `ui/dirtyForm.ts` | Bottom sheet on phones. Always end with `DialogFooter`. A form inside calls `useReportDirty(form.formState.isDirty)`; Escape, the backdrop and the X then ask "Discard unsaved changes?" instead of dropping the edits. |
| Confirmation | `ConfirmDialog` | `ui/confirm-dialog.tsx` | Required before deleting, deactivating, revoking, removing. `requireText` for irreversible/high-impact actions. |
| Tooltip | `Tooltip` | `ui/tooltip.tsx` | Keyboard + hover; replaces `title=` for anything that matters (`content={null}` renders just the trigger, for a conditional hint). The trigger keeps its own accessible name; if the text must reach a disabled control, put it in the control's `aria-label`. |
| Loading | `Skeleton`, `TableSkeleton`, `ChartSkeleton`, `CardSkeleton` | `ui/skeleton.tsx` | Never a bare "Loading…". |
| Empty / error | `EmptyState`, `ErrorState` | `ui/empty-state.tsx` | Every list: loading → error (with retry) → empty (with next action) → data. |
| Feedback | `useToast().show('success' \| 'error' \| 'info' \| 'warning', msg)` | `lib/toast.tsx` | Confirm every mutation outcome. Errors are `role="alert"`, the rest `role="status"`; the 4s timer pauses on hover/focus, each toast has a dismiss button and Escape clears them; below `md` the stack sits above the tab bar and safe area. |
| Navigation | `AppShell`, `MobileNav`, `Breadcrumbs`, `CommandPalette`, `GlobalSearch` | `routes/AppShell.tsx`, `components/` | See "Shell rules" below. |

## 6. Patterns

**List screen:** `PageHeader` → `FilterBar` (+ search) → `ResponsiveTable` → `Pagination`. States: skeleton while loading, `ErrorState` on failure, `EmptyState` when nothing matches (distinguish "no data yet" from "no results for these filters").

**Detail screen:** `PageHeader` (title, status `StatusBadge`, actions) → main content with side panels stacking below on phones → tabs for secondary data.

**Form:** build each row with `FormField` (label above, required marker, helper text and the validation message under the control, `aria-invalid` / `aria-describedby` wired for you). Show every validation message — never let a field fail silently. Use `noValidate` with a zod resolver so the browser's own popups don't compete. Group with section headings; primary submit rightmost (pinned in `DialogFooter` on phones); disable submit while pending; keep entered values on failure; report dirtiness with `useReportDirty` so a stray Escape cannot discard work. Server errors go in `FormError`.

**Destructive action:** `Button variant="destructive"` opens `ConfirmDialog`; the mutation runs only on confirm; success toast; failure toast and the dialog stays open.

### Shell rules (Phase C)

- **Header controls by width:** below `md` the header is breadcrumb + search icon + bell (the rest lives in the More sheet); `md`–`lg` adds Ask AI (icon), theme and account (icon); the inline search field starts at `lg`; the "Jump to… Ctrl K" hint, the "Ask AI" label and the visible "Name · role" account text start at `xl`. Header height is fixed at 56px from `md`. Never add a control to the header without checking 768px.
- **Account menu:** the accessible name starts with the visible text ("Name · role account menu") so voice-control users can say what they see (WCAG 2.5.3).
- **Sidebar:** one entry per destination (Settings is only in Administration; Profile has its own icon). The active item has a tinted fill **and** a 3px accent bar. Collapsed links keep an `aria-label` and show a tooltip on hover and focus (Escape hides it). Items that leave the shell (`newTab: true`, e.g. Compliance Reports) open in a new tab, show an external-link icon and announce "(opens in a new tab)". Groups are not collapsible: the longest group has five items, so collapsing would only add clicks.
- **Tablet layouts:** three-panel workspaces (Execution Console) switch from stacked to side-by-side at `xl` (1280px), not `md`/`lg`: next to the sidebar only ~480px (768) or ~740px (1024) of content width remain, which clips the verdict buttons in three columns.

## 7. Accessibility baseline

- Visible focus on every interactive element (outline, `--ring`).
- One `<h1>` per page; headings do not skip levels.
- Icon-only controls have an accessible name.
- Dialogs trap focus, close on Escape, return focus (built into `Dialog`).
- Contrast: text ≥ 4.5 : 1, status pairs verified above.
- Touch targets ≥ 44px on phones.
- Respect `prefers-reduced-motion`.

## 8. Do and don't

| Do | Don't |
|---|---|
| `bg-[var(--status-good-bg)]` / `<StatusBadge tone="positive">` | `bg-emerald-50`, `#10b981` |
| Chart axis `fill="var(--chart-axis-text)"` | `isDark ? '#c3c2b7' : '#52514e'` |
| `<ConfirmDialog destructive>` before delete | `onClick={() => deleteMutation.mutate()}` |
| `<PageHeader title="…" actions={…}/>` | A fresh `<div><h1 className="…">` per page |
| `<Pagination …/>` | A copy of the Previous/Next block |
| `<Tooltip>` for hints | `title="…"` as the only explanation |
| `rounded-md` controls, `rounded-lg` cards, `rounded-xl` panels | `rounded`, `rounded-sm`, arbitrary radii, `text-[10px]` (guard test fails) |
| `buttonVariants({ variant: 'outline', size: 'sm' })` on a link that looks like a button | Re-typing `rounded-md border px-3 py-2 …` on an `<a>` |
| `<FormField>` + `<FormError>` | `<p className="text-xs text-[var(--destructive)]">` next to a field |
| `aria-label` / `FormField` on every input | A placeholder as the only label |

## 9. Guardrails and how to extend

- `designSystem.test.ts` checks (1) the two dark-mode token blocks stay identical and that status/chart tokens have dark values; (2) a **ratchet** on hard-coded colours per file — counts may only go down. When you migrate a file to tokens, lower its number in `HARD_CODED_COLOUR_BASELINE`.
- The same test enforces the **radius and type scale**: no bare `rounded` / `rounded-sm` and no `text-[10px]` in signed-in screens (zero allowed; it was normalised in Phase F).
- Adding a colour token: add it to `:root` **and both dark blocks**, add it to the catalogue, document it here.
- Adding a component: check this table first; add it to `/_design-system` and to this file.
- Run `npm run typecheck && npm run lint && npm test` before committing.

## 10. Known gaps (tracked in `docs/UI_UX_AUDIT_REPORT.md`)

Page headers (Phase C), the Dashboard (Phase D), status colours and chart colours (Phase E), and radius, type, control heights, table names, input labels and form errors (Phase F) are migrated. `FormField` is adopted on the Project and Test Case forms; the other forms (Settings, user invite, requirements, defects, auth screens) still hand-build their rows and only use `FormError` — move them across when they are next touched. Row-level controls (`h-8`) and small inline text links are the remaining places where control height is a deliberate exception. Phase G: dirty-form protection also covers dialogs whose state lives in a parent (`ReportDirty`); Defects and the Runs overview page on the client in 50s (server-side paging would need a backend change); control heights are on one scale.


## Phase E additions

- **`useConfirm()`** (`components/ui/useConfirm.tsx`): the way to put a destructive action behind `ConfirmDialog` from a list row. `ask({ title, description, confirmLabel, requireText?, destructive?, run })`; return the mutation promise from `run` so the dialog stays open and disabled until it settles. Say what is lost and whether it can be undone. Use `requireText` only for irreversible, high-blast-radius actions (deleting a project).
- **`Button variant="success"`** with `--success-solid` / `--success-solid-foreground`: the solid positive action (Execution Console Pass). Do not use `bg-emerald-*`.
- **`lib/statusTones.ts`**: one tone mapping for values shared across screens (`levelTone` for priority and severity, `RUN_CASE_STATUS_TONE`, `VERDICT_TONE`). Add a mapping here, not at the call site. Render states with `StatusBadge`.
- **`Label required`**: the one required-field marker.
- **`DetailSkeleton`**, `ErrorState`, `EmptyState`: the loading, failure and not-found states of a detail screen.
- **Overlays stack**: `useOverlayBehavior` lets only the topmost overlay handle Escape and Tab, so a confirmation can open from inside a dialog.

## Phase G additions

- **`lazyRoute()` and `RouteBoundary`:** how every signed-in screen is loaded. New screens are added with `lazyRoute(() => import('...'), 'Name')` in `App.tsx`; do not import a screen statically. `RouteBoundary` gives a skeleton while it loads and a retry state if it fails.
- **`usePrefersReducedMotion()`:** for JS-driven animation (Recharts `isAnimationActive`). CSS animation is already flattened by the reduced-motion rule in `index.css`.
- **`useCanListUsers()`:** gate for any screen that only needs `GET /users` to resolve names.
- **`ReportDirty`:** use when the form state lives outside the Dialog/Drawer that contains the form.
- **`Tabs`:** arrow keys, Home and End work; keep using it rather than a hand-built tab strip.
- **Font:** `--font-sans` (Inter Variable with a metric-matched fallback); see Typography.
- **Skeletons that precede layout must reserve the loaded height** (see the Dashboard headline row); a skeleton shorter than its content is a layout-shift bug.

## Phase F additions

- **`FormField` / `FormError`** (`ui/form-field.tsx`): one form row — label, control, helper, error — with the accessibility wiring done for you.
- **`useReportDirty`** (`ui/dirtyForm.ts`) + the discard prompt in `Dialog` / `Drawer`: an unsaved-changes guard for any form rendered inside an overlay.
- **Control heights:** `Button` default 36px, `sm` 32px (toolbar and row actions), inputs 36px; link-buttons use `buttonVariants()`. The two 28px row selects were raised to 32px.
- **Tables:** `ResponsiveTable` names its `<table>`; long tables keep a sticky header by scrolling inside a region; phone cards (`.qth-card`) make inner links and buttons 44px and lift them above the stretched title link.
- **Tooltips:** the remaining native `title=` hints were replaced (`Tooltip`, an accessible name, or removed where the text was already visible).


## Access states and Reports panels (follow-up)

- **Restricted routes:** `lib/routeAccess.ts` is the one list of screens that need more than a signed-in session (`admin` or `manager-or-above`). Add a route there and the sidebar, the mobile More sheet, the command palette and the route gate all follow. The API still enforces access; this only decides what the UI shows.
- **No access:** `components/NoAccess.tsx` (`variant="page"` for the gate, `"inline"` inside a screen). Give a query's `error` to `ErrorState` for a screen's main data and a 403 shows the same message instead of "Couldn't load this". 403s are never retried.
- **Chart-first screens:** on Reports every content panel is tactile (`ChartPanel`, or `EmbossedCard` for stat blocks); the Filters card is a plain control bar. `ChartPanel` takes optional `controls` (a control row under the title) and `footer` (content under the chart).
