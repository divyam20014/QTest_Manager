import { Button } from '@/components/ui/button'

/**
 * Page-number pagination footer: "Page 2 of 7 (163 projects)" + Previous/Next.
 * Replaces the five hand-copied versions (Projects, Requirements, Test Cases,
 * Platform Admin tenants/leads). `noun` is the singular item name.
 */
export function Pagination({
  page,
  totalPages,
  total,
  noun = 'item',
  pageSize,
  onPageChange,
}: {
  page: number
  totalPages: number
  total: number
  noun?: string
  /** When given, the footer also says which rows are on screen: "Showing 1-25 of 132". */
  pageSize?: number
  onPageChange: (page: number) => void
}) {
  if (total <= 0) return null
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-[var(--muted-foreground)]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
        {pageSize !== undefined && (
          <span aria-live="polite" className="font-medium text-[var(--foreground)]">
            Showing {rangeStart(page, pageSize)}-{rangeEnd(page, pageSize, total)} of {total}
          </span>
        )}
      <span>
        Page {page} of {totalPages} ({total} {noun}
        {total === 1 ? '' : 's'})
      </span>
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        >
          Next
        </Button>
      </div>
    </div>
  )
}

function rangeStart(page: number, pageSize: number): number {
  return (page - 1) * pageSize + 1
}

function rangeEnd(page: number, pageSize: number, total: number): number {
  return Math.min(page * pageSize, total)
}
