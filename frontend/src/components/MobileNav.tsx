import {
  BookOpen,
  Bot,
  Bug,
  ClipboardList,
  FileStack,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  ExternalLink,
  User,
  X,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { type ComponentType, useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

import { getDefectStatusCounts } from '@/api/defects'
import { openDefectCount } from '@/lib/navBadges'
import { getUnreadCount } from '@/api/notifications'
import { AIAssistantPanel } from '@/components/AIAssistantPanel'
import { ThemeToggle } from '@/components/ThemeToggle'
import { useOverlayBehavior } from '@/components/ui/useOverlayBehavior'
import { useAuth } from '@/lib/auth'
import { canAccessPath } from '@/lib/routeAccess'
import { INITIAL_SCROLL_STATE, nextScrollState } from '@/lib/scrollDirection'
import { cn } from '@/lib/utils'

// Mobile redesign Phase 1: below `md` the desktop sidebar is replaced by a
// fixed bottom tab bar (the four most-used destinations, in thumb reach) plus
// a "More" bottom sheet for everything else. Desktop is untouched -- both
// components render `md:hidden`.

export interface MobileNavItem {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  /** Leaves the shell (print page): opens in a new tab with an indicator. */
  newTab?: boolean
  /** One item covering several routes: active on all of them. */
  paths?: string[]
}

export interface MobileNavSection {
  label: string
  items: MobileNavItem[]
}

interface TabItem extends MobileNavItem {
  end?: boolean
}

const MOBILE_TABS: TabItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/test-repository', label: 'Test Cases', icon: FileStack },
  { to: '/test-runs', label: 'Runs', icon: ClipboardList },
  { to: '/defects', label: 'Defects', icon: Bug },
]

const PRIMARY_PATHS = new Set(MOBILE_TABS.map((t) => t.to))

const SAFE_BOTTOM = { paddingBottom: 'env(safe-area-inset-bottom)' }

// Pinned action bars (the Execution Console's verdict bar sits just above this
// bar) must never lose their anchor, so the bar never hides there.
const NEVER_HIDE_PATH = /^\/test-run-cases\//

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** True while the bar should slide away: scrolled down >48px, and not exempt. */
function useScrollHidden(exempt: boolean): boolean {
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    if (exempt) return
    let state = { ...INITIAL_SCROLL_STATE, lastY: window.scrollY }
    function onScroll() {
      if (prefersReducedMotion() || document.querySelector('[role="dialog"][aria-modal="true"]')) {
        state = { ...INITIAL_SCROLL_STATE, lastY: window.scrollY }
        setHidden(false)
        return
      }
      state = nextScrollState(state, window.scrollY)
      setHidden(state.hidden)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [exempt])
  return hidden
}

function TabBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span
      aria-hidden="true"
      data-testid="tab-badge"
      className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--destructive)] px-1 text-[11px] font-semibold leading-none text-[var(--destructive-foreground)]"
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

export function MobileTabBar({ moreOpen, onMore }: { moreOpen: boolean; onMore: () => void }) {
  const { user } = useAuth()
  const location = useLocation()
  const [focusWithin, setFocusWithin] = useState(false)
  const canSeeDefects = !!user && canAccessPath(user, '/defects')
  // Same cache key as the desktop bell, so the unread count is shared.
  const unread = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: getUnreadCount,
    enabled: !!user,
    staleTime: 30_000,
  })
  const defectCounts = useQuery({
    queryKey: ['defects', 'status-counts', 'tab-bar'],
    queryFn: () => getDefectStatusCounts(),
    enabled: canSeeDefects,
    staleTime: 60_000,
  })
  // Everything not Closed or Rejected: the same group as the sidebar badge and the dashboard (ADR-118).
  const openDefects = canSeeDefects ? openDefectCount(defectCounts.data) : 0
  const unreadCount = unread.data?.count ?? 0

  const exempt = moreOpen || focusWithin || NEVER_HIDE_PATH.test(location.pathname)
  const scrollHidden = useScrollHidden(exempt)
  const hidden = scrollHidden && !exempt

  const activeIndex = moreOpen
    ? MOBILE_TABS.length
    : MOBILE_TABS.findIndex((t) => (t.end ? location.pathname === t.to : location.pathname.startsWith(t.to)))

  const itemClass = (active: boolean) =>
    cn(
      'relative z-10 flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[11px] font-medium leading-tight transition-colors motion-reduce:transition-none',
      'outline-offset-[-2px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ring)]',
      active ? 'text-[var(--foreground)]' : 'text-[var(--muted-foreground)] active:bg-[var(--muted)]',
    )

  return (
    <nav
      aria-label="Primary"
      data-hidden={hidden ? 'true' : 'false'}
      onFocusCapture={(e) => setFocusWithin(e.target.matches(':focus-visible'))}
      onBlurCapture={() => setFocusWithin(false)}
      className={cn(
        'qth-shell-chrome qth-raised-md fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--tactile-surface-raised)] transition-transform duration-200 ease-out motion-reduce:transition-none md:hidden',
        hidden && 'translate-y-full',
      )}
      style={{
        ...SAFE_BOTTOM,
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      <div className="relative flex items-stretch gap-1 px-2 py-1.5">
        {/* Sliding indicator: five equal columns, so a pure transform moves it. */}
        <span
          aria-hidden="true"
          data-testid="tab-indicator"
          data-index={activeIndex}
          className="qth-pressed-sm pointer-events-none absolute inset-y-1.5 left-2 rounded-xl bg-[var(--tactile-surface)] transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none"
          style={{
            width: 'calc((100% - 1rem - 1rem) / 5)',
            transform: `translateX(calc(${Math.max(activeIndex, 0)} * (100% + 0.25rem)))`,
            opacity: activeIndex < 0 ? 0 : 1,
          }}
        />
        {MOBILE_TABS.map((tab) => {
          const badge = tab.to === '/defects' ? openDefects : 0
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) => itemClass(isActive && !moreOpen)}
            >
              <span className="relative">
                <tab.icon className="size-5 shrink-0" aria-hidden="true" />
                <TabBadge count={badge} />
              </span>
              <span className="max-w-full truncate">{tab.label}</span>
              {badge > 0 && <span className="sr-only">, {badge} open</span>}
            </NavLink>
          )
        })}
        <button
          type="button"
          onClick={onMore}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className={itemClass(moreOpen)}
        >
          <span className="relative">
            <Menu className="size-5 shrink-0" aria-hidden="true" />
            <TabBadge count={unreadCount} />
          </span>
          <span>More</span>
          {unreadCount > 0 && <span className="sr-only">, {unreadCount} unread</span>}
        </button>
      </div>
    </nav>
  )
}

