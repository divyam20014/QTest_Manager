import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import { SECURITY } from '../content'
import { CtaPanel, PageHero, SectionHeader } from '../shared'
import { delay, usePageMeta } from '../utils'

export default function SecurityPage() {
  usePageMeta(
    'Security | QTestHub',
    'Access control, multi-factor sign-in, tenant data isolation, tamper-evident audit logging and session control in QTestHub.',
  )
  return (
    <>
      <PageHero
        eyebrow="Security"
        title="Built for Organizations That Take Quality Seriously."
        lead="As testing operations grow, organizations need control, consistency and accountability. These are the security capabilities built into QTestHub today."
      />

      <section className="lp-section bg-[var(--lp-surface)]" aria-labelledby="lp-sec-title">
        <div className="lp-container">
          <SectionHeader
            id="lp-sec-title"
            eyebrow="Platform security"
            title="Access Control and Accountability at the Foundation."
          />
          <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SECURITY.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="lp-card lp-reveal p-6" style={delay((i % 4) * 70)}>
                <span className="lp-icon">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-[16px] font-semibold tracking-tight">{title}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--lp-ink-3)]">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="lp-section lp-soft" aria-labelledby="lp-sec-questions">
        <div className="lp-container lp-reveal mx-auto max-w-3xl text-center">
          <h2 id="lp-sec-questions" className="lp-h2">
            Have Specific Security or Compliance Requirements?
          </h2>
          <p className="lp-lead mt-4">
            Tell us what your organization needs to review, and our team will walk you through how QTestHub handles
            it.
          </p>
          <Link to="/contact?topic=enterprise" className="lp-btn lp-btn-primary mt-8">
            Talk to Our Team
            <ArrowRight className="lp-arrow size-4" aria-hidden="true" />
          </Link>
        </div>
      </section>

      <CtaPanel />
    </>
  )
}
