import { Link } from 'react-router-dom'

import { PageHero } from '../shared'
import { usePageMeta } from '../utils'

type Kind = 'privacy' | 'terms'

const COPY: Record<Kind, { title: string; eyebrow: string; lead: string }> = {
  privacy: {
    title: 'Privacy',
    eyebrow: 'Privacy',
    lead: 'How QTestHub handles information is set out in the agreement for your organization.',
  },
  terms: {
    title: 'Terms',
    eyebrow: 'Terms',
    lead: 'The terms that apply to your use of QTestHub are set out in the agreement for your organization.',
  },
}

/** Placeholder legal page. TODO(legal): the real privacy policy and terms of
 * service text must be written and approved by counsel before launch; this page
 * deliberately makes no legal claims of its own. */
export default function LegalPage({ kind }: { kind: Kind }) {
  const copy = COPY[kind]
  usePageMeta(`${copy.title} | QTestHub`, `${copy.title} information for QTestHub.`)
  return (
    <>
      <PageHero eyebrow={copy.eyebrow} title={copy.title} lead={copy.lead} />
      <section className="lp-section" aria-label={`${copy.title} details`}>
        <div className="lp-container">
          <div className="mx-auto max-w-[65ch]">
            <p className="rounded-lg border border-[var(--lp-border)] bg-[var(--lp-bg-soft)] p-4 text-[15px]">
              This page is a placeholder and is pending legal review. The full text will be published here.
            </p>
            <p className="mt-6">
              For questions about {kind === 'privacy' ? 'privacy and data handling' : 'terms of use'}, or to see how
              your organization&rsquo;s data is handled, please{' '}
              <Link to="/contact" className="lp-text-link">
                contact our team
              </Link>
              . Security and data-handling controls are described on the{' '}
              <Link to="/security" className="lp-text-link">
                Security page
              </Link>
              .
            </p>
          </div>
        </div>
      </section>
    </>
  )
}
