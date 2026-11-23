import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * One collapsible numbered section of a long full-page form (Test Case, Defect): a heading button
 * with the section number, a "n to fix" badge when fields inside have errors, and a body that stays
 * mounted while collapsed so its entries are never lost. The parent owns open / closed state.
 */
export function FormSection({
  idPrefix,
  number,
  title,
  open,
  errorCount,
  onToggle,
  sectionRef,
  children,
}: {
  /** Prefix of the element ids ("tc", "df"). */
  idPrefix: string
  number: number
  title: string
  open: boolean
  errorCount: number
  onToggle: () => void
  sectionRef: (el: HTMLElement | null) => void
  children: ReactNode
}) {
  const bodyId = `${idPrefix}-section-${number}`
  return (
    <section
      ref={sectionRef}
      aria-labelledby={`${bodyId}-title`}
      className="scroll-mt-24 rounded-xl border border-[var(--border)] bg-[var(--card)]"
    >
      <h2 className="m-0">
        <button
          type="button"
          id={`${bodyId}-title`}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
          className="flex min-h-12 w-full items-center gap-2 rounded-xl px-4 py-3 text-left text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ring)]"
        >
          {open ? <ChevronDown className="size-4 shrink-0" aria-hidden="true" /> : <ChevronRight className="size-4 shrink-0" aria-hidden="true" />}
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--muted)] text-xs tabular-nums">{number}</span>
          <span className="min-w-0 flex-1">{title}</span>
          {errorCount > 0 && (
            <span className="rounded-full bg-[var(--status-serious-bg)] px-2 py-0.5 text-xs font-medium text-[var(--status-serious)]">
              {errorCount} to fix
            </span>
          )}
        </button>
      </h2>
      <div id={bodyId} hidden={!open} className={cn('flex-col gap-4 px-4 pb-4', open ? 'flex' : 'hidden')}>
        {children}
      </div>
    </section>
  )
}

