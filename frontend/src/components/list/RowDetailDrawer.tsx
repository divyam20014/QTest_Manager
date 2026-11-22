import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { buttonVariants } from '@/components/ui/button'
import { Drawer } from '@/components/ui/dialog'
import { snippet } from './rowDetail'

export interface DetailField {
  label: string
  value: ReactNode
}

/** What a list shows in the side drawer for one entity (test case, defect, run, project). */
export interface RowDetailConfig<T> {
  /** Singular, lower-case name used in the link text and drawer label. */
  entity: string
  title: (row: T) => string
  /** Status / priority pills shown under the title. */
  badges?: (row: T) => ReactNode
  fields: (row: T) => DetailField[]
  /** A short description; shown trimmed to ~280 characters. */
  description?: (row: T) => string | null | undefined
  /** The full page for this row. */
  href: (row: T) => string
}

export function RowDetailDrawer<T>({
  row,
  onClose,
  config,
}: {
  /** The row to show; null keeps the drawer closed. */
  row: T | null
  onClose: () => void
  config: RowDetailConfig<T>
}) {
  const description = row ? config.description?.(row) : null
  return (
    <Drawer open={row !== null} onClose={onClose} title={row ? config.title(row) : ''} className="max-w-md">
      {row && (
        <div className="flex flex-col gap-4 text-sm" data-testid="row-detail">
          {config.badges && <div className="flex flex-wrap items-center gap-2">{config.badges(row)}</div>}
          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2.5">
            {config.fields(row).map((field) => (
              <div key={field.label} className="contents">
                <dt className="text-xs text-[var(--muted-foreground)]">{field.label}</dt>
                <dd className="min-w-0 break-words">{field.value ?? '—'}</dd>
              </div>
            ))}
          </dl>
          {description && (
            <div className="flex flex-col gap-1">
              <h3 className="text-xs text-[var(--muted-foreground)]">Description</h3>
              <p className="whitespace-pre-line text-[var(--foreground)]">{snippet(description)}</p>
            </div>
          )}
          <Link to={config.href(row)} className={buttonVariants({ variant: 'default', size: 'sm' }) + ' self-start'}>
            Open full page
          </Link>
        </div>
      )}
    </Drawer>
  )
}
