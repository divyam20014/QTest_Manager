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
  onPageChange,
}: {
  page: number
  totalPages: number
  total: number
  noun?: string
  onPageChange: (page: number) => void
}) {
  if (total <= 0) return null
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-[var(--muted-foreground)]">
      <span>
        Page {page} of {totalPages} ({total} {noun}
        {total === 1 ? '' : 's'})
      </span>
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
