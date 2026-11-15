import {
  ArrowRight,
  BarChart3,
  Briefcase,
  Bug,
  ClipboardCheck,
  ClipboardList,
  FileSearch,
  FileText,
  Fingerprint,
  GitCompareArrows,
  Globe,
  KeyRound,
  LayoutList,
  LineChart,
  ListChecks,
  Network,
  PlayCircle,
  Rocket,
  ScrollText,
  ShieldCheck,
  Target,
  TrendingUp,
  UserCog,
  Users,
  UsersRound,
  Workflow,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { LogoMark, SectionHeader, SectionLink } from './shared'
import { CURRENT_YEAR, NAV_ITEMS, delay } from './utils'

const STRIP = [
  { icon: LayoutList, label: 'Unified Test Management' },
  { icon: GitCompareArrows, label: 'End-to-End Traceability' },
  { icon: BarChart3, label: 'Centralized QA Visibility' },
  { icon: ShieldCheck, label: 'Enterprise Access Control' },
]

export function TrustStrip() {
  return (
    <section aria-label="Platform highlights" className="border-b border-[var(--lp-border)] bg-white">
      <ul className="lp-container grid grid-cols-2 gap-x-6 gap-y-5 py-8 lg:grid-cols-4">
        {STRIP.map(({ icon: Icon, label }) => (
          <li key={label} className="flex items-center gap-3 text-[15px] font-semibold text-[var(--lp-ink)]">
            <Icon className="size-5 shrink-0 text-[var(--lp-indigo-strong)]" aria-hidden="true" />
            {label}
          </li>
        ))}
      </ul>
    </section>
  )
}

const CAPABILITIES = [
  { icon: ClipboardList, title: 'Test Management', body: 'Create, organize, maintain and version test cases.' },
  { icon: ListChecks, title: 'Test Planning', body: 'Organize test suites, test cycles and execution plans.' },
  { icon: PlayCircle, title: 'Test Execution', body: 'Execute test cases, capture actual results and attach evidence.' },
  { icon: Bug, title: 'Defect Management', body: 'Track defects, status transitions and testing outcomes.' },
  { icon: FileSearch, title: 'Requirement Management', body: 'Maintain requirement traceability and test coverage.' },
  { icon: LineChart, title: 'Reports & Analytics', body: 'Understand testing progress, execution results and quality trends.' },
  { icon: Users, title: 'User & Access Management', body: 'Manage users, roles and permissions.' },
  { icon: ScrollText, title: 'Audit & Governance', body: 'Maintain accountability through activity tracking.' },
]

export function Capabilities() {
  return (
    <section id="features" className="lp-section bg-white" aria-labelledby="lp-features-title">
      <div className="lp-container">
        <SectionHeader
          id="lp-features-title"
          eyebrow="Capabilities"
          title="Everything Your QA Team Needs. One Platform."
          lead="Manage the complete software testing lifecycle through a centralized quality management experience."
        />
        <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CAPABILITIES.map(({ icon: Icon, title, body }, i) => (
            <li key={title} className="lp-card lp-reveal p-5" style={delay((i % 4) * 70)}>
              <span className="lp-icon">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-[16px] font-semibold tracking-tight text-[var(--lp-ink)]">{title}</h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--lp-ink-3)]">{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

const STEPS = [
  { icon: FileText, title: 'Define Requirements', body: 'Capture requirements and acceptance criteria per project.' },
  { icon: ClipboardCheck, title: 'Create Test Coverage', body: 'Author test cases and link them to the requirements they verify.' },
  { icon: ListChecks, title: 'Plan Test Execution', body: 'Group cases into suites, plans and runs for each cycle.' },
  { icon: PlayCircle, title: 'Execute & Track', body: 'Record results step by step and raise defects with evidence.' },
  { icon: TrendingUp, title: 'Analyze Quality', body: 'Review coverage, trends and readiness before you release.' },
]

export function Lifecycle() {
  return (
    <section className="lp-section bg-[var(--lp-bg-soft)]" aria-labelledby="lp-lifecycle-title">
      <div className="lp-container">
        <SectionHeader
          id="lp-lifecycle-title"
          eyebrow="How it works"
          title="From Requirements to Release Confidence."
          lead="A connected workflow keeps every requirement, test and defect traceable from start to finish."
        />
        <ol className="relative mt-14 grid gap-8 lg:grid-cols-5 lg:gap-6">
          <span
            aria-hidden="true"
            className="absolute bottom-6 left-[21px] top-6 w-px bg-gradient-to-b from-indigo-300 via-sky-300 to-indigo-200 lg:bottom-auto lg:left-[10%] lg:right-[10%] lg:top-[21px] lg:h-px lg:w-auto lg:bg-gradient-to-r"
          />
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <li
              key={title}
              className="lp-reveal relative grid grid-cols-[44px_1fr] gap-x-5 lg:flex lg:flex-col lg:items-center lg:text-center"
              style={delay(i * 90)}
            >
              <span className="lp-step-num">{i + 1}</span>
              <div className="lg:mt-5">
                <span className="hidden items-center justify-center lg:flex">
                  <Icon className="size-5 text-[var(--lp-indigo-strong)]" aria-hidden="true" />
                </span>
                <h3 className="flex items-center gap-2 text-[16px] font-semibold tracking-tight text-[var(--lp-ink)] lg:mt-2 lg:justify-center">
                  <Icon className="size-4 text-[var(--lp-indigo-strong)] lg:hidden" aria-hidden="true" />
                  {title}
                </h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--lp-ink-3)]">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

type Availability = 'available' | 'planned'

const INTELLIGENCE: Array<{ icon: typeof Target; title: string; body: string; status: Availability; note?: string }> = [
  {
    icon: GitCompareArrows,
    title: 'Requirement Change Impact Analysis',
    body: 'Compare a requirement against its previous version and flag the linked test cases that may need review.',
    status: 'available',
    note: 'AI-assisted · enabled per organization',
  },
  {
    icon: Target,
    title: 'Risk-Based Testing',
    body: 'Prioritize test scope by business impact and failure likelihood.',
    status: 'planned',
  },
  {
    icon: Workflow,
    title: 'Regression Test Recommendations',
    body: 'Suggest which regression tests to run for a given change, with the reasoning behind each pick.',
    status: 'planned',
  },
  {
    icon: Network,
    title: 'Test Coverage Intelligence',
    body: 'Coverage reports and a traceability matrix that show which requirements are linked to tests and verified by executions.',
    status: 'available',
  },
  {
    icon: TrendingUp,
    title: 'Defect Trend Analysis',
    body: 'Track defect inflow and resolution over time, with root-cause categories and aging.',
    status: 'available',
  },
  {
    icon: Rocket,
    title: 'Release Readiness Insights',
    body: 'Execution completion, pass rate, open defects by severity and requirement coverage, consolidated per release.',
    status: 'available',
  },
]

export function QualityIntelligence() {
  return (
    <section className="lp-section lp-dark relative overflow-hidden" aria-labelledby="lp-intel-title">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_40%_at_50%_0%,rgba(99,102,241,0.25),transparent_70%)]"
      />
      <div className="lp-container relative">
        <SectionHeader
          id="lp-intel-title"
          eyebrow="Quality intelligence"
          title="Move Beyond Test Execution. Make Quality Intelligent."
          lead="Turn the data your team already produces into decisions about what to test and when to release."
        />
        <ul className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {INTELLIGENCE.map(({ icon: Icon, title, body, status, note }, i) => (
            <li key={title} className="lp-card-dark lp-reveal flex flex-col p-6" style={delay((i % 3) * 80)}>
              <div className="flex items-start justify-between gap-3">
                <span className="lp-icon">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span className={`lp-status ${status === 'available' ? 'lp-status-available' : 'lp-status-planned'}`}>
                  {status === 'available' ? 'Available' : 'Planned'}
                </span>
              </div>
              <h3 className="mt-5 text-[17px] font-semibold tracking-tight text-white">{title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-[var(--lp-on-dark-2)]">{body}</p>
              {note && <p className="mt-auto pt-4 text-[12px] font-medium text-[#a5b4fc]">{note}</p>}
            </li>
          ))}
        </ul>
        <p className="lp-reveal mt-8 text-center text-[13px] text-[var(--lp-on-dark-3)]">
          Capabilities marked “Planned” are on the product roadmap and are not available yet.
        </p>
      </div>
    </section>
  )
}

const ROLES = [
  { icon: BarChart3, title: 'QA Manager', body: 'Monitor team performance, project progress and overall QA health.' },
  { icon: UsersRound, title: 'QA Lead', body: 'Manage test planning, execution and team coordination.' },
  { icon: ClipboardCheck, title: 'QA Engineer', body: 'Create, organize and execute test cases.' },
  { icon: FileSearch, title: 'Business Analyst', body: 'Maintain requirement visibility and traceability.' },
  { icon: Briefcase, title: 'Project Manager', body: 'Understand testing progress and release quality.' },
  { icon: UserCog, title: 'Administrator', body: 'Manage organizations, users, roles and access.' },
]

export function Roles() {
  return (
    <section id="solutions" className="lp-section bg-white" aria-labelledby="lp-roles-title">
      <div className="lp-container">
        <SectionHeader
          id="lp-roles-title"
          eyebrow="Solutions"
          title="Built for Every Role in Quality Engineering."
          lead="Everyone involved in quality works from the same source of truth, with access shaped to their role."
        />
        <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ROLES.map(({ icon: Icon, title, body }, i) => (
            <li key={title} className="lp-card lp-reveal flex gap-4 p-5" style={delay((i % 3) * 70)}>
              <span className="lp-icon shrink-0">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-[16px] font-semibold tracking-tight text-[var(--lp-ink)]">{title}</h3>
                <p className="mt-1 text-[14px] leading-relaxed text-[var(--lp-ink-3)]">{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

const SECURITY = [
  { icon: KeyRound, title: 'Role-Based Access Control', body: 'System and custom roles with granular permissions, plus per-project role overrides.' },
  { icon: Fingerprint, title: 'Multi-Factor Sign-In', body: 'Sign-in is completed with a one-time verification code after the password step.' },
  { icon: Network, title: 'Multi-Tenant Isolation', body: "Each organization's data is isolated in the database with row-level security." },
  { icon: ScrollText, title: 'Tamper-Evident Audit Log', body: 'An append-only, hash-chained record of who did what, and when.' },
  { icon: Globe, title: 'Network Access Controls', body: 'Optional IP allowlists restrict where your organization can sign in from.' },
  { icon: ShieldCheck, title: 'Session Control', body: 'Review active sessions and revoke them; suspended access ends sessions immediately.' },
]

export function Security() {
  return (
    <section className="lp-section bg-[var(--lp-bg-soft)]" aria-labelledby="lp-security-title">
      <div className="lp-container grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
        <SectionHeader
          id="lp-security-title"
          align="left"
          eyebrow="Security"
          title="Enterprise-Ready. Security-Conscious. Built for Control."
          lead="Access control and accountability are part of the platform's foundation, not add-ons."
        />
        <ul className="grid gap-x-8 gap-y-7 sm:grid-cols-2">
          {SECURITY.map(({ icon: Icon, title, body }, i) => (
            <li key={title} className="lp-reveal flex gap-4" style={delay((i % 2) * 80)}>
              <span className="lp-icon shrink-0">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-[16px] font-semibold tracking-tight text-[var(--lp-ink)]">{title}</h3>
                <p className="mt-1 text-[14px] leading-relaxed text-[var(--lp-ink-3)]">{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export function About() {
  return (
    <section id="about" className="lp-section bg-white" aria-labelledby="lp-about-title">
      <div className="lp-container grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <SectionHeader
          id="lp-about-title"
          align="left"
          eyebrow="About QTestHub"
          title="A test management platform built around traceability."
        />
        <div className="lp-reveal grid gap-4 text-[16px] leading-relaxed text-[var(--lp-ink-2)]">
          <p>
            QTestHub brings requirements, test cases, executions and defects into one multi-tenant platform, so
            teams can show exactly what was tested, how, and with what result.
          </p>
          <p>
            It is designed for quality engineering teams in process-heavy, regulated environments, where
            accountability, access control and an auditable history matter as much as speed.
          </p>
        </div>
      </div>
    </section>
  )
}

export function FinalCta() {
  return (
    <section className="lp-section lp-section-flush-top bg-white" aria-labelledby="lp-cta-title">
      <div className="lp-container">
        <div className="lp-cta-panel lp-reveal relative overflow-hidden rounded-3xl bg-[var(--lp-navy-950)] px-6 py-16 text-center sm:px-12 lg:py-20">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_70%_at_50%_0%,rgba(99,102,241,0.35),transparent_70%),radial-gradient(40%_50%_at_90%_100%,rgba(56,189,248,0.18),transparent_70%)]"
          />
          <div className="relative">
            <h2 id="lp-cta-title" className="lp-h2 !text-white">
              Make Quality a Competitive Advantage.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-[17px] text-[var(--lp-on-dark-2)]">
              Bring your QA teams, testing workflows and quality insights together with QTestHub.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link to="/signup" className="lp-btn lp-btn-primary">
                Get Started
                <ArrowRight className="lp-arrow size-4" aria-hidden="true" />
              </Link>
              <Link to="/login" className="lp-btn lp-btn-ghost-dark">
                Sign In
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export function LandingFooter() {
  return (
    <footer className="border-t border-[var(--lp-border)] bg-white">
      <div className="lp-container grid gap-10 py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Link to="/" className="inline-flex items-center gap-2.5 text-[var(--lp-ink)]" aria-label="QTestHub home">
            <LogoMark />
            <span className="text-[17px] font-semibold tracking-tight">QTestHub</span>
          </Link>
          <p className="mt-3 max-w-xs text-[14px] text-[var(--lp-ink-3)]">
            Enterprise QA test management, from requirements to release confidence.
          </p>
        </div>
        <FooterColumn title="Product">
          {NAV_ITEMS.filter((n) => n.id !== 'about').map((item) => (
            <li key={item.id}>
              <SectionLink to={item.id} className="lp-footer-link">
                {item.label}
              </SectionLink>
            </li>
          ))}
        </FooterColumn>
        <FooterColumn title="Company">
          <li>
            <SectionLink to="about" className="lp-footer-link">
              About
            </SectionLink>
          </li>
        </FooterColumn>
        <FooterColumn title="Account">
          <li>
            <Link to="/login" className="lp-footer-link">
              Sign In
            </Link>
          </li>
          <li>
            <Link to="/signup" className="lp-footer-link">
              Get Started
            </Link>
          </li>
        </FooterColumn>
      </div>
      <div className="border-t border-[var(--lp-border)]">
        <p className="lp-container py-6 text-[13px] text-[var(--lp-ink-3)]">© {CURRENT_YEAR} QTestHub. All rights reserved.</p>
      </div>
    </footer>
  )
}

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <nav aria-label={title}>
      <h2 className="text-[13px] font-semibold uppercase tracking-wider text-[var(--lp-ink)]">{title}</h2>
      <ul className="mt-4 grid gap-2.5 text-[14px]">{children}</ul>
    </nav>
  )
}
