import { NavLink } from 'react-router-dom'

import { cn } from '@/lib/utils'

// ADR-108: the Report builder is reached from Reports (same tab-strip pattern
// as projects/ProjectTabs.tsx) instead of its own sidebar item.
const TABS = [
  { label: 'Reports', to: '/reporting' },
  { label: 'Report builder', to: '/reporting/builder' },
]

export function ReportTabs() {
  return (
    <nav aria-label="Report sections" className="-mb-2 max-w-full overflow-x-auto border-b border-[var(--border)]">
      <ul className="flex min-w-max gap-1">
        {TABS.map((t) => (
          <li key={t.to}>
            <NavLink
              to={t.to}
              end
              className={({ isActive }) =>
                cn(
                  'inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap',
                  isActive
                    ? 'border-[var(--primary)] text-[var(--foreground)]'
                    : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
                )
              }
            >
              {t.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
