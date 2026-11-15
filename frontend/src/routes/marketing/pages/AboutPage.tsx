import { Check } from 'lucide-react'

import { CtaPanel, PageHero, SectionHeader } from '../shared'
import { delay, usePageMeta } from '../utils'

const CONNECTED = [
  'Requirements and test coverage.',
  'Test cases and execution.',
  'Defects and testing outcomes.',
  'Teams and responsibilities.',
  'Reports and quality intelligence.',
  'Governance and organizational visibility.',
]

const BELIEFS = [
  { title: 'Quality Is a Shared Responsibility', body: 'Great software quality requires collaboration across business, engineering and QA teams.' },
  { title: 'Visibility Drives Better Decisions', body: 'Teams should have access to meaningful information about testing progress, coverage and quality.' },
  { title: 'Simplicity Improves Productivity', body: 'Complex processes should not require unnecessarily complicated tools.' },
  { title: 'Governance Builds Confidence', body: 'Structured access, accountability and consistency matter as organizations grow.' },
  { title: 'Intelligence Should Create Value', body: 'Technology should help teams identify risks, understand patterns and make better decisions.' },
]

const FOCUS = [
  'Unified QA lifecycle management.',
  'Structured requirement traceability.',
  'Centralized testing operations.',
  'Quality reporting and analytics.',
  'Organizational governance.',
  'A roadmap towards intelligent quality engineering.',
]

export default function AboutPage() {
  usePageMeta(
    'About QTestHub',
    'Why QTestHub exists: to make software quality management more connected, visible and intelligent.',
  )
  return (
    <>
      <PageHero
        eyebrow="About QTestHub"
        title="We're Here to Make Software Quality More Connected, Visible and Intelligent."
        lead="Software quality is not the responsibility of a single tester or a single team. It is the result of connected people, processes, requirements, decisions and continuous improvement."
      />

      <section className="lp-section bg-white" aria-labelledby="lp-about-story">
        <div className="lp-container grid gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="lp-reveal grid gap-4 text-[17px] leading-relaxed text-[var(--lp-ink-2)]">
            <h2 id="lp-about-story" className="sr-only">
              Our story
            </h2>
            <p>Yet managing quality across growing software organizations can become unnecessarily complicated.</p>
            <p>
              Disconnected workflows, fragmented testing information and limited visibility make it difficult for
              teams to understand the bigger quality picture. That&rsquo;s the challenge QTestHub aims to address.
            </p>
            <p className="font-semibold text-[var(--lp-ink)]">
              We believe quality engineering should be connected, structured and accessible to everyone responsible
              for delivering better software.
            </p>
          </div>
          <div className="lp-reveal grid gap-4 text-[17px] leading-relaxed text-[var(--lp-ink-2)]" style={delay(80)}>
            <p className="lp-eyebrow">Our purpose</p>
            <h3 className="lp-h3">Making Quality Management Simpler for the People Who Build Software.</h3>
            <p>
              QA professionals manage requirements, design test scenarios, execute tests, investigate defects and
              provide insights that influence release decisions. Their impact should not be limited by inefficient
              processes and disconnected systems.
            </p>
            <p>
              QTestHub provides a unified environment where testing activities and quality information come
              together, so teams spend less time managing testing complexity and more time improving software quality.
            </p>
          </div>
        </div>
      </section>

      <section className="lp-section lp-soft" aria-labelledby="lp-about-challenge">
        <div className="lp-container grid items-start gap-12 lg:grid-cols-2 lg:gap-16">
          <SectionHeader
            id="lp-about-challenge"
            align="left"
            eyebrow="The challenge we want to solve"
            title="Testing Has Evolved. Quality Management Must Evolve Too."
            lead="Applications are becoming more complex, delivery cycles shorter and teams more distributed, yet many quality management workflows remain fragmented. We see an opportunity to bring together:"
          />
          <ul className="grid gap-3 sm:grid-cols-2">
            {CONNECTED.map((item, i) => (
              <li key={item} className="lp-card lp-reveal flex items-start gap-3 p-4" style={delay((i % 2) * 70)}>
                <Check className="mt-0.5 size-5 shrink-0 text-[var(--lp-indigo-strong)]" aria-hidden="true" />
                <span className="text-[15px] font-medium">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="lp-section lp-dark" aria-label="Mission and vision">
        <div className="lp-container grid gap-6 md:grid-cols-2">
          <div className="lp-card-dark lp-reveal p-8">
            <p className="lp-eyebrow">Our mission</p>
            <p className="mt-4 text-[clamp(20px,2.2vw,26px)] font-semibold leading-snug text-white">
              To simplify and strengthen software quality management by bringing testing workflows, people and quality
              insights together through one unified platform.
            </p>
          </div>
          <div className="lp-card-dark lp-reveal p-8" style={delay(80)}>
            <p className="lp-eyebrow">Our vision</p>
            <p className="mt-4 text-[clamp(20px,2.2vw,26px)] font-semibold leading-snug text-white">
              To help organizations move beyond traditional test management towards connected, intelligent and
              measurable quality engineering.
            </p>
          </div>
        </div>
      </section>

      <section className="lp-section bg-white" aria-labelledby="lp-about-beliefs">
        <div className="lp-container">
          <SectionHeader id="lp-about-beliefs" eyebrow="What we believe" title="The Principles Behind QTestHub." />
          <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {BELIEFS.map(({ title, body }, i) => (
              <li key={title} className="lp-card lp-reveal p-5" style={delay(i * 60)}>
                <h3 className="text-[16px] font-semibold tracking-tight">{title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-[var(--lp-ink-3)]">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="lp-section lp-soft" aria-labelledby="lp-about-different">
        <div className="lp-container grid items-start gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="lp-reveal">
            <p className="lp-eyebrow">What makes QTestHub different</p>
            <h2 id="lp-about-different" className="lp-h2 mt-3">
              A Connected Approach to Quality Engineering.
            </h2>
            <p className="lp-lead mt-4">
              Rather than treating test cases, execution, defects and reporting as isolated activities, QTestHub
              brings these workflows into one connected environment. Our objective is not simply to help teams manage
              more test cases. It is to help organizations understand and improve the quality of their software
              delivery.
            </p>
          </div>
          <ul className="grid gap-3">
            {FOCUS.map((item, i) => (
              <li key={item} className="lp-card lp-reveal flex items-start gap-3 p-4" style={delay(i * 50)}>
                <Check className="mt-0.5 size-5 shrink-0 text-[var(--lp-indigo-strong)]" aria-hidden="true" />
                <span className="text-[15px] font-medium">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="lp-section bg-white" aria-labelledby="lp-about-commitment">
        <div className="lp-container lp-reveal mx-auto max-w-3xl text-center">
          <p className="lp-eyebrow">Our commitment</p>
          <h2 id="lp-about-commitment" className="lp-h2 mt-3">
            Built Around Real QA Challenges.
          </h2>
          <p className="lp-lead mt-4">
            Software quality platforms should be designed around the needs of the people using them: usability,
            practical workflows, meaningful reporting, secure access and continuous improvement. As QTestHub evolves,
            our commitment is to keep it aligned with the changing needs of modern quality engineering teams.
          </p>
        </div>
      </section>

      <CtaPanel
        title="The Next Chapter of Quality Engineering Starts Here."
        body="Whether you're managing a growing QA team or overseeing enterprise software quality, let's explore what better quality management can look like for your organization."
      />
    </>
  )
}
