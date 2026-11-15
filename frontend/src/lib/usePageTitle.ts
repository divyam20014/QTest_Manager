import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

import { useAuth } from '@/lib/auth'
import { getPageTitle } from '@/lib/pageTitle'

const SUFFIX = ' · QTestHub'
const LANDING_TITLE = 'QTestHub | Enterprise QA Test Management Platform'

/** Drives the browser tab title from the current route, centrally -- one
 * call (in App.tsx) instead of a hook duplicated across ~25 route
 * components. See `pageTitle.ts` for the route -> title mapping, which
 * Breadcrumbs.tsx's own labels intentionally mirror. Signed-out visitors at
 * `/` see the public landing page, not the Dashboard. */
export function usePageTitleFromRoute() {
  const location = useLocation()
  const { isAuthenticated, isLoading } = useAuth()
  const isLanding = location.pathname === '/' && !isLoading && !isAuthenticated
  useEffect(() => {
    document.title = isLanding ? LANDING_TITLE : getPageTitle(location.pathname) + SUFFIX
  }, [location.pathname, isLanding])
}
