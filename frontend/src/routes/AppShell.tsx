import { useMutation } from '@tanstack/react-query'
import {
  BarChart3,
  Bug,
  Building2,
  ClipboardList,
  FileStack,
  LayoutDashboard,
  MonitorPlay,
  ScrollText,
  Settings as SettingsIcon,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { type ComponentType } from 'react'
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

export function AppShell() {
  const { user, refresh } = useAuth()
  const navigate = useNavigate()

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      await refresh()
      navigate('/login', { replace: true })
    },
  })

  return (
    <div className="flex min-h-svh">
      <aside className="flex w-60 shrink-0 flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] text-[var(--sidebar-foreground)]">
        <div className="flex items-center gap-2 px-4 py-4">
          <span className="flex size-7 items-center justify-center rounded-md bg-[var(--sidebar-accent)] text-sm font-bold text-[var(--sidebar-bg)]">
            Q
          </span>
          <span className="text-sm font-semibold tracking-wide text-white">QTestHub</span>
        </div>

        <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 pb-4">
          {NAV_SECTIONS.map((section) => {
            const visibleItems = section.items.filter(
              (item) => !item.adminOnly || user?.role === 'admin',
            )
            if (visibleItems.length === 0) return null
            return (
              <div key={section.label} className="flex flex-col gap-1">
                <p className="px-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--sidebar-foreground-muted)]">
                  {section.label}
                </p>
                {visibleItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-[var(--sidebar-foreground)] transition-colors hover:bg-[var(--sidebar-bg-raised)] hover:text-white',
                        isActive &&
                          'bg-[var(--sidebar-active-bg)] font-medium text-[var(--sidebar-active-foreground)]',
                      )
                    }
                  >
                    <item.icon className="size-4 shrink-0" />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            )
          })}
        </nav>

        <div className="border-t border-[var(--sidebar-border)] px-3 py-3">
          <NavLink
            to="/account"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-[var(--sidebar-foreground)] transition-colors hover:bg-[var(--sidebar-bg-raised)] hover:text-white',
                isActive &&
                  'bg-[var(--sidebar-active-bg)] font-medium text-[var(--sidebar-active-foreground)]',
              )
            }
          >
            <Users className="size-4 shrink-0" />
            Profile
          </NavLink>
          {user?.role === 'admin' && (
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-[var(--sidebar-foreground)] transition-colors hover:bg-[var(--sidebar-bg-raised)] hover:text-white',
                  isActive &&
                    'bg-[var(--sidebar-active-bg)] font-medium text-[var(--sidebar-active-foreground)]',
                )
              }
            >
              <Building2 className="size-4 shrink-0" />
              Organization
            </NavLink>
          )}
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--background)] px-6 py-3">
          <Breadcrumbs />
          <div className="flex items-center gap-1 text-sm">
            <NotificationBell />
            <UserMenu name={user?.name} role={user?.role} onLogout={() => logoutMutation.mutate()} />
          </div>
        </header>
        <main className="flex-1 bg-[var(--muted)]/40 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
