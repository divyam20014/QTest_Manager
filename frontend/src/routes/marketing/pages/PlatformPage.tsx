import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ProductTour } from '../ProductTour'
import { CapabilitiesSection, IntelligenceSection, LifecycleSection, SolutionSection } from '../sections'
import { CtaPanel, PageHero } from '../shared'
import { usePageMeta } from '../utils'

export default function PlatformPage() {
  usePageMeta(
    'Platform Overview | QTestHub',
    'QTestHub brings requirements, test management, execution, defects and analytics into one connected quality engineering platform.',
  )
  return (
    <>
      <PageHero
        eyebrow="Platform overview"
        title="One Platform. Every Dimension of Software Quality."
        lead="QTestHub brings your entire quality engineering lifecycle together. Manage requirements, test cases, execution, defects and analytics through one unified platform designed to give teams complete visibility and control."
      >
        <Link to="/request-demo" className="lp-btn lp-btn-light">
          Request a Demo
          <ArrowRight className="lp-arrow size-4" aria-hidden="true" />
        </Link>
        <Link to="/features" className="lp-btn lp-btn-ghost-dark">
          Explore Features
        </Link>
      </PageHero>
      <SolutionSection withLink={false} />
      <ProductTour />
      <LifecycleSection />
      <CapabilitiesSection />
      <IntelligenceSection />
      <CtaPanel />
    </>
  )
}
