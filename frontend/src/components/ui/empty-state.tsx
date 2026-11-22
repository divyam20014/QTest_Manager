import type { ReactNode } from 'react'
import { AlertTriangle, Inbox, SearchX } from 'lucide-react'

import { isForbidden } from '@/api/client'
import { NoAccess } from '@/components/NoAccess'
import { Button } from '@/components/ui/button'

/** Shared "nothing to show" block, distinct from the error state below --
 * used when a fetch succeeded but returned zero rows. Pass B UI/UX
 * overhaul (bug #4): every list used to render this inline per-page with
 * slightly different wording; centralized so empty states read
 * consistently and always leave room for a contextual action. */
export function EmptyState({
  title,
  description,
  action,
  variant = 'empty',
}: {
  title: string
  description?: string
  /** The ONE contextual action (create when empty, "Clear filters" when filtered). */
  action?: ReactNode
  /** 'filtered' = rows exist but none match the active filters. */
  variant?: 'empty' | 'filtered'
}) {
  const Icon = variant === 'filtered' ? SearchX : Inbox
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center" data-state={variant}>
      <Icon className="size-7 text-[var(--muted-foreground)]" aria-hidden="true" />
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-[var(--muted-foreground)]">{description}</p>}
      {action}
    </div>
  )
}

/** Shared "the fetch itself failed" block -- distinct from EmptyState so
 * a network/server error never looks identical to "there's genuinely
 * nothing here yet". Always offers a retry.
 *
 * Pass the query's `error` for a screen's primary data: when the API refused
 * it with 403 the user is not allowed to see this, so retrying would only
 * repeat the refusal and the "No access" block is shown instead. */
export function ErrorState({ message, onRetry, error }: { message?: string; onRetry: () => void; error?: unknown }) {
  if (isForbidden(error)) return <NoAccess variant="inline" />
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <AlertTriangle className="size-7 text-[var(--status-serious)]" />
      <p className="text-sm font-medium text-[var(--status-serious)]">Couldn't load this</p>
      <p className="max-w-sm text-sm text-[var(--muted-foreground)]">
        {message ?? 'Something went wrong while fetching this data.'}
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}
