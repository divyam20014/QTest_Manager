import { ArrowRight, Check, Plus } from 'lucide-react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'

import {
  CAPABILITIES,
  DIFFERENTIATORS,
  ENTERPRISE_POINTS,
  FAQ,
  INTELLIGENCE,
  LIFECYCLE,
  PILLARS,
  PROBLEMS,
  ROLES,
  WHY_POINTS,
} from './content'
import { AvailabilityBadge, SectionHeader } from './shared'
import { delay } from './utils'

export function ProblemSection() {
  return (
    <section className="lp-section bg-white" aria-labelledby="lp-problem-title">
      <div className="lp-container">
        <SectionHeader
          id="lp-problem-title"
          eyebrow="The problem"
          title="Your QA Process Deserves More Than Disconnected Tools."
          lead="Quality teams shouldn't spend their time connecting spreadsheets, tracking execution across different systems and manually preparing reports. Yet many organizations still struggle with:"
        />
        <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {PROBLEMS.map(({ icon: Icon, title, body }, i) => (
            <li key={title} className="lp-card lp-reveal p-5" style={delay(i * 60)}>
              <span className="lp-icon">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-[16px] font-semibold tracking-tight">{title}</h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--lp-ink-3)]">{body}</p>
            </li>
          ))}
        </ul>
        <p className="lp-reveal mt-10 text-center text-[17px] font-semibold text-[var(--lp-ink)]">
          Your QA team deserves a better way to manage quality.
        </p>
      </div>
    </section>
  )
}

