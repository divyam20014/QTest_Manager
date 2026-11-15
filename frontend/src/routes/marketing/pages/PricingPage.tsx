import { ArrowRight, Check } from 'lucide-react'
import { Link } from 'react-router-dom'

import { FAQ } from '../content'
import { FaqSection } from '../sections'
import { CtaPanel, PageHero } from '../shared'
import { delay, usePageMeta } from '../utils'

const TIERS = [
  {
    name: 'Start Free',
    tagline: 'Ideal for individuals and teams evaluating the platform.',
    price: 'Free to start',
    priceNote: 'No payment details required',
    points: [
      'Create your own organization in minutes',
      'Starts on a trial plan with a sample project',
      'Requirements, test cases, runs and defects',
      'Sign in with multi-factor verification',
    ],
    cta: { to: '/signup', label: 'Explore Free Access' },
    featured: false,
  },
  {
    name: 'Professional',
    tagline: 'For organizations looking for more structured testing operations.',
    price: 'Pricing on request',
    priceNote: 'Based on your team and usage',
    points: [
      'Higher user and storage capacity for growing teams',
      'The full platform: traceability, reporting, release readiness',
      'Custom roles and project-scoped permissions',
      'Pricing shaped to your team size',
    ],
    cta: { to: '/contact?topic=pricing', label: 'Request Pricing' },
    featured: true,
  },
  {
    name: 'Enterprise',
    tagline: 'A tailored engagement for advanced governance, administration and deployment requirements.',
    price: 'Custom',
    priceNote: 'Tailored to your organization',
    points: [
      'Single sign-on (OIDC) and SCIM user provisioning',
      'IP allowlists and session controls',
      'Tamper-evident audit trail and compliance reports',
      'A conversation about your governance and deployment needs',
    ],
    cta: { to: '/contact?topic=enterprise', label: 'Contact Enterprise Sales' },
    featured: false,
  },
]

export function PricingTiers() {
  return (
    <ul className="mt-14 grid gap-5 lg:grid-cols-3">
      {TIERS.map((tier, i) => (
        <li
          key={tier.name}
          className={`lp-tier lp-reveal ${tier.featured ? 'lp-tier-featured' : ''}`}
          style={delay(i * 80)}
        >
          <div className="flex min-h-7 items-center justify-between gap-3">
            <h3 className="text-[13px] font-bold uppercase tracking-[0.1em] text-[var(--lp-indigo-strong)]">
              {tier.name}
            </h3>
            {tier.featured && (
              <span className="rounded-full bg-[#eef2ff] px-2.5 py-1 text-[12px] font-semibold text-[var(--lp-indigo-strong)]">
                For growing teams
              </span>
            )}
          </div>
          <p className="mt-4 text-[28px] font-bold tracking-tight text-[var(--lp-ink)]">{tier.price}</p>
          <p className="text-[13px] text-[var(--lp-ink-3)]">{tier.priceNote}</p>
          <p className="mt-4 text-[15px] text-[var(--lp-ink-2)]">{tier.tagline}</p>
          <ul className="mt-6 grid gap-3 border-t border-[var(--lp-border)] pt-6">
            {tier.points.map((point) => (
              <li key={point} className="flex items-start gap-3 text-[14px] text-[var(--lp-ink)]">
                <Check className="mt-0.5 size-4 shrink-0 text-[var(--lp-indigo-strong)]" aria-hidden="true" />
                {point}
              </li>
            ))}
          </ul>
          <Link
            to={tier.cta.to}
            className={`lp-btn mt-8 w-full ${tier.featured ? 'lp-btn-primary' : 'lp-btn-ghost'}`}
          >
            {tier.cta.label}
            <ArrowRight className="lp-arrow size-4" aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  )
}

const PRICING_FAQ = [
  FAQ.find((f) => f.q.startsWith('How can we get pricing'))!,
  {
    q: 'What does the free option include?',
    a: 'You can create your own organization through self-service sign-up, without payment details. New organizations start on a trial plan with a sample project so you can explore requirements, test cases, runs, defects and reports.',
  },
  FAQ.find((f) => f.q.startsWith('Does QTestHub offer enterprise'))!,
  {
    q: 'Can we see the product before deciding?',
    a: 'Yes. Request a demo and we will walk you through QTestHub with your team’s questions in mind.',
  },
]

export default function PricingPage() {
  usePageMeta(
    'Pricing | QTestHub',
    'Start free, or talk to our team about Professional and Enterprise offerings for QTestHub quality engineering and test management.',
  )
  return (
    <>
      <PageHero
        eyebrow="Pricing"
        title="Quality Management That Scales With Your Organization."
        lead="Whether you're an individual QA professional, a growing software team or a large enterprise, QTestHub offers flexible engagement options."
      />
      <section className="lp-section lp-section-tight bg-white" aria-label="Plans">
        <div className="lp-container">
          <PricingTiers />
          <p className="lp-reveal mx-auto mt-8 max-w-2xl text-center text-[15px] text-[var(--lp-ink-2)]">
            Every option runs on the same platform; plans differ in capacity and in how we work with you. Contact
            our team to understand the most suitable offering for your organization.
          </p>
        </div>
      </section>
      <FaqSection items={PRICING_FAQ} title="Pricing Questions" />
      <CtaPanel />
    </>
  )
}
