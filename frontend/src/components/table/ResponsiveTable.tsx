import { type HTMLAttributes, type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react'

import { ResizableTh } from '@/components/table/ResizableTh'
import { Skeleton, TableSkeleton } from '@/components/ui/skeleton'
import { useIsMobile } from '@/lib/useMediaQuery'
import { cn } from '@/lib/utils'

// Mobile redesign Phase 2: one list definition, two presentations.
//
//   >= md   the same sortable-looking, resizable-column <table> every list had
//           before (markup kept identical so desktop does not change);
//   <  md   a stack of cards -- title, badges, a few "label: value" fields,
//           optional action buttons -- so nothing scrolls sideways on a phone.
//
// A page describes its columns once. The `card` field says what role a column
// plays on a phone; the same `cell` renderer feeds both layouts unless a
// `cardCell` override is given (e.g. a wrapping title instead of a truncated
// one). Only ONE layout is mounted at a time (see useIsMobile).

export interface ResponsiveColumn<T> {
  key: string
  /** Desktop column header (also the field label on a card, if it is a string). */
  header: string
  /** Desktop-only header content (e.g. a sort button); defaults to `header`. */
  headerCell?: ReactNode
  cell: (row: T) => ReactNode
  /** Desktop: cap the cell at the column's pref width (`maxWidth`), as the old tables did. */
  limitWidth?: boolean
  /** Extra classes for the desktop <td> (the base is `px-4 py-2`). */
  tdClassName?: string
  /**
   * Role on a phone card:
   *  - 'title'  the card heading (exactly one column; first one wins)
   *  - 'badge'  a pill shown under the title
   *  - 'meta'   a "label: value" field (default)
   *  - 'none'   desktop-only column
   */
  card?: 'title' | 'badge' | 'meta' | 'none'
  /** Label shown above/next to a meta value; defaults to `header`. */
  cardLabel?: string
  /** Phone card: let this field span the full card width (long values such as emails). */
  cardFull?: boolean
  /** Phone-only renderer (falls back to `cell`). */
  cardCell?: (row: T) => ReactNode
}

export interface ColumnPrefsLike {
  isVisible: (key: string) => boolean
  width: (key: string) => number | undefined
  setWidth: (key: string, width: number) => void
  /** ADR-105: row density; compact only tightens desktop rows. */
  density?: 'comfortable' | 'compact'
}

export interface RowSelection<T> {
  selected: Set<string>
  onToggle: (id: string) => void
  onToggleAll: () => void
  /** Accessible name for a row's checkbox, e.g. `Select ${title}`. */
  label: (row: T) => string
}

/** Classes for a card's title link: the link's ::after stretches over the
 * whole card so the entire card is one big tap target, while the selection
 * checkbox and action buttons (z-10) stay independently tappable. */
export const CARD_LINK_CLASS =
  'flex min-h-11 items-center break-words py-1 text-base font-medium leading-snug after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none after:focus-visible:outline after:focus-visible:outline-2 after:focus-visible:outline-[var(--ring)]'

interface ResponsiveTableProps<T> {
  rows: T[]
  rowKey: (row: T) => string
  columns: ResponsiveColumn<T>[]
  /** Column visibility + resize state (desktop only). Omit for a fixed layout. */
  prefs?: ColumnPrefsLike
  selection?: RowSelection<T>
  /** Trailing per-row actions: a desktop column, a button row on a phone card. */
  rowActions?: (row: T) => ReactNode
  /** Desktop right-click menu. */
  onRowContextMenu?: (event: MouseEvent, row: T) => void
  /** Desktop-only extra <tr> props (e.g. keyboard activation, cursor). */
  rowProps?: (row: T) => HTMLAttributes<HTMLTableRowElement>
  /** Shown instead of rows (empty / error). */
  state?: ReactNode
  /** Classes for the state cell on desktop (the old tables differed per page). */
  stateCellClassName?: string
  loading?: boolean
  /** Name for the card list, read by screen readers. */
  label: string
  /** Extra classes for the desktop scroll wrapper. */
  className?: string
  /** Desktop: 8px instead of 16px of horizontal cell padding, for lists with many default columns. */
  dense?: boolean
}

export function ResponsiveTable<T>(props: ResponsiveTableProps<T>) {
  const isMobile = useIsMobile()
  return isMobile ? <CardList {...props} /> : <DesktopTable {...props} />
}

function DesktopTable<T>({
  rows,
  rowKey,
  columns,
  prefs,
  selection,
  rowActions,
  onRowContextMenu,
  rowProps,
  state,
  stateCellClassName,
  loading,
  label,
  className,
  dense,
}: ResponsiveTableProps<T>) {
  const px = dense ? 'px-2' : 'px-4'
  const visible = columns.filter((c) => !prefs || prefs.isVisible(c.key))
  const colCount = visible.length + (selection ? 1 : 0) + (rowActions ? 1 : 0)
  const scrollInside = rows.length > 25 && !state && !loading

  // A region that actually scrolls sideways (e.g. a wide table at tablet
  // width) must be reachable by keyboard (axe: scrollable-region-focusable).
  // Only tables that really overflow become a tab stop, so short tables add
  // none.
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [overflowsX, setOverflowsX] = useState(false)
  useEffect(() => {
    const el = wrapperRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => setOverflowsX(el.scrollWidth > el.clientWidth + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    if (el.firstElementChild) observer.observe(el.firstElementChild)
    return () => observer.disconnect()
  }, [rows.length, visible.length])
  const focusableScroll = scrollInside || overflowsX

  return (
    <div
      ref={wrapperRef}
      className={cn(
        'overflow-x-auto rounded-lg border border-[var(--border)]',
        // Long tables scroll inside their own box so the header row stays
        // visible (sticky only works against the scrolling ancestor). A
        // scrollable region must be reachable by keyboard.
        scrollInside && 'max-h-[70svh] overflow-y-auto',
        className,
      )}
      {...(focusableScroll ? { tabIndex: 0, role: 'region', 'aria-label': `${label} (scrollable)` } : {})}
    >
      <table
        aria-label={label}
        aria-busy={loading ? true : undefined}
        data-density={prefs?.density ?? 'comfortable'}
        className="w-full text-sm md:data-[density=compact]:[&_td]:py-1.5 md:data-[density=compact]:[&_th]:py-1.5"
      >
        <thead className="sticky top-0 z-10 bg-[var(--muted)] text-left text-xs text-[var(--muted-foreground)]">
          <tr>
            {selection && (
              <th className={cn('w-10 py-2', px)}>
                <input
                  type="checkbox"
                  aria-label="Select all on this page"
                  checked={rows.length > 0 && rows.every((r) => selection.selected.has(rowKey(r)))}
                  onChange={selection.onToggleAll}
                />
              </th>
            )}
            {visible.map((c) =>
              prefs ? (
                <ResizableTh key={c.key} width={prefs.width(c.key)} onResize={(w) => prefs.setWidth(c.key, w)} className={dense ? 'px-2' : undefined}>
                  {c.headerCell ?? c.header}
                </ResizableTh>
              ) : (
                <th key={c.key} className={cn('py-2 font-medium', px)}>
                  {c.headerCell ?? c.header}
                </th>
              ),
            )}
            {rowActions && (
              <th className={cn('py-2 font-medium', px)}>
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {state ? (
            <tr>
              <td colSpan={colCount} className={stateCellClassName ?? 'px-4'}>
                {state}
              </td>
            </tr>
          ) : loading ? (
            <TableSkeleton columns={colCount} />
          ) : (
            rows.map((row) => {
              const id = rowKey(row)
              const extra = rowProps?.(row)
              return (
                <tr
                  key={id}
                  {...extra}
                  className={cn('border-t border-[var(--border)] hover:bg-[var(--muted)]', extra?.className)}
                  onContextMenu={onRowContextMenu ? (e) => onRowContextMenu(e, row) : undefined}
                >
                  {selection && (
                    <td className={cn('py-2', px)}>
                      <input
                        type="checkbox"
                        aria-label={selection.label(row)}
                        checked={selection.selected.has(id)}
                        onChange={() => selection.onToggle(id)}
                      />
                    </td>
                  )}
                  {visible.map((c) => (
                    <td
                      key={c.key}
                      className={cn('py-2', px, c.tdClassName)}
                      style={c.limitWidth && prefs ? { maxWidth: prefs.width(c.key) } : undefined}
                    >
                      {c.cell(row)}
                    </td>
                  ))}
                  {rowActions && <td className={cn('py-2 text-right', px)}>{rowActions(row)}</td>}
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}

function CardList<T>({
  rows,
  rowKey,
  columns,
  selection,
  rowActions,
  state,
  loading,
  label,
}: ResponsiveTableProps<T>) {
  // Phone cards ignore the desktop column-visibility prefs on purpose: the
  // "Columns" menu is hidden on phones, so a column hidden on a desktop
  // browser must not silently vanish from the card view too.
  const titleCol = columns.find((c) => c.card === 'title') ?? columns[0]
  const badgeCols = columns.filter((c) => c.card === 'badge' && c !== titleCol)
  const metaCols = columns.filter(
    (c) => c !== titleCol && (c.card === 'meta' || c.card === undefined),
  )

  if (state) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-3">{state}</div>
    )
  }
  if (loading) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-busy="true">
        <span className="sr-only">Loading {label}</span>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    )
  }

  const allSelected =
    rows.length > 0 && selection !== undefined && rows.every((r) => selection.selected.has(rowKey(r)))

  return (
    <div className="flex flex-col gap-3">
      {selection && rows.length > 0 && (
        <label className="flex min-h-11 items-center gap-3 px-1 text-sm text-[var(--muted-foreground)]">
          <input
            type="checkbox"
            aria-label="Select all on this page"
            checked={allSelected}
            onChange={selection.onToggleAll}
          />
          Select all
        </label>
      )}
      <ul aria-label={label} className="flex flex-col gap-3">
        {rows.map((row) => {
          const id = rowKey(row)
          const isSelected = selection?.selected.has(id) ?? false
          const actions = rowActions?.(row)
          return (
            <li
              key={id}
              className={cn(
                'qth-card qth-raised-sm relative rounded-xl border bg-[var(--background)] p-3',
                isSelected ? 'border-[var(--ring)]' : 'border-[var(--border)]',
              )}
            >
              <div className="flex items-start gap-1">
                {selection && (
                  <label className="qth-hit relative z-10 -ml-2 -mt-1.5 shrink-0">
                    <input
                      type="checkbox"
                      aria-label={selection.label(row)}
                      checked={isSelected}
                      onChange={() => selection.onToggle(id)}
                    />
                  </label>
                )}
                <div className="min-w-0 flex-1">{(titleCol.cardCell ?? titleCol.cell)(row)}</div>
              </div>

              {badgeCols.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {badgeCols.map((c) => (
                    <span key={c.key}>{(c.cardCell ?? c.cell)(row)}</span>
                  ))}
                </div>
              )}

              {metaCols.length > 0 && (
                <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                  {metaCols.map((c) => (
                    <div key={c.key} className={cn('min-w-0', c.cardFull && 'col-span-2')}>
                      <dt className="text-[var(--muted-foreground)]">{c.cardLabel ?? c.header}</dt>
                      <dd className="mt-0.5 min-w-0 break-words text-[var(--foreground)]">
                        {(c.cardCell ?? c.cell)(row)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}

              {actions && (
                <div className="relative z-10 mt-3 flex border-t border-[var(--border)] pt-3 [&>div]:w-full [&>div]:justify-stretch [&_button]:flex-1">
                  {actions}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