export function MoreSheet({
  open,
  onClose,
  sections,
  userName,
  userRole,
  onSearch,
  onLogout,
}: {
  open: boolean
  onClose: () => void
  sections: MobileNavSection[]
  userName?: string
  userRole?: string
  onSearch: () => void
  onLogout: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const location = useLocation()
  const { user } = useAuth()

  useOverlayBehavior(open && !aiOpen, onClose, panelRef, closeButtonRef)

  // Any navigation (including browser back) dismisses the sheet.
  const lastPath = useRef(location.pathname)
  useEffect(() => {
    if (lastPath.current !== location.pathname) {
      lastPath.current = location.pathname
      if (open) onClose()
    }
  }, [location.pathname, open, onClose])

  // Lock background scroll while the sheet is open.
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  const rowClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-[var(--foreground)] hover:bg-[var(--muted)]',
      'outline-offset-[-2px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ring)]',
      isActive && 'qth-pressed-sm bg-[var(--tactile-surface)] font-medium',
    )

  const plainRow =
    'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-[var(--foreground)] hover:bg-[var(--muted)] outline-offset-[-2px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ring)]'

  const visible = sections
    .map((s) => ({ ...s, items: s.items.filter((i) => !PRIMARY_PATHS.has(i.to)) }))
    .filter((s) => s.items.length > 0)

  return (
    <>
      {open && (
        <div
          className="qth-shell-chrome qth-animate-in fixed inset-0 z-50 flex items-end bg-[var(--overlay-backdrop)] backdrop-blur-sm md:hidden"
          style={{ animation: 'qth-fade-in 0.15s ease-out' }}
          onClick={onClose}
          role="presentation"
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="More"
            onClick={(e) => e.stopPropagation()}
            className="qth-raised-lg flex max-h-[85svh] w-full flex-col rounded-t-2xl border border-b-0 border-[var(--border)] bg-[var(--tactile-surface-raised)] qth-animate-in"
            style={{ animation: 'qth-sheet-in 0.2s ease-out' }}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{userName ?? 'Account'}</p>
                {userRole && <p className="truncate text-xs capitalize text-[var(--muted-foreground)]">{userRole}</p>}
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={onClose}
                aria-label="Close menu"
                className="flex size-11 shrink-0 items-center justify-center rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-3 py-3">
              <button
                type="button"
                className={plainRow}
                onClick={() => {
                  onClose()
                  onSearch()
                }}
              >
                <Search className="size-4 shrink-0" />
                Search…
              </button>

              {visible.map((section) => (
                <div key={section.label} className="flex flex-col gap-0.5">
                  <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    {section.label}
                  </p>
                  {section.items.map((item) =>
                    item.newTab ? (
                      <a
                        key={item.to}
                        href={item.to}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={rowClass({ isActive: false })}
                      >
                        <item.icon className="size-4 shrink-0" />
                        <span className="truncate">{item.label}</span>
                        <ExternalLink className="ml-auto size-3.5 shrink-0 opacity-70" aria-hidden="true" />
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    ) : (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end
                        className={(state) =>
                          rowClass({ isActive: state.isActive || (item.paths ?? []).some((p) => location.pathname === p || location.pathname.startsWith(p + '/')) })
                        }
                      >
                        <item.icon className="size-4 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </NavLink>
                    ),
                  )}
                </div>
              ))}

              <div className="flex flex-col gap-0.5 border-t border-[var(--border)] pt-3">
                {canAccessPath(user, '/user-guide') && (
                  <NavLink to="/user-guide" className={rowClass}>
                    <BookOpen className="size-4 shrink-0" />
                    User Guide
                  </NavLink>
                )}
                <NavLink to="/account" className={rowClass}>
                  <User className="size-4 shrink-0" />
                  Profile
                </NavLink>
                <button type="button" className={plainRow} onClick={() => setAiOpen(true)}>
                  <Bot className="size-4 shrink-0" />
                  Ask AI
                </button>
                <ThemeToggle showLabel />
              </div>
            </div>

            {/* Phase 2: Sign out is pinned below the scrolling list so it is
                always reachable, however long the admin menu is. */}
            <div
              className="shrink-0 border-t border-[var(--border)] px-3 pt-2"
              style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
            >
              <button type="button" className={cn(plainRow, 'text-[var(--destructive)]')} onClick={onLogout}>
                <LogOut className="size-4 shrink-0" />
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
      <AIAssistantPanel
        hideTrigger
        open={aiOpen}
        onOpenChange={(value) => {
          setAiOpen(value)
          if (value === false) onClose()
        }}
      />
    </>
  )
}
