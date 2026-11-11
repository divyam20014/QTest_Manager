import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  className?: string
}) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className={cn(
          // Pass 2: a dialog's content can grow taller than the viewport
          // (e.g. the Test Case form after its schema-realignment fields) --
          // without a capped height + internal scroll, the bottom (often
          // the only submit button) ends up permanently unreachable, for a
          // real user on a short screen as much as for Playwright. Found
          // via a real E2E failure during this pass, not anticipated
          // up front.
          'flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg border border-[var(--border)] bg-[var(--background)] shadow-lg',
          className,
        )}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h2 className="mb-4 shrink-0 px-5 pt-5 text-sm font-semibold">{title}</h2>
        <div className="overflow-y-auto px-5 pb-5">{children}</div>
      </div>
    </div>
  )
}
