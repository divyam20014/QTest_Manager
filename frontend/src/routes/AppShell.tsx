import { useMutation } from '@tanstack/react-query'
import { BarChart3, Bug, FolderKanban, LayoutDashboard, LogOut, ShieldCheck } from 'lucide-react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'

import { logout } from '@/api/auth'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth'

// Test Management/Execution are reached from a project's detail page
// rather than their own top-level nav entry, since both are always scoped
// to a specific project. Administration is Admin-only (audit.view/
// user.manage are both Admin-only permissions) and filtered out below.
const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, adminOnly: false },
  { to: '/projects', label: 'Projects', icon: FolderKanban, end: false, adminOnly: false },
  { to: '/defects', label: 'Defects', icon: Bug, end: false, adminOnly: false },
  { to: '/reporting', label: 'Reporting', icon: BarChart3, end: false, adminOnly: false },
  { to: '/admin', label: 'Administration', icon: ShieldCheck, end: false, adminOnly: true },
] as const

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
      <aside className="flex w-56 flex-col border-r border-[var(--border)] p-4">
        <div className="mb-6 text-sm font-semibold">QTestHub</div>
        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.filter((item) => !item.adminOnly || user?.role === 'admin').map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)]',
                  isActive && 'bg-[var(--muted)] text-[var(--foreground)]',
                )
              }
            >
              <item.icon className="size-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-[var(--border)] px-6 py-3">
          <div />
          <div className="flex items-center gap-3 text-sm">
            <span className="text-[var(--muted-foreground)]">
              {user?.name} · {user?.role}
            </span>
            <Button variant="ghost" size="sm" onClick={() => logoutMutation.mutate()}>
              <LogOut className="size-4" />
              Logout
            </Button>
          </div>
        </header>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
