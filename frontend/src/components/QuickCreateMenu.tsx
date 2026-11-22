import { Plus } from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'

import { DropdownMenu } from '@/components/ui/dropdown-menu'
import { Tooltip } from '@/components/ui/tooltip'
import { useAuth } from '@/lib/auth'
import { getQuickCreateActions, projectIdFromPath } from '@/lib/quickCreate'

/**
 * Top bar "+ New" menu. The entries come from lib/quickCreate.ts, the same list
 * the command palette's Quick actions use, already filtered by permission.
 */
export function QuickCreateMenu() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const actions = getQuickCreateActions(user, projectIdFromPath(pathname))
  if (actions.length === 0) return null

  return (
    <DropdownMenu
      label="Create new"
      align="end"
      items={actions.map((a) => ({ label: a.label, onSelect: () => navigate(a.path) }))}
      trigger={(p) => (
        <Tooltip content="Create new">
          <button
            {...p}
            type="button"
            aria-label="New"
            className="qth-raised-sm qth-tactile-btn inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--primary)] px-2.5 text-sm font-medium text-[var(--primary-foreground)] transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] max-md:size-11 max-md:p-0"
          >
            <Plus aria-hidden="true" className="size-4" />
            <span className="max-md:sr-only">New</span>
          </button>
        </Tooltip>
      )}
    />
  )
}
