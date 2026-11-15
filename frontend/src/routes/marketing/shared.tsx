import { ArrowRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import type { Availability } from './content'

export function LogoMark({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="qth-logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4338ca" />
          <stop offset="1" stopColor="#3b82f6" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#qth-logo-g)" />
      <circle cx="15" cy="15" r="7" fill="none" stroke="#fff" strokeWidth="2.6" />
      <path d="M18.5 18.5 L24 24" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      <path
        d="M12 15.2 l2.1 2.1 l3.9-4.1"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function SectionHeader({
  eyebrow,
  title,
  lead,
  align = 'center',
  id,
}: {
  eyebrow: string
  title: string
  lead?: string
  align?: 'center' | 'left'
  id?: string
}) {
  return (
    <div className={align === 'center' ? 'lp-reveal mx-auto max-w-3xl text-center' : 'lp-reveal max-w-2xl'}>
      <p className="lp-eyebrow">{eyebrow}</p>
      <h2 id={id} className="lp-h2 mt-3">
        {title}
      </h2>
      {lead && <p className="lp-lead mt-4">{lead}</p>}
    </div>
  )
}

/** Dark page header used by every page except Home. */
export function PageHero({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow: string
  title: string
  lead: string
  children?: ReactNode
}) {
  return (
    <section className="lp-hero" aria-labelledby="lp-page-title">
      <div className="lp-container py-20 text-center lg:py-28">
        <p className="lp-eyebrow">{eyebrow}</p>
        <h1 id="lp-page-title" className="lp-h1 lp-h1-page mx-auto mt-4 max-w-4xl">
          {title}
        </h1>
        <p className="lp-lead mx-auto mt-6 max-w-2xl">{lead}</p>
        {children && <div className="mt-9 flex flex-wrap justify-center gap-3">{children}</div>}
      </div>
    </section>
  )
}

/** A real product screenshot in browser chrome. */
export function ScreenshotFrame({
  src,
  alt,
  width,
  height,
  label = 'QTestHub',
  dark = false,
  eager = false,
  className = '',
}: {
  src: string
  alt: string
  width: number
  height: number
  label?: string
  dark?: boolean
  eager?: boolean
  className?: string
}) {
  return (
    <figure className={`lp-frame ${dark ? 'lp-frame-dark' : ''} ${className}`}>
      <div className="lp-frame-bar" aria-hidden="true">
        <i />
        <i />
        <i />
        <span>{label}</span>
      </div>
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading={eager ? 'eager' : 'lazy'}
        fetchPriority={eager ? 'high' : 'auto'}
        decoding="async"
      />
    </figure>
  )
}

export function AvailabilityBadge({ status }: { status: Availability }) {
  return (
    <span className={`lp-status ${status === 'available' ? 'lp-status-available' : 'lp-status-planned'}`}>
      {status === 'available' ? 'Available' : 'Planned'}
    </span>
  )
}

export function CtaPanel({
  title = 'Ready to Engineer Quality Differently?',
  body = 'Bring your people, processes and quality insights together with QTestHub.',
}: {
  title?: string
  body?: string
}) {
  return (
    <section className="lp-section bg-white" aria-labelledby="lp-cta-title">
      <div className="lp-container">
        <div className="lp-cta-panel lp-reveal relative overflow-hidden rounded-3xl bg-[var(--lp-navy-900)] px-6 py-16 text-center sm:px-12 lg:py-20">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_70%_at_50%_0%,rgba(67,56,202,0.45),transparent_70%),radial-gradient(40%_50%_at_90%_100%,rgba(59,130,246,0.2),transparent_70%)]"
          />
          <div className="relative">
            <h2 id="lp-cta-title" className="lp-h2 !text-white">
              {title}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-[17px] text-[var(--lp-on-dark-2)]">{body}</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link to="/request-demo" className="lp-btn lp-btn-primary">
                Request a Personalized Demo
                <ArrowRight className="lp-arrow size-4" aria-hidden="true" />
              </Link>
              <Link to="/contact" className="lp-btn lp-btn-ghost-dark">
                Talk to Our Team
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
