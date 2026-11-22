import { useId, useRef, useState, type ReactNode } from 'react'

import { ChartActions } from '@/components/ui/ChartActions'
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmbossedCard } from '@/components/ui/EmbossedCard'
import { cn } from '@/lib/utils'

export interface ChartTable {
  /** Visible column headings, first column is the row label. */
  columns: string[]
  rows: (string | number)[][]
}

export interface ChartLegendItem {
  label: string
  color: string
  /** Direct value shown beside the label, e.g. "118 · 74%". */
  value?: string
}

/**
 * Design-system chart card: title, optional header actions (range control),
 * an always-available "View as table" alternative (keyboard / screen-reader
 * / copy-paste users), and a plain-language summary for assistive tech.
 * Callers pass the chart (or its loading / empty / error state) as children;
 * the body keeps one fixed height so switching to the table or from loading
 * to data never shifts the layout.
 */
export function ChartPanel({
  title,
  actions,
  controls,
  footer,
  summary,
  table,
  children,
  className,
  bodyClassName = 'h-56',
  png = true,
}: {
  title: ReactNode
  actions?: ReactNode
  /** Full-width control row between the header and the chart (e.g. metric /
   * group-by selects). Stays visible in the table view too. */
  controls?: ReactNode
  /** Content under the chart body (e.g. per-category summary tiles). */
  footer?: ReactNode
  /** Sentence announced to screen readers, e.g. "Line chart, last 30 days: 312 passes and 41 failures." */
  summary?: string
  /** Omit while loading / empty / error so no empty table is offered. */
  table?: ChartTable
  children: ReactNode
  className?: string
  bodyClassName?: string
  /** Offer "Download PNG" in the "..." menu. Turn off for charts that are not SVG. */
  png?: boolean
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const tableId = useId()
  const bodyRef = useRef<HTMLDivElement>(null)
  const showTable = view === 'table' && table

  return (
    <EmbossedCard className={className}>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-x-3 gap-y-2 space-y-0">
        <CardTitle>{title}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {table && (
            <button
              type="button"
              aria-pressed={view === 'table'}
              aria-controls={tableId}
              onClick={() => setView(view === 'table' ? 'chart' : 'table')}
              className="inline-flex items-center rounded-md px-1.5 text-xs text-[var(--link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] max-md:min-h-11 max-md:text-sm"
            >
              {view === 'table' ? 'View as chart' : 'View as table'}
            </button>
          )}
          {table && typeof title === 'string' && (
            <ChartActions
              title={title}
              table={table}
              png={png && view === 'chart'}
              getSvg={() => bodyRef.current?.querySelector<SVGSVGElement>('svg.recharts-surface') ?? null}
            />
          )}
        </div>
      </CardHeader>
      <CardContent>
        {controls}
        {summary && <p className="sr-only">{summary}</p>}
        <div ref={bodyRef} id={tableId} className={cn(bodyClassName, showTable && 'overflow-auto')}>
          {showTable ? (
            <table className="w-full text-left text-xs">
              <caption className="sr-only">{typeof title === 'string' ? title : 'Chart data'}</caption>
              <thead className="sticky top-0 bg-[var(--tactile-surface-raised)]">
                <tr>
                  {table.columns.map((c) => (
                    <th key={c} scope="col" className="px-2 py-1.5 font-medium text-[var(--muted-foreground)]">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, i) => (
                  <tr key={i} className="border-t border-[var(--border)]">
                    {row.map((cell, j) =>
                      j === 0 ? (
                        <th key={j} scope="row" className="px-2 py-1.5 font-normal">
                          {cell}
                        </th>
                      ) : (
                        <td key={j} className="px-2 py-1.5 tabular-nums">
                          {cell}
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            children
          )}
        </div>
        {footer}
      </CardContent>
    </EmbossedCard>
  )
}

/** HTML legend with the value beside each label -- identity is never
 * colour-only and nothing depends on Recharts' tiny built-in legend. */
export function ChartLegend({ items, className }: { items: ChartLegendItem[]; className?: string }) {
  return (
    <ul className={cn('flex flex-wrap gap-x-4 gap-y-1 text-xs', className)}>
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: item.color }} />
          <span className="text-[var(--muted-foreground)]">{item.label}</span>
          {item.value && <span className="font-medium tabular-nums">{item.value}</span>}
        </li>
      ))}
    </ul>
  )
}

/** Small segmented control for a chart's range (7 / 30 / 90 days...). */
export function RangeControl<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="qth-pressed-sm inline-flex rounded-lg bg-[var(--muted)] p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)] motion-reduce:transition-none max-md:min-h-11 max-md:min-w-11',
            o.value === value
              ? 'qth-raised-sm bg-[var(--tactile-surface-raised)] text-[var(--foreground)]'
              : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
