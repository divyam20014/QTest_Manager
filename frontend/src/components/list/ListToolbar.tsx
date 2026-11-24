import { Search } from 'lucide-react'
import type { ReactNode } from 'react'

import { FilterBar } from '@/components/table/FilterBar'
import { Input } from '@/components/ui/input'
import { useIsMobile } from '@/lib/useMediaQuery'
import { FilterChips, type FilterChip } from './FilterChips'
import { FilterPopover } from './FilterPopover'

export interface ListSearch {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  /** Accessible name; defaults to "Search". */
  label?: string
}

/**
 * The one toolbar every list page uses (Defects, Test Cases, Test Runs, Projects):
 *
 *   [ search ........ ] [ Filters (n) ]            [ Saved views ] [ Columns / density ]
 *   Project: Alpha x   Severity: High x   Clear all
 *
 * `filters` holds every filter control; on desktop they sit in the Filters
 * popover, on a phone the existing FilterBar bottom sheet shows the same
 * controls (rendered once, never duplicated). The status tabs live outside the
 * toolbar and are not counted in `activeCount` or the chips.
 */
export function ListToolbar({
  search,
  filters,
  activeCount,
  onClearFilters,
  chips,
  onRemoveChip,
  saved,
  columns,
  quick,
  view,
}: {
  search?: ListSearch
  filters: ReactNode
  /** Filters set in the popover (excluding the search box and the status tabs). */
  activeCount: number
  onClearFilters: () => void
  chips: FilterChip[]
  onRemoveChip: (key: string) => void
  /** Saved filters / views menus. */
  saved?: ReactNode
  /** Column visibility + density menu. */
  columns?: ReactNode
  /** A one-click control kept beside the Filters button (e.g. "All / Assigned to me"); on a phone it moves into the sheet. */
  quick?: ReactNode
  /** ADR-124: the List / Board / Calendar switch (`ViewSwitcher`). Shown before the saved views; on a phone it gets its own row above the toolbar. */
  view?: ReactNode
}) {
  const isMobile = useIsMobile()
  const searchBox = search && (
    <div className="relative min-w-[12rem] flex-1 md:max-w-sm">
      <label htmlFor={search.id} className="sr-only">
        {search.label ?? 'Search'}
      </label>
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]"
        aria-hidden="true"
      />
      <Input
        id={search.id}
        type="search"
        inputMode="search"
        enterKeyHint="search"
        placeholder={search.placeholder}
        value={search.value}
        onChange={(e) => search.onChange(e.target.value)}
        className="w-full pl-8"
      />
    </div>
  )

  return (
    <div className="flex flex-col gap-2">
      {isMobile ? (
        <>
        {view}
        <FilterBar activeCount={activeCount} onClear={onClearFilters} primary={searchBox} saved={saved}>
          {quick}
          {filters}
        </FilterBar>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {searchBox}
          {quick}
          <FilterPopover activeCount={activeCount} onClear={onClearFilters}>
            {filters}
          </FilterPopover>
          {(saved || columns || view) && (
            <div className="ml-auto flex items-center gap-2">
              {view}
              {saved}
              {columns}
            </div>
          )}
        </div>
      )}
      <FilterChips chips={chips} onRemove={onRemoveChip} onClearAll={onClearFilters} />
    </div>
  )
}

/** A filter control with a visible caption (the control keeps its own accessible name). */
export function ListFilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span aria-hidden="true" className="text-xs text-[var(--muted-foreground)]">
        {label}
      </span>
      {children}
    </div>
  )
}
