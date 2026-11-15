import { CalendarCheck, MessagesSquare, MonitorPlay } from 'lucide-react'

import { LeadForm } from '../LeadForm'
import { usePageMeta } from '../utils'

const EXPECT = [
  { icon: MessagesSquare, title: 'A conversation about your QA process', body: 'We start with how your team plans, executes and reports on testing today.' },
  { icon: MonitorPlay, title: 'A walkthrough of the platform', body: 'See requirements, test management, execution, defects and reporting working together.' },
  { icon: CalendarCheck, title: 'Clear next steps', body: 'We’ll suggest the offering that fits, and how to get started.' },
]

export default function RequestDemoPage() {
  usePageMeta(
    'Request a Demo | QTestHub',
    'Request a personalized QTestHub demonstration for your QA team.',
  )
  return (
    <section className="lp-hero" aria-labelledby="lp-demo-title">
      <div className="lp-container grid gap-12 py-16 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16 lg:py-24">
        <div>
          <p className="lp-eyebrow">Request a demo</p>
          <h1 id="lp-demo-title" className="lp-h1 lp-h1-compact mt-4">
            See QTestHub With Your Team&rsquo;s Questions in Mind.
          </h1>
          <p className="lp-lead mt-5">
            Tell us a little about your organization and what you need most. Our team will reach out to arrange a
            demonstration.
          </p>
          <ul className="mt-10 grid gap-6">
            {EXPECT.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-4">
                <span className="lp-icon">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <div>
                  <h2 className="text-[16px] font-semibold text-white">{title}</h2>
                  <p className="mt-1 text-[14px] text-[var(--lp-on-dark-2)]">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <LeadForm variant="demo" />
        </div>
      </div>
    </section>
  )
}
