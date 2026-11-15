import type { ReactNode } from 'react'

import { scrollToSection } from './utils'

/** In-page anchor that keeps a real href (works without JS, copyable) but
 * scrolls smoothly and accounts for the sticky nav via scroll-margin. */
export function SectionLink({
  to,
  className,
  children,
  onNavigate,
}: {
  to: string
  className?: string
  children: ReactNode
  onNavigate?: () => void
}) {
  return (
    <a
      href={`#${to}`}
      className={className}
      onClick={(event) => {
        event.preventDefault()
        if (!onNavigate) {
          scrollToSection(to)
          return
        }
        // Closing the mobile menu shrinks the sticky header; scroll only after
        // that layout change has painted, or the target lands off-position.
        onNavigate()
        requestAnimationFrame(() => requestAnimationFrame(() => scrollToSection(to)))
      }}
    >
      {children}
    </a>
  )
}

export function LogoMark({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="qth-logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#38bdf8" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#qth-logo-g)" />
      <circle cx="15" cy="15" r="7" fill="none" stroke="#fff" strokeWidth="2.6" />
      <path d="M18.5 18.5 L24 24" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M12 15.2 l2.1 2.1 l3.9-4.1" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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
