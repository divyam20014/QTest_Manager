import '@fontsource-variable/inter/index.css'
import './marketing.css'

import { ArrowRight } from 'lucide-react'
import { type ComponentType, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

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

const NO_STICKY_CTA = new Set(['/request-demo', '/contact'])

/** Phones have no room for the demo button in the nav bar, so it follows the
 * reader at the bottom of the screen instead. It stays out of the way at the
 * top of the page, on the form pages, and wherever the closing call to action
 * or the footer is on screen. */
function StickyDemoBar({ pathname }: { pathname: string }) {
  const [visible, setVisible] = useState(false)
  const enabled = !NO_STICKY_CTA.has(pathname)

  useEffect(() => {
    if (!enabled) return
    const covered = new Set<Element>()
    const update = () => setVisible(window.scrollY > 520 && covered.size === 0)
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting) covered.add(entry.target)
              else covered.delete(entry.target)
            }
            update()
          })
    document.querySelectorAll('.qth-landing footer, .qth-landing .lp-cta-panel').forEach((el) => observer?.observe(el))
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => {
      observer?.disconnect()
      window.removeEventListener('scroll', update)
    }
  }, [enabled, pathname])

  if (!enabled) return null
  return (
    <div className="lp-sticky-cta sm:hidden" data-visible={visible} inert={!visible}>
      <Link to="/request-demo" className="lp-btn lp-btn-primary">
        Request a Demo
        <ArrowRight className="lp-arrow size-4" aria-hidden="true" />
      </Link>
    </div>
  )
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
      // Web fonts and images settle after first paint and move the content
      // above the target, so keep it lined up for a moment. This stops as soon
      // as the reader scrolls, taps or types.
      if (typeof ResizeObserver !== 'undefined') {
        let interacted = false
        let initial = true
        const stop = () => {
          interacted = true
        }
        const events = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const
        events.forEach((name) => window.addEventListener(name, stop, { passive: true, once: true }))
        const observer = new ResizeObserver(() => {
          // The first callback only reports the starting size.
          if (initial) {
            initial = false
            return
          }
          if (!interacted) target.scrollIntoView({ behavior: 'auto', block: 'start' })
        })
        observer.observe(document.body)
        const timer = window.setTimeout(() => observer.disconnect(), 2000)
        return () => {
          observer.disconnect()
          window.clearTimeout(timer)
          events.forEach((name) => window.removeEventListener(name, stop))
        }
      }
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
      <StickyDemoBar pathname={pathname} />
    </div>
  )
}
