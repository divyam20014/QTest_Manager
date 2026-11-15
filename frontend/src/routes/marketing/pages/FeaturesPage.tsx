import { ArrowRight, Check, KeyRound, ScrollText } from 'lucide-react'
import { Link } from 'react-router-dom'

import { FEATURE_EXTRAS } from '../content'
import { CtaPanel, PageHero, ScreenshotFrame, SectionHeader } from '../shared'
import { delay, usePageMeta } from '../utils'

const MODULES = [
  {
    id: 'test-management',
    eyebrow: 'Test Management',
    title: 'A structured, versioned test repository.',
    body: 'Create, organize and maintain test cases in one centralized repository that the whole team can trust.',
    points: [
      'Test cases organized by project and module',
      'Every change versioned, with a draft → review → approved workflow',
      'Filters, saved views, column controls and bulk actions',
      'Bulk import from CSV, plus shared steps and parameterized test data',
    ],
    image: { src: '/marketing/repository.jpg', width: 1440, height: 900, alt: 'QTestHub test repository with test cases across projects showing status, priority, assignee and step counts' },
  },
  {
    id: 'test-planning',
    eyebrow: 'Test Planning',
    title: 'Plan cycles and runs with clear ownership.',
    body: 'Organize test suites, test plans and runs for each testing cycle, and assign the work to the right people.',
    points: [
      'Regression, sanity and smoke runs',
      'Test suites and test plans to group related coverage',
      'Assign each run case to a tester',
      'Pause, resume and finish runs as the cycle progresses',
    ],
    image: { src: '/marketing/run-detail.jpg', width: 1440, height: 900, alt: 'QTestHub test run detail listing test cases with pending and passed status, step progress and assigned testers' },
  },
  {
    id: 'test-execution',
    eyebrow: 'Test Execution',
    title: 'Step-by-step execution with evidence.',
    body: 'Testers work through each step, record the outcome and attach evidence where it happened.',
    points: [
      'Pass, fail or ignore each step, with keyboard shortcuts',
      'Attachments and comments on individual steps',
      'Run-level progress that rolls up automatically',
      'Automated results posted from CI through a secure webhook',
    ],
    image: { src: '/marketing/execution.jpg', width: 1440, height: 900, alt: 'QTestHub execution console showing a run case list, step instructions with expected results and pass, fail and ignore controls' },
  },
  {
    id: 'defect-management',
    eyebrow: 'Defect Management',
    title: 'Defects connected to the tests that found them.',
    body: 'Log defects from failed steps or on their own, and follow them through a controlled lifecycle.',
    points: [
      'Severity, priority and a New → Open → Fixed → Verified → Closed workflow',
      'SLA aging and breach tracking, with reopen counts',
      'Duplicate suggestions while you log a defect',
      'Root-cause categories and CSV import',
    ],
    image: { src: '/marketing/defects.jpg', width: 1440, height: 900, alt: 'QTestHub defect list with severity, priority, status, SLA breach and reporter columns' },
  },
  {
    id: 'requirements',
    eyebrow: 'Requirement Management',
    title: 'End-to-end traceability, from requirement to result.',
    body: 'Link requirements to the test cases that verify them and see exactly where coverage stands.',
    points: [
      'Versioned requirements with linked test cases',
      'Traceability matrix with passed, failed and not-executed counts',
      'Uncovered requirements flagged automatically',
      'Change impact analysis on requirement edits (AI-assisted, per organization)',
    ],
    image: { src: '/marketing/traceability.jpg', width: 1440, height: 900, alt: 'QTestHub requirements traceability matrix showing coverage per requirement and an uncovered requirement' },
  },
  {
    id: 'reports',
    eyebrow: 'Reports & Analytics',
    title: 'Turn testing activity into decisions.',
    body: 'Centralized reporting shows how testing is progressing and whether a release is ready.',
    points: [
      'Execution and defect trends over time',
      'Release readiness, workload and flaky-test signals per project',
      'Defect aging against SLA by severity',
      'Compliance reports as PDF or CSV, and scheduled email delivery',
    ],
    image: { src: '/marketing/readiness.jpg', width: 1184, height: 472, alt: 'QTestHub release readiness, workload and flaky tests panels for a project' },
  },
]

