import { useLocation } from 'react-router-dom'

import { useAuth } from '@/lib/auth'
import { MarketingRoute } from '@/routes/MarketingRoute'
import { ProtectedRoute } from '@/routes/ProtectedRoute'

/** Wraps the unchanged ProtectedRoute so `/` can serve visitors the public
 * home page while signed-in users keep the Dashboard at `/`, inside the same
 * AppShell instance as every other app route. */
export function HomeGate() {
  const { isAuthenticated, isLoading } = useAuth()
  const { pathname } = useLocation()

  if (pathname === '/' && !isLoading && !isAuthenticated) {
    return <MarketingRoute />
  }

  return <ProtectedRoute />
}
