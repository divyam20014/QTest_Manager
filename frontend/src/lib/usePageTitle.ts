import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

import { getPageTitle } from '@/lib/pageTitle'

const SUFFIX = ' · QTestHub'

/** Drives the browser tab title from the current route, centrally -- one
 * call (in App.tsx) instead of a hook duplicated across ~25 route
 * components. See `pageTitle.ts` for the route -> title mapping, which
 * Breadcrumbs.tsx's own labels intentionally mirror. */
export function usePageTitleFromRoute() {
  const location = useLocation()
  useEffect(() => {
    document.title = getPageTitle(location.pathname) + SUFFIX
  }, [location.pathname])
}
