import { lazy, Suspense } from 'react'

import { IntelligenceSection } from '../sections'
import { CtaPanel, PageHero, ScreenshotFrame, SectionHeader } from '../shared'
import { delay, usePageMeta } from '../utils'

const QualityIntelligenceCenter = lazy(() => import('../QualityIntelligenceCenter'))

export default function QualityIntelligencePage() {
  usePageMeta(
    'Quality Intelligence | QTestHub',
    'Requirement impact analysis, coverage intelligence, defect trends and release readiness in QTestHub, with planned risk-based testing and regression recommendations.',
  )
  return (
    <>
      <PageHero
        eyebrow="Quality intelligence"
        title="Better Information. Better Decisions. Better Software Quality."
        lead="QTestHub's quality intelligence direction helps organizations make more informed decisions from connected testing information. Here is what is available today, and what is on the roadmap."
      />

      <section id="center" className="lp-section lp-soft" aria-labelledby="lp-qc-title">
        <div className="lp-container">
          <SectionHeader
            id="lp-qc-title"
            eyebrow="Quality Intelligence Center"
            title="See the Bigger Picture. Understand Your Software Quality."
            lead="Requirements, test cases, execution, defects and release readiness are one connected picture in QTestHub. Select a part to see how information flows through it."
          />
          <div className="mt-12">
            <Suspense fallback={<div className="lp-qc-placeholder" aria-hidden="true" />}>
              <QualityIntelligenceCenter />
            </Suspense>
          </div>
        </div>
      </section>

      <section className="lp-section bg-white" aria-labelledby="lp-qi-evidence-title">
        <div className="lp-container grid items-center gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-14">
          <div className="lp-reveal">
            <p className="lp-eyebrow">Available today</p>
            <h2 id="lp-qi-evidence-title" className="lp-h2 mt-3 !text-[clamp(26px,3vw,36px)]">
              Release decisions backed by evidence.
            </h2>
            <p className="lp-lead mt-4">
              Release readiness brings execution completion, pass rate, requirement coverage and open defects by
              severity into one view per project, next to team workload and tests whose results keep flipping.
            </p>
          </div>
          <div className="lp-reveal" style={delay(100)}>
            <ScreenshotFrame
              src="/marketing/readiness.jpg"
              width={1184}
              height={472}
              alt="QTestHub release readiness panel showing 91.7% execution completion, 83.3% pass rate and 88.9% requirement coverage, with workload and flaky tests"
            />
          </div>
        </div>
        <div className="lp-container mt-16 grid items-center gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:gap-14">
          <div className="lp-reveal order-2 lg:order-1" style={delay(100)}>
            <ScreenshotFrame
              src="/marketing/traceability.jpg"
              width={1440}
              height={900}
              alt="QTestHub requirements traceability matrix with coverage per requirement and an uncovered requirement flagged"
            />
          </div>
          <div className="lp-reveal order-1 lg:order-2">
            <p className="lp-eyebrow">Available today</p>
            <h2 className="lp-h2 mt-3 !text-[clamp(26px,3vw,36px)]">Coverage gaps, made visible.</h2>
            <p className="lp-lead mt-4">
              The traceability matrix shows which requirements have linked tests, which were executed and how they
              fared, and flags requirements with no coverage at all.
            </p>
          </div>
        </div>
      </section>

      <IntelligenceSection detailed />
      <CtaPanel title="See Quality Intelligence on Your Own Projects." />
    </>
  )
}
