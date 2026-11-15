import { ArrowRight, CheckCircle2, Gauge, ShieldAlert } from 'lucide-react'
import { Link } from 'react-router-dom'

import { VALUE_PROPS } from '../content'
import { ProductTour } from '../ProductTour'
import {
  CapabilitiesSection,
  EnterpriseSection,
  FaqSection,
  IntelligenceSection,
  LifecycleSection,
  ProblemSection,
  RolesSection,
  SolutionSection,
  WhySection,
} from '../sections'
import { CtaPanel, ScreenshotFrame } from '../shared'
import { usePageMeta } from '../utils'
import { PricingTiers } from './PricingPage'

function HomeHero() {
  return (
    <section className="lp-hero" aria-labelledby="lp-hero-title">
      <div className="lp-container grid items-center gap-14 pb-20 pt-16 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-10 lg:pb-28 lg:pt-24">
        <div className="relative z-10 max-w-2xl">
          <span className="lp-pill">
            <span className="size-1.5 rounded-full bg-[#60a5fa]" aria-hidden="true" />
            Enterprise Quality Engineering Platform
          </span>
          <h1 id="lp-hero-title" className="lp-h1 mt-6">
            Quality Isn&rsquo;t Just Tested.
            <br />
            <span className="lp-gradient-text">It&rsquo;s Engineered.</span>
          </h1>
          <p className="lp-lead mt-6 max-w-xl">
            Bring your entire quality engineering lifecycle together with QTestHub. Manage requirements, test
            cases, test execution, defects and quality analytics through one unified platform designed to give your
            teams complete visibility, control and confidence.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link to="/request-demo" className="lp-btn lp-btn-primary">
              Request a Demo
              <ArrowRight className="lp-arrow size-4" aria-hidden="true" />
            </Link>
            <Link to="/platform" className="lp-btn lp-btn-ghost-dark">
              Explore the Platform
            </Link>
          </div>
          <ul className="mt-10 grid gap-3 sm:grid-cols-3 sm:gap-4">
            {VALUE_PROPS.map((prop) => (
              <li key={prop} className="flex items-start gap-2 text-[14px] font-medium text-[var(--lp-on-dark)]">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#60a5fa]" aria-hidden="true" />
                {prop}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative">
          <div className="lg:w-[128%]">
            <ScreenshotFrame
              dark
              eager
              src="/marketing/dashboard.jpg"
              width={1440}
              height={900}
              alt="QTestHub dashboard for a fictional insurance organization: 5 projects, 160 test cases, 28 open defects, a 95% execution pass rate gauge, test case status and a 30-day execution trend"
            />
          </div>
          <div className="lp-float-card hidden w-56 p-4 sm:block lg:-left-10 lg:bottom-10 sm:-bottom-6 sm:left-4">
            <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--lp-ink-3)]">
              <Gauge className="size-4 text-[var(--lp-success)]" aria-hidden="true" />
              Execution pass rate
            </div>
            <p className="mt-1 text-[28px] font-bold tracking-tight">95%</p>
            <p className="text-[12px] text-[var(--lp-ink-3)]">across all executed steps</p>
          </div>
          <div
            className="lp-float-card hidden w-60 p-4 md:block md:-top-6 md:right-4 lg:right-auto lg:left-[62%]"
            style={{ animationDelay: '1.5s' }}
          >
            <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--lp-ink-3)]">
              <ShieldAlert className="size-4 text-[var(--lp-danger)]" aria-hidden="true" />
              Needs attention
            </div>
            <p className="mt-1 text-[15px] font-semibold">6 critical defects open</p>
            <p className="text-[12px] text-[var(--lp-ink-3)]">28 open in total · SLA tracked</p>
          </div>
          <p className="mt-4 text-center text-[12px] text-[var(--lp-on-dark-3)] lg:w-[128%]">
            Product screenshot · sample data from a fictional demo organization
          </p>
        </div>
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
            Whether you&rsquo;re an individual QA professional, a growing software team or a large enterprise,
            QTestHub offers flexible engagement options.
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
      <ProblemSection />
      <SolutionSection />
      <CapabilitiesSection />
      <ProductTour />
      <LifecycleSection />
      <IntelligenceSection />
      <RolesSection />
      <EnterpriseSection />
      <PricingTeaser />
      <WhySection />
      <FaqSection />
      <CtaPanel />
    </>
  )
}
