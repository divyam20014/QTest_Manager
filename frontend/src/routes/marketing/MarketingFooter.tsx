import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { LogoMark } from './shared'
import { CURRENT_YEAR } from './utils'

// Only destinations that exist. Documentation, help center, product updates,
// privacy policy and terms pages don't exist yet, so they are not linked.
const COLUMNS: Array<{ title: string; links: Array<{ to: string; label: string }> }> = [
  {
    title: 'Product',
    links: [
      { to: '/platform', label: 'Platform Overview' },
      { to: '/features#test-management', label: 'Test Management' },
      { to: '/features#test-execution', label: 'Test Execution' },
      { to: '/features#reports', label: 'Reports & Analytics' },
      { to: '/quality-intelligence', label: 'Quality Intelligence' },
      { to: '/pricing', label: 'Pricing' },
    ],
  },
  {
    title: 'Solutions',
    links: [
      { to: '/solutions#qa-managers', label: 'For QA Managers' },
      { to: '/solutions#qa-teams', label: 'For QA Teams' },
      { to: '/solutions#engineering', label: 'For Engineering Organizations' },
    ],
  },
  {
    title: 'Company',
    links: [
      { to: '/about', label: 'About QTestHub' },
      { to: '/contact', label: 'Contact' },
      { to: '/request-demo', label: 'Request a Demo' },
      { to: '/security', label: 'Security' },
    ],
  },
  {
    title: 'Account',
    links: [
      { to: '/login', label: 'Sign In' },
      { to: '/signup', label: 'Create an Organization' },
    ],
  },
]

export function MarketingFooter() {
  return (
    <footer className="border-t border-[var(--lp-border)] bg-white">
      <div className="lp-container grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-[1.5fr_repeat(4,1fr)]">
        <div className="sm:col-span-2 lg:col-span-1">
          <Link to="/" className="inline-flex items-center gap-2.5 text-[var(--lp-ink)]" aria-label="QTestHub home">
            <LogoMark />
            <span className="text-[17px] font-semibold tracking-tight">QTestHub</span>
          </Link>
          <p className="mt-3 max-w-xs text-[15px] font-medium text-[var(--lp-ink)]">
            Quality Isn&rsquo;t Just Tested. It&rsquo;s Engineered.
          </p>
          <p className="mt-2 max-w-xs text-[14px] text-[var(--lp-ink-3)]">
            Enterprise quality engineering and test management, from requirements to release.
          </p>
        </div>
        {COLUMNS.map((column) => (
          <FooterColumn key={column.title} title={column.title}>
            {column.links.map((link) => (
              <li key={link.to}>
                <Link to={link.to} className="lp-footer-link">
                  {link.label}
                </Link>
              </li>
            ))}
          </FooterColumn>
        ))}
      </div>
      <div className="border-t border-[var(--lp-border)]">
        <p className="lp-container py-6 text-[13px] text-[var(--lp-ink-3)]">
          Copyright © {CURRENT_YEAR} QTestHub. All rights reserved.
        </p>
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
