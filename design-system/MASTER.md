# QTestHub design system: MASTER

Source of truth for UI work. Style: **Minimalism & Swiss, enterprise clean** (Linear / Vercel / Jira feel). Light first, dark supported. Existing themes (ADR-100) stay selectable; **Minimal** is the default look. Per-page overrides go in `design-system/pages/<page>.md` and win over this file.

## 1. Tokens (defined in `frontend/src/index.css`; never hard-code values in components)
| Role | Light | Notes |
|---|---|---|
| Page background | `#F8FAFC` | cards `#FFFFFF` |
| Border | `#E5E7EB` | 1px; no or very faint shadow |
| Text | slate-900 | muted `#475569` (>= 4.5:1) |
| Primary | `#1E40AF` | hover `#1D4ED8`; ring 2px primary |
| Accent | amber `#D97706` | rare highlight only |
| Status | success / warning / danger / info | status only, always with icon + label |
- Dark mode: own tonal steps from the same ramps (desaturated, not inverted); contrast checked separately.
- Spacing: 4px base (4 8 12 16 24 32 48). Radius 6-8px. Type scale 12 / 14 / 15 / 22.
- Font: **Inter** (variable, already bundled), tabular numbers for data (`font-variant-numeric: tabular-nums`). Page title 22 semibold, section title 15 semibold, body 14, meta 12 muted. Mono only for IDs/code.
- Motion: 150-200ms, transform and opacity only, exit faster than enter, honour `prefers-reduced-motion`.
- Icons: Lucide only, one stroke weight, 16px inline / 20px nav. No emoji icons. Decorative icons `aria-hidden`.

## 2. Component rules
- **Button**: primary / secondary / ghost / danger; sm (32px) and md (36-40px; 44-48px on phones). One primary action per page/dialog. `loading` state disables.
- **IconButton**: always `aria-label` plus tooltip; hit area >= 32px.
- **Select / Combobox / MultiCombobox**: custom, keyboard operable (arrows, Home/End, type-ahead, Esc), `aria-expanded`/`role=listbox`; search box when > 8 options. No native `<select>` in app UI.
- **DateRangePicker**: presets (7d, 30d, This month, Custom), keyboard operable, value shown in the trigger.
- **DropdownMenu**: `role=menu`, roving focus, Esc closes and returns focus. Destructive items separated and in danger colour.
- **Tabs**: tab strip with counts where relevant; `role=tablist`, arrow-key navigation.
- **Toast**: `aria-live=polite`, never steals focus, auto-dismiss 4s (errors stay until dismissed), optional Undo action.
- **Badge / StatusPill**: status = soft-coloured pill; severity/priority = dot + label. Never colour alone.
- **Card**: white, 1px border, interactive cards get hover border + focus ring.
- **Table**: sticky header, row hover, truncation with tooltip, `aria-sort`, no horizontal scroll at 1280px, count "Showing a-b of N".
- **Modal / Drawer**: focus trap, Esc, dirty-form guard, destructive actions confirmed in a modal.
- **EmptyState / ErrorState / Skeleton**: every list and chart has all three.

## 3. Charts
Thin 2px lines/areas, faint gridlines, rounded bar ends, donut limited to 5 categories (else bar). Legend for >= 2 series, hover tooltip reachable by keyboard, "View as table" toggle, CSV/PNG menu, empty and error states. Categorical palette validated for colour-blind separation (dataviz validator); status colours reserved for status.

## 4. Accessibility and layout
WCAG AA contrast, visible 2px focus ring on every interactive element, hover/active/disabled states, targets >= 32px (24px minimum per WCAG 2.2), no horizontal page scroll at 375px, breakpoints 375 / 768 / 1024 / 1280 / 1440, focus moves to main content on route change.

## 6. Implemented components (use these; do not re-invent)
- **Select / Combobox** (`ui/select.tsx`, `ui/combobox.tsx`): `Select` keeps the native `<select>` API (children `<option>`, `onChange`) but renders the custom Combobox, with a hidden native mirror for forms and tests. In Playwright use `getByRole('combobox', { name })` or the `nativeSelect(scope, label)` helper in `e2e/fixtures.ts` to read/choose values.
- **IconButton** (`ui/icon-button.tsx`): required `aria-label`, tooltip, >= 32px hit area.
- **DropdownMenu** (`ui/dropdown-menu.tsx`): `role=menu`, roving focus; used by quick-create, user menu, row/more actions, ExportMenu, ChartActions.
- **Tabs / LinkTabs** (`ui/tabs.tsx`): `Tabs` for in-page state, `LinkTabs` when each tab is a route (Access control, Reports).
- **Toast** (`useToast`): optional `action` (Undo) and persistent errors (no auto-dismiss until closed).
- **List pages** (`components/list`): `ListToolbar` (search + filters + views), `FilterPopover` (filter form), `FilterChips` (removable active filters), `RowDetailDrawer` (quick view without leaving the list). Tables use `ResponsiveTable` with column prefs (`defaultHidden` for low-priority columns) so nothing scrolls horizontally at 1280px.
- **Charts**: `ChartPanel` (title, legend, view-as-table, empty/error states) with `ChartActions` (CSV/PNG menu); PNG background comes from the page background token.
- **ExportMenu** (`ui/ExportMenu.tsx`): single Export dropdown (CSV/PDF/etc.) replacing separate export buttons.
- **Admin**: `AdminLayout` (route layout around all admin pages) plus `AdminSubNav` (left nav on lg+, select on small screens, only sections the user may open).

## 5. Per-page checklist (run on every page changed)
Contrast 4.5:1 text / 3:1 UI, focus ring, hover + disabled states, one primary action, no emoji icons, single icon set, reduced motion, checked at 1440 / 1280 / 768 / 375 in light and dark.
