import { useLocation } from 'react-router-dom'

import { hasSessionHint, useAuth } from '@/lib/auth'
import { MarketingRoute } from '@/routes/MarketingRoute'
import { ProtectedRoute } from '@/routes/ProtectedRoute'

/** Wraps the unchanged ProtectedRoute so `/` can serve visitors the public
 * home page while signed-in users keep the Dashboard at `/`, inside the same
 * AppShell instance as every other app route. */
export function HomeGate() {
  const { isAuthenticated, isLoading } = useAuth()
  const { pathname } = useLocation()

  // Perf (ADR-091): a visitor with no session hint sees the home page at once
  // instead of waiting on the /auth/me round trip; a signed-in user (hint set)
  // keeps the old behaviour and never flashes the marketing page.
  if (pathname === '/' && ((!isLoading && !isAuthenticated) || (isLoading && !hasSessionHint()))) {
    return <MarketingRoute />
  }

  return <ProtectedRoute />
}