/** Connect / Understand / Control, directly under the home hero. */
export function PillarStrip() {
  return (
    <section className="border-b border-[var(--lp-border)] bg-white py-14 lg:py-16" aria-labelledby="lp-pillars-title">
      <div className="lp-container">
        <h2
          id="lp-pillars-title"
          className="lp-reveal mx-auto max-w-2xl text-center text-[clamp(20px,2.2vw,26px)] font-semibold leading-snug tracking-tight text-[var(--lp-ink)]"
        >
          Clarity and confidence for everyone responsible for quality.
        </h2>
        <ul className="mt-10 grid gap-8 md:grid-cols-3 md:gap-0 md:divide-x md:divide-[var(--lp-border)]">
          {PILLARS.map(({ icon: Icon, verb, title, body }, i) => (
            <li key={verb} className="lp-reveal flex gap-4 md:px-8 md:first:pl-0 md:last:pr-0" style={delay(i * 80)}>
              <span className="lp-icon">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-[20px] font-bold leading-tight tracking-tight text-[var(--lp-ink)]">{verb}</h3>
                <p className="mt-0.5 text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--lp-indigo-strong)]">
                  {title}
                </p>
                <p className="mt-2 text-[15px] leading-relaxed text-[var(--lp-ink-2)]">{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export function SolutionSection({
  withLink = true,
  withPillars = true,
}: {
  withLink?: boolean
  withPillars?: boolean
}) {
  return (
    <section className="lp-section lp-soft" aria-labelledby="lp-solution-title">
      <div
        className={
          withPillars
            ? 'lp-container grid items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16'
            : 'lp-container max-w-3xl text-center'
        }
      >
        <div className="lp-reveal">
          <p className="lp-eyebrow">The solution</p>
          <h2 id="lp-solution-title" className="lp-h2 mt-3">
            One Platform. Complete Quality Visibility.
          </h2>
          <div className="mt-5 grid gap-4 text-[17px] leading-relaxed text-[var(--lp-ink-2)]">
            <p>
              Introducing QTestHub: a unified Quality Engineering and Test Management platform that brings your
              testing operations, teams and quality insights together.
            </p>
            <p>
              From requirement management to release readiness, QTestHub helps organizations establish a more
              connected, transparent and structured approach to software quality.
            </p>
            <p className="font-semibold text-[var(--lp-ink)]">
              Spend less time managing disconnected processes. Spend more time improving software quality.
            </p>
          </div>
          {withLink && (
            <Link to="/platform" className="lp-btn lp-btn-ghost mt-8">
              Discover QTestHub
              <ArrowRight className="lp-arrow size-4" aria-hidden="true" />
            </Link>
          )}
        </div>
        {withPillars && (
          <ul className="grid gap-4">
            {PILLARS.map(({ icon: Icon, verb, title, body }, i) => (
              <li key={verb} className="lp-card lp-reveal flex gap-4 p-5" style={delay(i * 80)}>
                <span className="lp-icon">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-[16px] font-semibold tracking-tight">
                    {verb} <span className="font-medium text-[var(--lp-ink-3)]">· {title}</span>
                  </h3>
                  <p className="mt-1 text-[14px] leading-relaxed text-[var(--lp-ink-3)]">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

export function CapabilitiesSection({ withLink = true }: { withLink?: boolean }) {
  return (
    <section id="capabilities" className="lp-section bg-white" aria-labelledby="lp-features-title">
      <div className="lp-container">
        <SectionHeader
          id="lp-features-title"
          eyebrow="Platform capabilities"
          title="Everything Your QA Organization Needs. Connected."
          lead="Manage the complete software testing lifecycle through one centralized quality management experience."
        />
        <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CAPABILITIES.map(({ icon: Icon, title, body, anchor }, i) => (
            <li key={title} className="lp-reveal" style={delay((i % 4) * 70)}>
              <Link to={`/features#${anchor}`} className="lp-card lp-card-hover block h-full p-5">
                <span className="lp-icon">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-[16px] font-semibold tracking-tight">{title}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--lp-ink-3)]">{body}</p>
              </Link>
            </li>
          ))}
        </ul>
        {withLink && (
          <div className="lp-reveal mt-10 text-center">
            <Link to="/features" className="lp-text-link">
              Explore All Capabilities
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        )}
      </div>
    </section>
  )
}

export function LifecycleSection({ soft = false }: { soft?: boolean }) {
  return (
    <section
      className={`lp-section ${soft ? 'lp-soft' : 'bg-white'}`}
      style={{ '--lp-step-ring': soft ? '#f8fafc' : '#ffffff' } as CSSProperties}
      aria-labelledby="lp-lifecycle-title"
    >
      <div className="lp-container">
        <SectionHeader
          id="lp-lifecycle-title"
          eyebrow="The QA lifecycle"
          title="From Business Requirements to Quality Confidence."
          lead="Manage the complete testing lifecycle through one connected workflow."
        />
        <ol className="relative mt-14 grid gap-8 lg:grid-cols-6 lg:gap-5">
          <span
            aria-hidden="true"
            className="absolute bottom-6 left-[21px] top-6 w-px bg-gradient-to-b from-indigo-300 via-blue-300 to-indigo-200 lg:bottom-auto lg:left-[8%] lg:right-[8%] lg:top-[21px] lg:h-px lg:w-auto lg:bg-gradient-to-r"
          />
          {LIFECYCLE.map(({ title, body }, i) => (
            <li
              key={title}
              className="lp-reveal relative grid grid-cols-[44px_1fr] gap-x-5 lg:flex lg:flex-col lg:items-center lg:text-center"
              style={delay(i * 80)}
            >
              <span className="lp-step-num">{i + 1}</span>
              <div className="lg:mt-5">
                <h3 className="text-[13px] font-bold uppercase tracking-[0.08em] text-[var(--lp-indigo-strong)]">
                  {title}
                </h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--lp-ink-2)]">{body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="lp-reveal mt-12 text-center text-[16px] font-semibold text-[var(--lp-ink)]">
          One connected lifecycle. Better visibility at every stage.
        </p>
      </div>
    </section>
  )
}

function QualityIntelligenceLinks() {
  return (
    <div className="lp-reveal mt-8 flex flex-wrap justify-center gap-x-8 gap-y-3 text-center">
      <Link to="/quality-intelligence#center" className="lp-text-link">
        See how it all connects
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
      <Link to="/quality-intelligence" className="lp-text-link">
        Explore Quality Intelligence
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </div>
  )
}

export function IntelligenceSection({ detailed = false }: { detailed?: boolean }) {
  return (
    <section className="lp-section lp-dark relative overflow-hidden" aria-labelledby="lp-intel-title">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_40%_at_50%_0%,rgba(67,56,202,0.35),transparent_70%)]"
      />
      <div className="lp-container relative">
        <SectionHeader
          id="lp-intel-title"
          eyebrow="Quality intelligence"
          title="Move Beyond Test Execution. Make Quality Intelligent."
          lead="Traditional test management records what has been tested. Modern quality engineering must also help teams understand what needs attention."
        />
        <ul className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {INTELLIGENCE.map(({ icon: Icon, title, body, detail, status, note }, i) => (
            <li key={title} className="lp-card-dark lp-reveal flex flex-col p-6" style={delay((i % 3) * 80)}>
              <div className="flex items-start justify-between gap-3">
                <span className="lp-icon">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <AvailabilityBadge status={status} />
              </div>
              <h3 className="mt-5 text-[17px] font-semibold tracking-tight text-white">{title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-[var(--lp-on-dark-2)]">{detailed ? detail : body}</p>
              {note && <p className="mt-auto pt-4 text-[12px] font-medium text-[#a5b4fc]">{note}</p>}
            </li>
          ))}
        </ul>
        <p className="lp-reveal mt-8 text-center text-[13px] text-[var(--lp-on-dark-3)]">
          Capabilities marked &ldquo;Planned&rdquo; are on the product roadmap and are not available yet.
        </p>
        {!detailed && <QualityIntelligenceLinks />}
      </div>
    </section>
  )
}

/** The six home-page differentiators, each labelled with what exists today. */
export function DifferentiatorsSection() {
  return (
    <section className="lp-section lp-dark relative overflow-hidden" aria-labelledby="lp-diff-title">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_40%_at_50%_0%,rgba(67,56,202,0.35),transparent_70%)]"
      />
      <div className="lp-container relative">
        <SectionHeader
          id="lp-diff-title"
          eyebrow="Quality intelligence"
          title="Not Just More Modules. A Connected Quality Picture."
          lead="Traditional test management records what has been tested. QTestHub connects that information so teams can see what needs attention, and says plainly which parts are available today."
        />
        <ul className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {DIFFERENTIATORS.map(({ icon: Icon, title, body, status, note }, i) => (
            <li key={title} className="lp-card-dark lp-reveal flex flex-col p-6" style={delay((i % 3) * 80)}>
              <div className="flex items-start justify-between gap-3">
                <span className="lp-icon">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <AvailabilityBadge status={status} />
              </div>
              <h3 className="mt-5 text-[17px] font-semibold tracking-tight text-white">{title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-[var(--lp-on-dark-2)]">{body}</p>
              {note && <p className="mt-auto pt-4 text-[12px] font-medium text-[#a5b4fc]">{note}</p>}
            </li>
          ))}
        </ul>
        <p className="lp-reveal mx-auto mt-8 max-w-2xl text-center text-[13px] text-[var(--lp-on-dark-3)]">
          &ldquo;Partly available&rdquo; means some of the capability exists today and the rest is planned.
          &ldquo;Planned&rdquo; capabilities are on the roadmap and are not available yet.
        </p>
        <QualityIntelligenceLinks />
      </div>
    </section>
  )
}

export function RolesSection({ withLink = true }: { withLink?: boolean }) {
  return (
    <section className="lp-section bg-white" aria-labelledby="lp-roles-title">
      <div className="lp-container">
        <SectionHeader
          id="lp-roles-title"
          eyebrow="Built for your team"
          title="One Platform. Different Perspectives. Shared Quality Goals."
        />
        <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ROLES.map(({ icon: Icon, title, body, group }, i) => (
            <li key={title} className="lp-reveal" style={delay((i % 3) * 70)}>
              <Link to={`/solutions#${group}`} className="lp-card lp-card-hover flex h-full gap-4 p-5">
                <span className="lp-icon">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-[16px] font-semibold tracking-tight">{title}</span>
                  <span className="mt-1 block text-[14px] leading-relaxed text-[var(--lp-ink-3)]">{body}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {withLink && (
          <div className="lp-reveal mt-10 text-center">
            <Link to="/solutions" className="lp-text-link">
              See solutions by role
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        )}
      </div>
    </section>
  )
}

export function EnterpriseSection() {
  return (
    <section className="lp-section lp-soft" aria-labelledby="lp-enterprise-title">
      <div className="lp-container grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div className="lp-reveal">
          <p className="lp-eyebrow">Enterprise readiness</p>
          <h2 id="lp-enterprise-title" className="lp-h2 mt-3">
            Built for Organizations That Take Quality Seriously.
          </h2>
          <p className="lp-lead mt-5">
            As testing operations grow, organizations need more than test execution. They need control, consistency
            and accountability.
          </p>
          <Link to="/security" className="lp-text-link mt-7">
            Review security capabilities
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
        <div className="lp-reveal lp-card p-7">
          <p className="text-[15px] font-medium text-[var(--lp-ink-2)]">
            QTestHub is designed around enterprise-oriented capabilities such as:
          </p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {ENTERPRISE_POINTS.map((point) => (
              <li key={point} className="flex items-start gap-3 text-[15px] font-medium text-[var(--lp-ink)]">
                <Check className="mt-0.5 size-5 shrink-0 text-[var(--lp-indigo-strong)]" aria-hidden="true" />
                {point}
              </li>
            ))}
          </ul>
          <p className="mt-6 border-t border-[var(--lp-border)] pt-5 text-[14px] text-[var(--lp-ink-3)]">
            Enterprise quality management should be structured, transparent and manageable.
          </p>
        </div>
      </div>
    </section>
  )
}

export function WhySection() {
  return (
    <section className="lp-section lp-soft" aria-labelledby="lp-why-title">
      <div className="lp-container grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
        <SectionHeader
          id="lp-why-title"
          align="left"
          eyebrow="Why QTestHub"
          title="Quality Engineering Should Be Connected, Not Complicated."
          lead="QTestHub brings these capabilities together to help organizations build a more consistent quality engineering process."
        />
        <ul className="grid gap-3 sm:grid-cols-2">
          {WHY_POINTS.map((point, i) => (
            <li key={point} className="lp-card lp-reveal flex items-start gap-3 p-4" style={delay((i % 2) * 70)}>
              <Check className="mt-0.5 size-5 shrink-0 text-[var(--lp-indigo-strong)]" aria-hidden="true" />
              <span className="text-[15px] font-medium text-[var(--lp-ink)]">{point}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export function FaqSection({ items = FAQ, title = 'Frequently Asked Questions' }: { items?: typeof FAQ; title?: string }) {
  return (
    <section className="lp-section bg-white" aria-labelledby="lp-faq-title">
      <div className="lp-container grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <div className="lp-reveal">
          <p className="lp-eyebrow">FAQ</p>
          <h2 id="lp-faq-title" className="lp-h2 mt-3">
            {title}
          </h2>
          <p className="lp-lead mt-4">
            Can&rsquo;t find what you need?{' '}
            <Link to="/contact" className="lp-text-link">
              Talk to our team
            </Link>
          </p>
        </div>
        <div className="lp-reveal border-t border-[var(--lp-border)]">
          {items.map(({ q, a }) => (
            <details key={q} className="lp-faq">
              <summary>
                {q}
                <Plus className="size-5" aria-hidden="true" />
              </summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
