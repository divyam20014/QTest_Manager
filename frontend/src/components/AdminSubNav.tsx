import { Link, useLocation, useNavigate } from 'react-router-dom'

import { Combobox } from '@/components/ui/combobox'
import { activeAdminSection, type VisibleAdminSection } from '@/lib/adminSections'
import { cn } from '@/lib/utils'

/**
 * Left sub-navigation of the admin area (ADR-112). A sticky column from lg up;
 * below lg a "Section" switcher (Combobox) so a phone never gets a second row of
 * links. Grouped under small labels; the active item gets a tint, a left accent
 * bar and aria-current="page".
 */
export function AdminSubNav({ sections }: { sections: VisibleAdminSection[] }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const active = activeAdminSection(pathname)
  const groups = sections.reduce<{ label: string; items: VisibleAdminSection[] }[]>((acc, s) => {
    const g = acc.find((x) => x.label === s.group)
    if (g) g.items.push(s)
    else acc.push({ label: s.group, items: [s] })
    return acc
  }, [])

  return (
    <>
      <div className="lg:hidden">
        <Combobox
          aria-label="Admin section"
          value={active?.to ?? ''}
          onChange={(to) => {
            const s = sections.find((x) => x.to === to)
            if (s) navigate(s.target)
          }}
          options={sections.map((s) => ({ value: s.to, label: s.label }))}
          searchable={false}
        />
      </div>
      <nav aria-label="Admin sections" className="hidden lg:sticky lg:top-6 lg:block lg:w-44 lg:shrink-0 lg:self-start">
        {groups.map((g) => (
          <div key={g.label} className="mb-4 last:mb-0">
            <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              {g.label}
            </p>
            <ul className="space-y-0.5">
              {g.items.map((s) => {
                const isActive = active?.to === s.to
                return (
                  <li key={s.to}>
                    <Link
                      to={s.target}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'relative flex min-h-9 items-center gap-2.5 rounded-[var(--radius-control)] px-3 text-sm transition-colors',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
                        isActive
                          ? 'bg-[var(--primary)]/10 font-medium text-[var(--foreground)] before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-[var(--primary)]'
                          : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]',
                      )}
                    >
                      <s.icon className="size-4 shrink-0" aria-hidden="true" />
                      {s.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
    </>
  )
}
