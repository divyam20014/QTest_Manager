import './landing.css'

import { LandingHero } from './LandingHero'
import { LandingNav } from './LandingNav'
import {
  About,
  Capabilities,
  FinalCta,
  LandingFooter,
  Lifecycle,
  QualityIntelligence,
  Roles,
  Security,
  TrustStrip,
} from './LandingSections'
import { ProductTour } from './ProductTour'
import { useRevealOnScroll } from './utils'

export default function Landing() {
  const rootRef = useRevealOnScroll<HTMLDivElement>()
  return (
    <div ref={rootRef} className="qth-landing">
      <a
        href="#lp-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-[var(--lp-ink)]"
      >
        Skip to content
      </a>
      <LandingNav />
      <main id="lp-main">
        <LandingHero />
        <TrustStrip />
        <Capabilities />
        <ProductTour />
        <Lifecycle />
        <QualityIntelligence />
        <Roles />
        <Security />
        <About />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  )
}
