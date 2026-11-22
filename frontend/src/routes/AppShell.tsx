import { useMutation, useQuery } from '@tanstack/react-query'
import {
  BarChart3,
  BookOpen,
  Bug,
  Building2,
  ClipboardList,
  FileStack,
  LayoutDashboard,
  Search,
  MonitorPlay,
  ExternalLink,
  UserCircle,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  UserCog,
} from 'lucide-react'
import { type ComponentType, type CSSProperties, useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { logout } from '@/api/auth'
import { getDefectStatusCounts } from '@/api/defects'
import { getBranding, getLogoUrl } from '@/api/settings'
import { AIAssistantPanel } from '@/components/AIAssistantPanel'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { CommandPalette } from '@/components/CommandPalette'
import { RouteBoundary } from '@/components/RouteBoundary'
import { GlobalSearch } from '@/components/GlobalSearch'
import { NotificationBell } from '@/components/NotificationBell'
import { QuickCreateMenu } from '@/components/QuickCreateMenu'
import { ThemeToggle } from '@/components/ThemeToggle'
import { MobileTabBar, MoreSheet } from '@/components/MobileNav'
import { NoAccess } from '@/components/NoAccess'
import { UserMenu } from '@/components/UserMenu'
import { AccessRuleBanner } from '@/components/AccessRuleBanner'
import { ADMIN_SECTIONS } from '@/lib/adminSections'
import { canAccessPath } from '@/lib/routeAccess'
import { navBadgeLabel, navBadgeText, openDefectCount } from '@/lib/navBadges'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth'

interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  end?: boolean
  // UX-025: the item leaves the shell (a print-optimised page), so it opens
  // in a new tab and says so.
  newTab?: boolean
  // ADR-108 follow-up: one item covering several routes (`to` is the default
  // target). It shows if any is reachable, links to the first that is, and is
  // active on all of them.
  paths?: string[]
  // Open-item count shown as a badge (computed by the shell, not stored here).
  count?: number
  countNoun?: string
}

interface NavSection {
  label: string
  items: NavItem[]
}

export type { NavItem, NavSection }

// Information architecture per the product's enterprise-QA-platform
// redesign brief: grouped sections (Workspace / Test Management /
// Analytics / Administration) rather than a flat list. Which items a role
// sees is not stored here: lib/routeAccess.ts is the single definition, shared
// with the route gate, so the menu and the URL can never disagree.
// The admin area's pages come from lib/adminSections.ts. The sidebar shows one
// "Admin" item; AdminLayout's left sub-nav lists the sections.
export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Workspace',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/projects', label: 'Projects', icon: Building2 },
    ],
  },
  {
    label: 'Test Management',
    items: [
      { to: '/test-repository', label: 'Test Cases', icon: FileStack },
      { to: '/test-runs', label: 'Test Runs', icon: ClipboardList },
      { to: '/execution', label: 'Execution Console', icon: MonitorPlay },
      { to: '/defects', label: 'Defects', icon: Bug },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { to: '/reporting', label: 'Reports', icon: BarChart3 },
      { to: '/reporting/print', label: 'Compliance Reports', icon: ShieldCheck, newTab: true },
    ],
  },
  {
    label: 'Administration',
    items: [
      // One entry for the whole area: it links to the first admin page this user
      // may open and is active on all of them. AdminLayout's sub-nav lists the sections.
      {
        to: '/admin/users',
        label: 'Admin',
        icon: UserCog,
        paths: ADMIN_SECTIONS.flatMap((p) => p.paths),
      },
    ],
  },
]

// ADR-114 (replaces ADR-108's Documentation link): the User Guide is a pinned
// footer link above Profile. Open to every signed-in user; the API returns only
// the guide sections the user's role allows, so it needs no entry in
// routeAccess.ts. The full documentation lives in the platform console only.
export const USER_GUIDE_LINK: NavItem = { to: '/user-guide', label: 'User Guide', icon: BookOpen }

