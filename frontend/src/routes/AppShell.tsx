import { useMutation } from '@tanstack/react-query'
import {
  BarChart3,
  Bug,
  Building2,
  ClipboardList,
  FileStack,
  LayoutDashboard,
  Menu,
  MonitorPlay,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Settings as SettingsIcon,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react'
import { type ComponentType, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'

import { logout } from '@/api/auth'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { NotificationBell } from '@/components/NotificationBell'
import { UserMenu } from '@/components/UserMenu'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth'

interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  end?: boolean
  adminOnly?: boolean
}

interface NavSection {
  label: string
  items: NavItem[]
}

// Information architecture per the product's enterprise-QA-platform
// redesign brief: grouped sections (Workspace / Test Management /
// Analytics / Administration) rather than a flat list. Administration
// items are filtered to Admin-only below (audit.view/user.manage are both
// Admin-only permissions), matching the prior flat nav's gating.
const NAV_SECTIONS: NavSection[] = [
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
      { to: '/reporting/print', label: 'Compliance Reports', icon: ShieldCheck },
    ],
  },
  {
    label: 'Administration',
    items: [
      { to: '/admin/users', label: 'Users & Roles', icon: Users, adminOnly: true },
      { to: '/admin/audit-logs', label: 'Audit Logs', icon: ScrollText, adminOnly: true },
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

export function AppShell() {
  const { user, refresh } = useAuth()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useCollapsedPreference()
  const [mobileOpen, setMobileOpen] = useState(false)

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      await refresh()
      navigate('/login', { replace: true })
    },
  })

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-[var(--sidebar-foreground)] transition-colors hover:bg-[var(--sidebar-bg-raised)] hover:text-white',
      collapsed && 'md:justify-center',
      isActive && 'bg-[var(--sidebar-active-bg)] font-medium text-[var(--sidebar-active-foreground)]',
    )

  return (
    <div className="flex min-h-svh">
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] text-[var(--sidebar-foreground)] transition-transform duration-200 md:static md:z-auto md:translate-x-0 md:transition-[width] md:duration-200',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          collapsed ? 'md:w-16' : 'md:w-60',
        )}
      >
        <div className="flex items-center justify-between gap-2 px-4 py-4">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--sidebar-accent)] text-sm font-bold text-[var(--sidebar-bg)]">
              Q
            </span>
            {!collapsed && (
              <span className="truncate text-sm font-semibold tracking-wide text-white">QTestHub</span>
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
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
            className="shrink-0 rounded-md p-1.5 text-[var(--sidebar-foreground-muted)] hover:bg-[var(--sidebar-bg-raised)] hover:text-white md:hidden"
          >
            <X className="size-4" />
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-5 overflow-y-auto overflow-x-hidden px-3 pb-4">
          {NAV_SECTIONS.map((section) => {
            const visibleItems = section.items.filter(
              (item) => !item.adminOnly || user?.role === 'admin',
            )
            if (visibleItems.length === 0) return null
            return (
              <div key={section.label} className="flex flex-col gap-1">
                {!collapsed && (
                  <p className="px-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--sidebar-foreground-muted)]">
                    {section.label}
                  </p>
                )}
                {visibleItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    title={collapsed ? item.label : undefined}
                    className={navLinkClass}
                    onClick={() => setMobileOpen(false)}
                  >
                    <item.icon className="size-4 shrink-0" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </NavLink>
                ))}
              </div>
            )
          })}
        </nav>

        <div className="border-t border-[var(--sidebar-border)] px-3 py-3">
          <NavLink
            to="/account"
            title={collapsed ? 'Profile' : undefined}
            className={navLinkClass}
            onClick={() => setMobileOpen(false)}
          >
            <Users className="size-4 shrink-0" />
            {!collapsed && 'Profile'}
          </NavLink>
          {user?.role === 'admin' && (
            <NavLink
              to="/settings"
              title={collapsed ? 'Organization' : undefined}
              className={navLinkClass}
              onClick={() => setMobileOpen(false)}
            >
              <Building2 className="size-4 shrink-0" />
              {!collapsed && 'Organization'}
            </NavLink>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--background)] px-4 py-3 md:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
              className="shrink-0 rounded-md p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] md:hidden"
            >
              <Menu className="size-5" />
            </button>
            <Breadcrumbs />
          </div>
          <div className="flex shrink-0 items-center gap-1 text-sm">
            <NotificationBell />
            <UserMenu name={user?.name} role={user?.role} onLogout={() => logoutMutation.mutate()} />
          </div>
        </header>
        <main className="flex-1 bg-[var(--muted)]/40 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
