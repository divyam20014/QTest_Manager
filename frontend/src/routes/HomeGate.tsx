import { lazy, Suspense } from 'react'
import { useLocation } from 'react-router-dom'

import { useAuth } from '@/lib/auth'
import { ProtectedRoute } from '@/routes/ProtectedRoute'

const Landing = lazy(() => import('@/routes/landing/Landing'))

/** Wraps the unchanged ProtectedRoute so `/` can serve visitors the public
 * landing page while signed-in users keep the Dashboard at `/`, inside the
 * same AppShell instance as every other app route. The landing chunk is
 * only downloaded by visitors. */
export function HomeGate() {
  const { isAuthenticated, isLoading } = useAuth()
  const { pathname } = useLocation()

  if (pathname === '/' && !isLoading && !isAuthenticated) {
    return (
      <Suspense fallback={<div className="min-h-svh bg-[#060a18]" />}>
        <Landing />
      </Suspense>
    )
  }

  return <ProtectedRoute />
}
