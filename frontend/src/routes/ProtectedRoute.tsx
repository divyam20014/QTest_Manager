import { Navigate, Outlet } from 'react-router-dom'

import { useAuth } from '@/lib/auth'

export function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth()

  if (isLoading) {
    return <div className="flex min-h-svh items-center justify-center text-sm text-[var(--muted-foreground)]">Loading…</div>
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}
