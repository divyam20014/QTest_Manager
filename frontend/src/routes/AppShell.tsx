import { useMutation, useQuery } from '@tanstack/react-query'
import {
  BarChart3,
  Bug,
  Building2,
  ClipboardList,
  FileStack,
  LayoutDashboard,
  Layers,
  KeyRound,
  Search,
  MonitorPlay,
  ExternalLink,
  UserCircle,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Settings as SettingsIcon,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { type ComponentType, type CSSProperties, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { logout } from '@/api/auth'
import { getBranding, getLogoUrl } from '@/api/settings'
import { AIAssistantPanel } from '@/components/AIAssistantPanel'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { CommandPalette } from '@/components/CommandPalette'
import { RouteBoundary } from '@/components/RouteBoundary'
import { GlobalSearch } from '@/components/GlobalSearch'
import { NotificationBell } from '@/components/NotificationBell'
import { ThemeToggle } from '@/components/ThemeToggle'
import { MobileTabBar, MoreSheet } from '@/components/MobileNav'
import { UserMenu } from '@/components/UserMenu'
import { isAdmin, isManagerOrAbove } from '@/api/auth'
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
  adminOnly?: boolean
  // Gap-closure pass (ADR-057): Environments is adminOnly by default but
  // also gated at the API by `environment.manage`, which Managers also
  // hold -- `allowedRoles` overrides adminOnly's single-role check for
  // items where more than one role should see the nav entry.
  // Pass 2: the only current use is "manager-or-above", so this now checks
  // the same permission-based helper every other admin/manager gate in the
  // app uses (ADR-059) instead of a role-name array a custom role could
  // never match.
  allowedRoles?: 'manager-or-above'[]
}

interface NavSection {
  label: string
  items: NavItem[]
}

export type { NavItem, NavSection }

// Information architecture per the product's enterprise-QA-platform
// redesign brief: grouped sections (Workspace / Test Management /
// Analytics / Administration) rather than a flat list. Administration
// items are filtered to Admin-only below (audit.view/user.manage are both
// Admin-only permissions), matching the prior flat nav's gating.
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
      { to: '/test-repository', label: 'Test Repository', icon: FileStack },
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
      { to: '/admin/users', label: 'Users & Roles', icon: Users, adminOnly: true },
      { to: '/admin/roles', label: 'Roles & Permissions', icon: KeyRound, adminOnly: true },
      { to: '/admin/audit-logs', label: 'Audit Logs', icon: ScrollText, adminOnly: true },
      {
        to: '/admin/environments',
        label: 'Environments',
        icon: Layers,
        adminOnly: true,
        allowedRoles: ['manager-or-above'],
      },
      { to: '/settings', label: 'Settings', icon: SettingsIcon, adminOnly: true },
    ],
  },
]

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
  item: { to: string; label: string; icon: ComponentType<{ className?: string }>; end?: boolean; newTab?: boolean }
  collapsed: boolean
  className: (state: { isActive: boolean }) => string
}) {
  const [tip, setTip] = useState<{ top: number; left: number } | null>(null)
  const ref = useRef<HTMLAnchorElement>(null)

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

  const content = (
    <>
      <item.icon className="size-4 shrink-0" aria-hidden="true" />
      {!collapsed && <span className="truncate">{item.label}</span>}
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
          aria-label={collapsed ? `${item.label} (opens in a new tab)` : undefined}
          className={className({ isActive: false })}
          {...events}
        >
          {content}
        </a>
      ) : (
        <NavLink
          ref={ref}
          to={item.to}
          end={item.end}
          aria-label={collapsed ? item.label : undefined}
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
          {item.label}
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

  const visibleSections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      if (item.allowedRoles?.includes('manager-or-above')) {
        return isManagerOrAbove(user)
      }
      return !item.adminOnly || isAdmin(user)
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
        className={cn(
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
              <img src={getLogoUrl()} alt="" width={28} height={28} decoding="async" className="size-7 shrink-0 rounded-md object-contain" />
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
          {visibleSections.map((section) => (
            <div key={section.label} className="flex flex-col gap-1">
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

        <div className="border-t border-[var(--sidebar-border)] px-3 py-3">
          <SidebarLink
            item={{ to: '/account', label: 'Profile', icon: UserCircle }}
            collapsed={collapsed}
            className={navLinkClass}
          />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--background)] px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:h-14 md:px-6 md:py-0">
          <div className="flex min-w-0 items-center gap-2">
            <Breadcrumbs />
          </div>
          <div className="flex shrink-0 items-center gap-2 text-sm">
            <GlobalSearch />
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="hidden items-center gap-1.5 h-8 rounded-md border border-[var(--border)] px-2.5 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)] xl:flex"
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
        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 bg-[var(--muted)]/40 p-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:p-6">
          <RouteBoundary resetKey={location.pathname}>
            <Outlet />
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