export default function FeaturesPage() {
  usePageMeta(
    'Features | QTestHub',
    'Test management, planning, execution, defect management, requirements traceability, reporting, access control and audit in QTestHub.',
  )
  return (
    <>
      <PageHero
        eyebrow="Features"
        title="Everything Your QA Organization Needs. Connected."
        lead="A closer look at each part of QTestHub. Screenshots are of the real product with sample data from a fictional insurance organization."
      />

      {MODULES.map((module, i) => (
        <section
          key={module.id}
          id={module.id}
          className={`lp-section ${i % 2 === 0 ? 'bg-white' : 'lp-soft'}`}
          aria-labelledby={`${module.id}-title`}
        >
          <div className="lp-container grid items-center gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-14">
            <div className={`lp-reveal ${i % 2 === 1 ? 'lg:order-2' : ''}`}>
              <p className="lp-eyebrow">{module.eyebrow}</p>
              <h2 id={`${module.id}-title`} className="lp-h2 mt-3 !text-[clamp(26px,3vw,36px)]">
                {module.title}
              </h2>
              <p className="lp-lead mt-4">{module.body}</p>
              <ul className="mt-6 grid gap-3">
                {module.points.map((point) => (
                  <li key={point} className="flex items-start gap-3 text-[15px] text-[var(--lp-ink)]">
                    <Check className="mt-1 size-4 shrink-0 text-[var(--lp-indigo-strong)]" aria-hidden="true" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
            <div className="lp-reveal" style={delay(100)}>
              <ScreenshotFrame {...module.image} />
            </div>
          </div>
        </section>
      ))}

      <section id="access" className="lp-section bg-white" aria-labelledby="lp-access-title">
        <div className="lp-container grid gap-5 md:grid-cols-2">
          <div className="lp-card lp-reveal p-7">
            <span className="lp-icon">
              <KeyRound className="size-5" aria-hidden="true" />
            </span>
            <h2 id="lp-access-title" className="lp-h3 mt-5">
              User &amp; Access Management
            </h2>
            <p className="mt-3 text-[15px] text-[var(--lp-ink-2)]">
              Invite users, assign system or custom roles with granular permissions, and give people a different role
              on specific projects when they need it. Single sign-on (OIDC) and SCIM provisioning are available for
              organizations that manage identities centrally.
            </p>
          </div>
          <div id="governance" className="lp-card lp-reveal p-7" style={delay(80)}>
            <span className="lp-icon">
              <ScrollText className="size-5" aria-hidden="true" />
            </span>
            <h2 className="lp-h3 mt-5">Audit &amp; Governance</h2>
            <p className="mt-3 text-[15px] text-[var(--lp-ink-2)]">
              Every significant action is recorded in a tamper-evident, hash-chained audit log. Review activity in the
              audit log, export compliance reports, and keep a defensible history of what was tested and approved.
            </p>
          </div>
        </div>
      </section>


      <section className="lp-section lp-soft" aria-labelledby="lp-extras-title">
        <div className="lp-container">
          <SectionHeader id="lp-extras-title" eyebrow="And more" title="Built-In Productivity and Integration." />
          <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURE_EXTRAS.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="lp-card lp-reveal p-5" style={delay((i % 3) * 70)}>
                <span className="lp-icon">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-[16px] font-semibold tracking-tight">{title}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--lp-ink-3)]">{body}</p>
              </li>
            ))}
          </ul>
          <div className="lp-reveal mt-10 text-center">
            <Link to="/quality-intelligence" className="lp-text-link">
              See Quality Intelligence
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      <CtaPanel />
    </>
  )
}
