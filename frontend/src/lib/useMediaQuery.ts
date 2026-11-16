import { useSyncExternalStore } from 'react'

// Mobile redesign Phase 2: components that must render exactly ONE of two
// layouts (table vs. card list, inline filters vs. a Filters sheet) read the
// breakpoint here instead of rendering both and hiding one with CSS -- two
// copies of a form control means duplicate ids/labels and doubled test
// locators. 767px matches Tailwind's `max-md:` (the `md` breakpoint is 768px).
export const MOBILE_QUERY = '(max-width: 767.98px)'

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {}
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  )
}

/** True below the `md` breakpoint (phones and small portrait tablets). */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY)
}

/** True when the user asked the OS/browser for reduced motion. CSS handles CSS
 * animation; this is for JS-driven animation (Recharts) which CSS can't reach. */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)')
}
