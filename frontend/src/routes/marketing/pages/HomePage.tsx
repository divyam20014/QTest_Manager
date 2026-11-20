import { ArrowRight, ChevronDown, PlayCircle } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { HERO_METRICS } from '../content'
import { HeroTour } from '../ProductTour'
import {
  CapabilitiesSection,
  DifferentiatorsSection,
  EnterpriseSection,
  FaqSection,
  IntelligenceSection,
  LifecycleSection,
  PillarStrip,
  ProblemSection,
  RolesSection,
  SolutionSection,
  WhySection,
} from '../sections'
import { CtaPanel } from '../shared'
import { prefersReducedMotion, usePageMeta } from '../utils'
import { PricingTiers } from './PricingPage'

const loadWalkthrough = () => import('../TourWalkthrough')
const TourWalkthrough = lazy(loadWalkthrough)

/** Counts up to `value` once, the first time it scrolls into view. Shows the
 * final value straight away when motion is reduced or observers are missing. */
function CountUp({ value, decimals, suffix }: { value: number; decimals: number; suffix: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [shown, setShown] = useState(() =>
    prefersReducedMotion() || typeof IntersectionObserver === 'undefined' ? value : 0,
  )

  useEffect(() => {
    const el = ref.current
    if (!el || prefersReducedMotion() || typeof IntersectionObserver === 'undefined') return
    let frame = 0
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        observer.disconnect()
        const start = performance.now()
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / 1200)
          setShown(value * (1 - Math.pow(1 - t, 3)))
          if (t < 1) frame = requestAnimationFrame(tick)
        }
        frame = requestAnimationFrame(tick)
      },
      { threshold: 0.4 },
    )
    observer.observe(el)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [value])

  return (
    <>
      <span ref={ref} aria-hidden="true">
        {shown.toFixed(decimals)}
        {suffix}
      </span>
      <span className="sr-only">
        {value.toFixed(decimals)}
        {suffix}
      </span>
    </>
  )
}

function HomeHero() {
  const [tourOpen, setTourOpen] = useState(false)
  const closeTour = useCallback(() => setTourOpen(false), [])

  return (
    <section className="lp-hero lp-hero-home" aria-labelledby="lp-hero-title">
      <div className="lp-container pt-12 text-center lg:pt-14">
        <span className="lp-pill">
          <span className="size-1.5 rounded-full bg-[#60a5fa]" aria-hidden="true" />
          The Intelligence Behind Software Quality
        </span>
        <h1 id="lp-hero-title" className="lp-h1 lp-h1-home mx-auto mt-5 max-w-4xl">
          Quality Isn&rsquo;t Just Tested.
          <br />
          <span className="lp-gradient-text">It&rsquo;s Engineered.</span>
        </h1>
        <p className="lp-lead mx-auto mt-5 max-w-2xl">
          One connected platform to manage testing, understand quality risks, and make better release decisions.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/request-demo" className="lp-btn lp-btn-pill lp-btn-light">
            Request a Demo
            <ArrowRight className="lp-arrow size-4" aria-hidden="true" />
          </Link>
          <button
            type="button"
            className="lp-btn lp-btn-pill lp-btn-primary"
            aria-haspopup="dialog"
            onClick={() => setTourOpen(true)}
            onPointerEnter={loadWalkthrough}
            onFocus={loadWalkthrough}
          >
            <PlayCircle className="size-[18px]" aria-hidden="true" />
            Explore QTestHub in 2 Minutes
          </button>
          <Link to="/#tour" className="lp-btn lp-btn-pill lp-btn-ghost-dark">
            Explore the Platform
          </Link>
        </div>
        {tourOpen && (
          <Suspense fallback={null}>
            <TourWalkthrough onClose={closeTour} />
          </Suspense>
        )}

        <ul className="lp-enter mx-auto mt-9 grid max-w-5xl grid-cols-2 gap-3 lg:grid-cols-4">
          {HERO_METRICS.map((metric) => (
            <li key={metric.label} className="lp-metric">
              <p className="lp-metric-value">
                <CountUp value={metric.value} decimals={metric.decimals} suffix={metric.suffix} />
              </p>
              <div>
                <p className="lp-metric-label">{metric.label}</p>
                <p className="lp-metric-scope">{metric.scope}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-9">
          <HeroTour />
        </div>
        <Link to="/#lp-problem-title" className="lp-next">
          <span>See why teams switch</span>
          <ChevronDown className="lp-next-icon size-5" aria-hidden="true" />
        </Link>
      </div>
    </section>
  )
}

function PricingTeaser() {
  return (
    <section className="lp-section bg-white" aria-labelledby="lp-pricing-title">
      <div className="lp-container">
        <div className="lp-reveal mx-auto max-w-3xl text-center">
          <p className="lp-eyebrow">Flexible business model</p>
          <h2 id="lp-pricing-title" className="lp-h2 mt-3">
            Quality Management That Scales With Your Organization.
          </h2>
          <p className="lp-lead mt-4">
            Whether you&rsquo;re an individual QA professional, a growing software team or a large enterprise, QTestHub
            offers flexible engagement options.
          </p>
        </div>
        <PricingTiers />
        <p className="lp-reveal mt-8 text-center text-[15px] text-[var(--lp-ink-2)]">
          Contact our team to find the most suitable offering for your organization.
        </p>
      </div>
    </section>
  )
}

export default function HomePage() {
  usePageMeta('QTestHub | Enterprise Quality Engineering & Test Management Platform')
  return (
    <>
      <HomeHero />
      <PillarStrip />
      <ProblemSection />
      <SolutionSection withPillars={false} />
      <CapabilitiesSection />
      <LifecycleSection soft />
      <DifferentiatorsSection />
      <RolesSection />
      <IntelligenceSection />
      <EnterpriseSection />
      <PricingTeaser />
      <WhySection />
      <FaqSection />
      <CtaPanel />
    </>
  )
}
