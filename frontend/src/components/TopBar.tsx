import { PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react'

import { Breadcrumbs } from '@/components/Breadcrumbs'
import { NotificationBell } from '@/components/NotificationBell'
import { QuickCreateMenu } from '@/components/QuickCreateMenu'
import { IconButton } from '@/components/ui/icon-button'
import { UserMenu } from '@/components/UserMenu'
import { useAuth } from '@/lib/auth'

/** "Ctrl K" (or the Command symbol on Apple devices), shown beside the search field. */
function shortcutHint(): string {
  const platform = typeof navigator === 'undefined' ? '' : navigator.platform || navigator.userAgent
  return /Mac|iPhone|iPad/i.test(platform) ? '⌘ K' : 'Ctrl K'
}

/**
 * The calm top bar (ADR-121): one 56px row with a fixed set of controls.
 *   left   sidebar toggle (md+) and the breadcrumb (current page only on phones)
 *   centre one wide search field that opens the command palette (lg+); an icon below lg
 *   right  "+ New" (the only filled control), notifications, the account menu
 * Appearance, Ask AI and sign out live in the account menu; the User Guide stays in the
 * sidebar footer. Controls are 36px (44px on phones).
 */
export function TopBar({
  collapsed,
  onToggleSidebar,
  onOpenPalette,
  onLogout,
}: {
  collapsed: boolean
  onToggleSidebar: () => void
  onOpenPalette: () => void
  onLogout: () => void
}) {
  const { user } = useAuth()
  return (
    <header
      data-testid="top-bar"
      className="qth-shell-chrome flex min-h-14 items-center gap-3 overflow-x-clip border-b border-[var(--border)] bg-[var(--background)] px-4 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] md:h-14 md:px-6 md:py-0 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)_auto]"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <IconButton
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={onToggleSidebar}
          tooltipSide="bottom"
          className="max-md:hidden"
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </IconButton>
        <Breadcrumbs />
      </div>

      <div role="search" className="hidden w-64 shrink lg:block xl:w-full">
        <button
          type="button"
          onClick={onOpenPalette}
          className="flex h-9 w-full items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--muted)]/50 px-3 text-sm text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] motion-reduce:transition-none"
        >
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">Search cases, defects, projects, runs…</span>
          <kbd className="ml-auto shrink-0 rounded-md border border-[var(--border)] bg-[var(--background)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--muted-foreground)]">
            {shortcutHint()}
          </kbd>
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 justify-self-end">
        <IconButton aria-label="Search" onClick={onOpenPalette} tooltipSide="bottom" className="lg:hidden">
          <Search />
        </IconButton>
        <QuickCreateMenu />
        <NotificationBell />
        <div className="hidden md:block">
          <UserMenu name={user?.name} role={user?.role} onLogout={onLogout} />
        </div>
      </div>
    </header>
  )
}
