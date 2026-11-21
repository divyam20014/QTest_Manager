import { ArrowRight, Building2, Receipt, ShieldCheck } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'

import type { LeadKind } from '@/api/marketing'

import { CONTACT_TOPICS } from '../content'
import { LeadForm } from '../LeadForm'
import { usePageMeta } from '../utils'

const REASONS = [
  { icon: Receipt, title: 'Pricing', body: 'Professional pricing shaped to your team size and usage.' },
  { icon: Building2, title: 'Enterprise', body: 'Governance, administration and deployment requirements.' },
  { icon: ShieldCheck, title: 'Security reviews', body: 'Questions about access control, isolation and audit.' },
]

export default function ContactPage() {
  usePageMeta('Contact | QTestHub', 'Contact the QTestHub team about pricing, enterprise needs or general questions.')
  const [params] = useSearchParams()
  const requested = params.get('topic')
  const topic: LeadKind = CONTACT_TOPICS.some((t) => t.value === requested) ? (requested as LeadKind) : 'contact'

  return (
    <section className="lp-hero" aria-labelledby="lp-contact-title">
      <div className="lp-container grid gap-12 py-16 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16 lg:py-24">
        <div>
          <p className="lp-eyebrow">Contact</p>
          <h1 id="lp-contact-title" className="lp-h1 lp-h1-compact mt-4">
            Talk to Our Team.
          </h1>
          <p className="lp-lead mt-5">
            Questions about pricing, enterprise requirements or how QTestHub fits your organization? Send us a message
            and we&rsquo;ll get back to you.
          </p>
          <ul className="mt-10 grid gap-6">
            {REASONS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-4">
                <span className="lp-icon">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <div>
                  <h2 className="text-[16px] font-semibold text-[var(--lp-on-dark)]">{title}</h2>
                  <p className="mt-1 text-[14px] text-[var(--lp-on-dark-2)]">{body}</p>
                </div>
              </li>
            ))}
          </ul>
          <Link to="/request-demo" className="lp-btn lp-btn-ghost-dark mt-10">
            Prefer a walkthrough? Request a demo
            <ArrowRight className="lp-arrow size-4" aria-hidden="true" />
          </Link>
        </div>
        <div>
          <LeadForm key={topic} variant="contact" initialTopic={topic} />
        </div>
      </div>
    </section>
  )
}