// Destinations kept out of the sidebar but still offered by the command palette.
export const PALETTE_EXTRA_ENTRIES: { label: string; sublabel: string; path: string }[] = [
  { label: 'Report builder', sublabel: 'Analytics', path: '/reporting/builder' },
  { label: USER_GUIDE_LINK.label, sublabel: 'Help', path: USER_GUIDE_LINK.to },
  // The two Access control tabs stay individually searchable.
  { label: 'Users & Roles', sublabel: 'Administration', path: '/admin/users' },
  { label: 'Roles & Permissions', sublabel: 'Administration', path: '/admin/roles' },
  { label: 'Access Rules', sublabel: 'Administration', path: '/admin/access-rules' },
  { label: 'Audit Logs', sublabel: 'Administration', path: '/admin/audit-logs' },
  { label: 'Environments', sublabel: 'Administration', path: '/admin/environments' },
  { label: 'Settings', sublabel: 'Administration', path: '/settings' },
]

// The item as this user sees it (link target = first reachable route), or null.
export function resolveNavItem(user: Parameters<typeof canAccessPath>[0], item: NavItem): NavItem | null {
  const target = (item.paths ?? [item.to]).find((p) => canAccessPath(user, p))
  return target ? { ...item, to: target } : null
}

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return (item.paths ?? []).some((p) => pathname === p || pathname.startsWith(p + '/'))
}

const COLLAPSE_STORAGE_KEY = 'qtesthub:sidebar-collapsed'

// SAAS-GAP-10/9: a per-viewer UI preference, not tenant data -- fine to
// keep in localStorage (per-device convenience, never a source of truth),
// wrapped defensively since private-browsing/blocked-storage contexts can
// throw on read or write.
function useCollapsedPreference(): [boolean, (value: boolean) => void] {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })

  function update(value: boolean) {
    setCollapsed(value)
    try {
      localStorage.setItem(COLLAPSE_STORAGE_KEY, value ? '1' : '0')
    } catch {
      // Private browsing / blocked storage -- the toggle still works for
      // this page view, it just won't persist across reloads.
    }
  }

  return [collapsed, update]
}

