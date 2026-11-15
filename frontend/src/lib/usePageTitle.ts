import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

import { useAuth } from '@/lib/auth'
import { getPageTitle } from '@/lib/pageTitle'
import { isMarketingPath } from '@/routes/marketingPaths'

const SUFFIX = ' · QTestHub'

/** Drives the browser tab title from the current route, centrally -- one
 * call (in App.tsx) instead of a hook duplicated across ~25 route
 * components. See `pageTitle.ts` for the route -> title mapping, which
 * Breadcrumbs.tsx's own labels intentionally mirror. Public marketing pages
 * (including `/` for signed-out visitors) set their own title and meta
 * description, so this hook leaves them alone. */
export function usePageTitleFromRoute() {
  const location = useLocation()
  const { isAuthenticated, isLoading } = useAuth()
  const isMarketing =
    isMarketingPath(location.pathname) || (location.pathname === '/' && !isLoading && !isAuthenticated)
  useEffect(() => {
    if (isMarketing) return
    document.title = getPageTitle(location.pathname) + SUFFIX
  }, [location.pathname, isMarketing])
}
