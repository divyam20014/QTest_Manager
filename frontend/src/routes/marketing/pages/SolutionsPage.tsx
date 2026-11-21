import { Check } from 'lucide-react'

import { ROLES } from '../content'
import { CtaPanel, PageHero, ScreenshotFrame } from '../shared'
import { delay, usePageMeta } from '../utils'

const GROUPS = [
  {
    id: 'qa-managers',
    eyebrow: 'For QA Managers',
    title: 'See progress, quality and risk without chasing reports.',
    body: 'QA managers need an honest view of where testing stands. QTestHub consolidates it.',
    points: [
      'Dashboards for projects, test cases, runs and open defects',
      'Release readiness per project: completion, pass rate, coverage, open defects',
      'Team workload and flaky-test signals',
      'Defect aging and SLA breaches by severity',
    ],
    image: { src: '/marketing/readiness.jpg', width: 1184, height: 472, alt: 'QTestHub release readiness, team workload and flaky test panels for a project' },
  },
  {
    id: 'qa-teams',
    eyebrow: 'For QA Teams',
    title: 'Structured workflows for leads, engineers and analysts.',
    body: 'QA leads, QA engineers and business analysts work from the same requirements, tests and results.',
    points: [
      'Leads plan runs, assign work and review test cases before approval',
      'Engineers execute step by step and log defects with evidence',
      'Analysts link requirements to test coverage and spot gaps',
      'Everyone works from one versioned source of truth',
    ],
    image: { src: '/marketing/run-detail.jpg', width: 1440, height: 900, alt: 'QTestHub test run with test cases assigned to testers and their progress' },
  },
  {
    id: 'engineering',
    eyebrow: 'For Engineering Organizations',
    title: 'Delivery risk and governance, built in.',
    body: 'Engineering managers and administrators get the visibility and control a growing organization needs.',
    points: [
      'Execution and defect trends that show where delivery risk sits',
      'Custom roles, project-scoped permissions and SSO (OIDC)',
      'Multi-tenant isolation, IP allowlists and session control',
      'A tamper-evident audit trail of every significant action',
    ],
    image: { src: '/marketing/reports.jpg', width: 1184, height: 768, alt: 'QTestHub execution trend and defect trend charts over the last 30 days' },
  },
] as const

export default function SolutionsPage() {
  usePageMeta(
    'Solutions by Role | QTestHub',
    'How QTestHub supports QA managers, QA leads, QA engineers, business analysts, engineering managers and administrators.',
  )
  return (
    <>
      <PageHero
        eyebrow="Solutions"
        title="One Platform. Different Perspectives. Shared Quality Goals."
        lead="A QA manager and a QA engineer have different priorities. QTestHub gives each role what it needs while keeping everyone on the same source of truth."
      />

      <section className="lp-section lp-section-tight bg-[var(--lp-surface)]" aria-label="Roles">
        <div className="lp-container">
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ROLES.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="lp-card lp-reveal flex gap-4 p-5" style={delay((i % 3) * 70)}>
                <span className="lp-icon">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <div>
                  <h2 className="text-[16px] font-semibold tracking-tight">{title}</h2>
                  <p className="mt-1 text-[14px] leading-relaxed text-[var(--lp-ink-3)]">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {GROUPS.map((group, i) => (
        <section
          key={group.id}
          id={group.id}
          className={`lp-section ${i % 2 === 0 ? 'lp-soft' : 'bg-[var(--lp-surface)]'}`}
          aria-labelledby={`${group.id}-title`}
        >
          <div className="lp-container grid items-center gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-14">
            <div className={`lp-reveal ${i % 2 === 1 ? 'lg:order-2' : ''}`}>
              <p className="lp-eyebrow">{group.eyebrow}</p>
              <h2 id={`${group.id}-title`} className="lp-h2 mt-3 !text-[clamp(26px,3vw,36px)]">
                {group.title}
              </h2>
              <p className="lp-lead mt-4">{group.body}</p>
              <ul className="mt-6 grid gap-3">
                {group.points.map((point) => (
                  <li key={point} className="flex items-start gap-3 text-[15px] text-[var(--lp-ink)]">
                    <Check className="mt-1 size-4 shrink-0 text-[var(--lp-indigo-strong)]" aria-hidden="true" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
            <div className="lp-reveal" style={delay(100)}>
              <ScreenshotFrame {...group.image} />
            </div>
          </div>
        </section>
      ))}

      <CtaPanel title="See How QTestHub Fits Your Team." />
    </>
  )
}