// Collapsed sidebar: icon-only links need an accessible name and a visible
// tooltip. The nav is overflow-clipped, so the tooltip is position:fixed and
// placed from the link's bounding box on hover / keyboard focus (UX / Phase C).
function SidebarLink({
  item,
  collapsed,
  className,
}: {
  item: NavItem
  collapsed: boolean
  className: (state: { isActive: boolean }) => string
}) {
  const [tip, setTip] = useState<{ top: number; left: number } | null>(null)
  const ref = useRef<HTMLAnchorElement>(null)
  const { pathname } = useLocation()
  const multiActive = isNavItemActive(item, pathname)

  function showTip() {
    if (!collapsed || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    setTip({ top: r.top + r.height / 2, left: r.right + 8 })
  }

  useEffect(() => {
    if (!tip) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setTip(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [tip])

  const badge = navBadgeText(item.count ?? 0)
  const badgedLabel = badge ? navBadgeLabel(item.label, item.count ?? 0, item.countNoun) : item.label
  const content = (
    <>
      <span className="relative flex shrink-0">
        <item.icon className="size-4 shrink-0" aria-hidden="true" />
        {badge && collapsed && (
          <span
            aria-hidden="true"
            className="absolute -right-1.5 -top-1.5 flex min-w-3.5 items-center justify-center rounded-full bg-[var(--sidebar-accent)] px-0.5 text-[9px] font-semibold leading-3.5 text-[var(--sidebar-bg)]"
          >
            {badge}
          </span>
        )}
      </span>
      {!collapsed && (
        <span className="truncate">
          {item.label}
          {badge && (
            <span className="sr-only">
              , {item.count} {item.countNoun ?? 'open'}
            </span>
          )}
        </span>
      )}
      {badge && !collapsed && (
        <span
          aria-hidden="true"
          className="ml-auto rounded-full bg-[var(--sidebar-bg-raised)] px-1.5 text-[11px] font-medium leading-5 text-[var(--sidebar-foreground)]"
        >
          {badge}
        </span>
      )}
      {item.newTab && !collapsed && <ExternalLink className="ml-auto size-3 shrink-0 opacity-70" aria-hidden="true" />}
      {item.newTab && <span className="sr-only"> (opens in a new tab)</span>}
    </>
  )
  const events = {
    onMouseEnter: showTip,
    onMouseLeave: () => setTip(null),
    onFocus: showTip,
    onBlur: () => setTip(null),
  }
  return (
    <>
      {item.newTab ? (
        <a
          ref={ref}
          href={item.to}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={collapsed ? `${badgedLabel} (opens in a new tab)` : undefined}
          className={className({ isActive: false })}
          {...events}
        >
          {content}
        </a>
      ) : item.paths ? (
        // A multi-route item: NavLink would only mark its own `to` as current.
        <Link
          ref={ref}
          to={item.to}
          aria-label={collapsed ? badgedLabel : undefined}
          aria-current={multiActive ? 'page' : undefined}
          className={className({ isActive: multiActive })}
          {...events}
        >
          {content}
        </Link>
      ) : (
        <NavLink
          ref={ref}
          to={item.to}
          end={item.end}
          aria-label={collapsed ? badgedLabel : undefined}
          className={className}
          {...events}
        >
          {content}
        </NavLink>
      )}
      {collapsed && tip && (
        <span
          role="tooltip"
          style={{ top: tip.top, left: tip.left }}
          className="pointer-events-none fixed z-[var(--z-overlay)] -translate-y-1/2 whitespace-nowrap rounded-[var(--radius-control)] bg-[var(--foreground)] px-2 py-1 text-xs text-[var(--background)] shadow-md"
        >
          {badgedLabel}
        </span>
      )}
    </>
  )
}

export function AppShell() {
  const { user, refresh } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useCollapsedPreference()
  const [moreOpen, setMoreOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Phase 2: Ctrl+K / Cmd+K opens the command palette from anywhere in
  // the authenticated shell -- the single global hotkey listener lives
  // here since AppShell wraps every authenticated route via <Outlet />.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])
  // Tier 4 / ADR-054: tenant branding (PV-11.4). Any authenticated user
  // can read it (the shell needs it for everyone, not just admins).
  const brandingQuery = useQuery({ queryKey: ['branding'], queryFn: getBranding })
  const branding = brandingQuery.data

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      await refresh()
      navigate('/login', { replace: true })
    },
  })

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-[var(--sidebar-foreground)] transition-colors hover:bg-[var(--sidebar-bg-raised)] hover:text-white motion-reduce:transition-none',
      'outline-offset-[-2px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--sidebar-accent)]',
      collapsed && 'md:justify-center',
      // Active page: tinted fill + a 3px accent bar, so the state is not
      // carried by colour alone.
      isActive &&
        'bg-[var(--sidebar-active-bg)] font-medium text-[var(--sidebar-active-foreground)] before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-r-full before:bg-[var(--sidebar-accent)]',
    )

  // Nav badge: open defects the user can see (same scoping as the Defects list).
  const defectCountsQuery = useQuery({
    queryKey: ['defects', 'status-counts', 'nav-badge', user?.user_id],
    queryFn: () => getDefectStatusCounts(),
    enabled: !!user,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
  const openDefects = openDefectCount(defectCountsQuery.data)

  const visibleSections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.flatMap((item) => {
      const resolved = resolveNavItem(user, item)
      if (!resolved) return []
      return resolved.to === '/defects' ? [{ ...resolved, count: openDefects, countNoun: 'open' }] : [resolved]
    }),
  })).filter((section) => section.items.length > 0)

  return (
    <div className="flex min-h-svh">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-[var(--background)] focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-[var(--foreground)] focus:shadow-lg focus:ring-2 focus:ring-[var(--ring)]"
      >
        Skip to main content
      </a>
      <aside
        aria-label="Sidebar"
        className={cn(
          'qth-shell-chrome',
          // Mobile redesign Phase 1: below md the sidebar is replaced by the
          // bottom tab bar + More sheet (components/MobileNav.tsx).
          'hidden w-60 flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] text-[var(--sidebar-foreground)] md:static md:flex md:transition-[width] md:duration-200 motion-reduce:md:transition-none',
          collapsed ? 'md:w-16' : 'md:w-60',
        )}
        style={branding?.primary_color ? ({ '--sidebar-accent': branding.primary_color } as CSSProperties) : undefined}
      >
        <div className="flex items-center justify-between gap-2 px-4 py-4">
          <div className="flex min-w-0 items-center gap-2">
            {branding?.has_logo ? (
              <img
                src={getLogoUrl()}
                alt=""
                width={28}
                height={28}
                decoding="async"
                className="size-7 shrink-0 rounded-md object-contain"
              />
            ) : (
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--sidebar-accent)] text-sm font-bold text-[var(--sidebar-bg)]">
                Q
              </span>
            )}
            {!collapsed && (
              <span className="truncate text-sm font-semibold tracking-wide text-white">
                {branding?.display_name || 'QTestHub'}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden shrink-0 rounded-md p-1.5 text-[var(--sidebar-foreground-muted)] hover:bg-[var(--sidebar-bg-raised)] hover:text-white md:block"
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-5 overflow-y-auto overflow-x-hidden px-3 pb-4">
          {visibleSections.map((section, index) => (
            <div key={section.label} className="flex flex-col gap-1">
              {/* Icon rail: headings become thin dividers (no layout shift between sections). */}
              {collapsed && index > 0 && (
                <hr aria-hidden="true" className="mx-2 mb-1 border-0 border-t border-[var(--sidebar-border)]" />
              )}
              {!collapsed && (
                <p className="px-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--sidebar-foreground-muted)]">
                  {section.label}
                </p>
              )}
              {section.items.map((item) => (
                <SidebarLink key={item.to} item={item} collapsed={collapsed} className={navLinkClass} />
              ))}
            </div>
          ))}
        </nav>

        <div className="flex flex-col gap-1 border-t border-[var(--sidebar-border)] px-3 py-3">
          {canAccessPath(user, USER_GUIDE_LINK.to) && (
            <SidebarLink item={USER_GUIDE_LINK} collapsed={collapsed} className={navLinkClass} />
          )}
          <SidebarLink
            item={{ to: '/account', label: 'Profile', icon: UserCircle }}
            collapsed={collapsed}
            className={navLinkClass}
          />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="qth-shell-chrome flex items-center overflow-x-clip justify-between gap-2 border-b border-[var(--border)] bg-[var(--background)] px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:h-14 md:px-6 md:py-0">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Breadcrumbs />
          </div>
          <div className="flex shrink-0 items-center gap-2 text-sm">
            <GlobalSearch />
            <QuickCreateMenu />
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="hidden items-center gap-1.5 h-8 rounded-md border border-[var(--border)] px-2.5 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)] 2xl:flex"
            >
              <span>Jump to…</span>
              <kbd className="rounded-md border border-[var(--border)] bg-[var(--muted)] px-1.5 py-0.5 font-mono text-[11px]">
                Ctrl K
              </kbd>
            </button>
            {/* Phones and tablets (below lg): global search is an icon that
                opens the command palette -- the inline search field needs
                ~176px that the tablet header does not have next to the
                sidebar (UX-001). */}
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label="Search"
              className="flex size-11 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--muted)] md:size-9 lg:hidden"
            >
              <Search className="size-5 md:size-4" />
            </button>
            <div className="hidden items-center gap-2 md:flex">
              <AIAssistantPanel />
              <ThemeToggle />
            </div>
            <NotificationBell />
            <div className="hidden md:block">
              <UserMenu name={user?.name} role={user?.role} onLogout={() => logoutMutation.mutate()} />
            </div>
          </div>
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className="min-w-0 flex-1 bg-[var(--muted)]/40 p-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:p-6"
        >
          <RouteBoundary resetKey={location.pathname}>
            <AccessRuleBanner />
            {/* Restricted screens are blocked here, before the route element
                renders, so a user who may not open one never downloads it or
                fires its data requests. The API still enforces access. */}
            {user && !canAccessPath(user, location.pathname) ? (
              <NoAccess />
            ) : (
              <>
                <Outlet />
              </>
            )}
          </RouteBoundary>
        </main>
      </div>
      <MobileTabBar moreOpen={moreOpen} onMore={() => setMoreOpen(true)} />
      <MoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        sections={visibleSections}
        userName={user?.name}
        userRole={user?.role}
        onSearch={() => setPaletteOpen(true)}
        onLogout={() => {
          setMoreOpen(false)
          logoutMutation.mutate()
        }}
      />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
