import '@fontsource-variable/inter/index.css'
import './marketing.css'

import { type ComponentType, useLayoutEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

import { MarketingFooter } from './MarketingFooter'
import { MarketingNav } from './MarketingNav'
import AboutPage from './pages/AboutPage'
import ContactPage from './pages/ContactPage'
import FeaturesPage from './pages/FeaturesPage'
import HomePage from './pages/HomePage'
import PlatformPage from './pages/PlatformPage'
import PricingPage from './pages/PricingPage'
import QualityIntelligencePage from './pages/QualityIntelligencePage'
import RequestDemoPage from './pages/RequestDemoPage'
import SecurityPage from './pages/SecurityPage'
import SolutionsPage from './pages/SolutionsPage'
import { prefersReducedMotion, useRevealOnScroll } from './utils'

const PAGES: Record<string, ComponentType> = {
  '/': HomePage,
  '/platform': PlatformPage,
  '/features': FeaturesPage,
  '/solutions': SolutionsPage,
  '/quality-intelligence': QualityIntelligencePage,
  '/pricing': PricingPage,
  '/about': AboutPage,
  '/contact': ContactPage,
  '/request-demo': RequestDemoPage,
  '/security': SecurityPage,
}

/** The public marketing website: one lazily loaded chunk, so signed-in app
 * users never download it. */
export default function MarketingSite() {
  const { pathname, hash } = useLocation()
  const Page = PAGES[pathname] ?? HomePage
  const rootRef = useRevealOnScroll<HTMLDivElement>(pathname)
  const previousPath = useRef<string | null>(null)

  useLayoutEffect(() => {
    const samePage = previousPath.current === pathname
    previousPath.current = pathname
    const target = hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null
    if (target) {
      target.scrollIntoView({ behavior: samePage && !prefersReducedMotion() ? 'smooth' : 'auto', block: 'start' })
    } else if (!samePage) {
      window.scrollTo(0, 0)
    }
  }, [pathname, hash])

  return (
    <div ref={rootRef} className="qth-landing">
      <a
        href="#lp-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-[var(--lp-ink)]"
      >
        Skip to content
      </a>
      {/* Remounting on navigation closes any open menu. */}
      <MarketingNav key={pathname + hash} />
      <main id="lp-main" tabIndex={-1} className="outline-none">
        <Page />
      </main>
      <MarketingFooter />
    </div>
  )
}
