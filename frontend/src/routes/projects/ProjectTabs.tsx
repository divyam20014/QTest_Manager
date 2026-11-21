import { NavLink } from 'react-router-dom'

import { cn } from '@/lib/utils'

// ADR-102: the project tab strip. Links to the existing project routes; the
// strip scrolls sideways on phones so the page itself never overflows.
export function ProjectTabs({ projectId }: { projectId: string }) {
  const tabs = [
    { label: 'Dashboard', to: `/projects/${projectId}`, end: true },
    { label: 'Details', to: `/projects/${projectId}/details`, end: true },
    { label: 'Requirements', to: `/projects/${projectId}/requirements`, end: false },
    { label: 'Test Cases', to: `/projects/${projectId}/test-cases`, end: false },
    { label: 'Test Runs', to: `/projects/${projectId}/test-runs`, end: false },
    { label: 'Defects', to: `/defects?projectId=${projectId}`, end: false },
  ]
  return (
    <nav aria-label="Project sections" className="-mb-2 max-w-full overflow-x-auto border-b border-[var(--border)]">
      <ul className="flex min-w-max gap-1">
        {tabs.map((t) => (
          <li key={t.label}>
            <NavLink
              to={t.to}
              end={t.end}
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
