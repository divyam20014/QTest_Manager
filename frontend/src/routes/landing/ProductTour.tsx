import { BarChart3, Bug, Check, FolderTree, LayoutDashboard, PlayCircle } from 'lucide-react'
import { type KeyboardEvent, useRef, useState } from 'react'

import { SectionHeader } from './shared'

const TOUR = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    image: '/landing/tour-dashboard.jpg',
    alt: 'QTestHub dashboard showing test case counts, execution pass rate, test case status breakdown and execution trend for a demo organization',
    title: 'One view of quality across every project',
    points: ['Key test and defect metrics at a glance', 'Execution pass rate and trends', 'Items that need your attention'],
  },
  {
    id: 'repository',
    label: 'Test Repository',
    icon: FolderTree,
    image: '/landing/tour-repository.jpg',
    alt: 'QTestHub test repository listing test cases with status, priority and owner columns, filters and saved views',
    title: 'A structured, searchable test repository',
    points: ['Modules, filters and saved views', 'Versioned test cases with review workflow', 'Bulk import from CSV'],
  },
  {
    id: 'execution',
    label: 'Test Execution',
    icon: PlayCircle,
    image: '/landing/tour-execution.jpg',
    alt: 'QTestHub test run detail listing test cases with pass and fail status and step progress',
    title: 'Plan runs and record every result',
    points: ['Regression, sanity and smoke test runs', 'Step-by-step execution with actual results', 'Evidence attached to each execution'],
  },
  {
    id: 'defects',
    label: 'Defect Management',
    icon: Bug,
    image: '/landing/tour-defects.jpg',
    alt: 'QTestHub defect list with severity, status and assignee columns and filters',
    title: 'Defects linked to the tests that found them',
    points: ['Severity, priority and status workflow', 'Duplicate suggestions while logging', 'Root cause and aging tracking'],
  },
  {
    id: 'reports',
    label: 'Reports & Analytics',
    icon: BarChart3,
    image: '/landing/tour-reports.jpg',
    alt: 'QTestHub reports page with execution, defect and coverage analytics',
    title: 'Reports that answer release questions',
    points: ['Execution, defect and coverage reports', 'Release readiness summary', 'Export for stakeholders and audits'],
  },
] as const

export function ProductTour() {
  const [active, setActive] = useState(0)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const current = TOUR[active]

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const keys: Record<string, number> = {
      ArrowRight: (active + 1) % TOUR.length,
      ArrowLeft: (active - 1 + TOUR.length) % TOUR.length,
      Home: 0,
      End: TOUR.length - 1,
    }
    if (!(event.key in keys)) return
    event.preventDefault()
    const next = keys[event.key]
    setActive(next)
    tabRefs.current[next]?.focus()
  }

  return (
    <section id="platform" className="lp-section bg-[var(--lp-bg-soft)]" aria-labelledby="lp-tour-title">
      <div className="lp-container">
        <SectionHeader
          id="lp-tour-title"
          eyebrow="Platform tour"
          title="See QTestHub in action."
          lead="Click through the core areas of the platform. These are read-only screenshots of the product using a fictional demo organization."
        />

        <div
          role="tablist"
          aria-label="Product areas"
          onKeyDown={onKeyDown}
          className="lp-reveal mx-auto mt-10 flex max-w-full gap-1 overflow-x-auto rounded-full border border-[var(--lp-border)] bg-[var(--lp-bg-soft)] p-1 [scrollbar-width:none] sm:w-fit"
        >
          {TOUR.map((item, index) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                ref={(el) => {
                  tabRefs.current[index] = el
                }}
                id={`lp-tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={index === active}
                aria-controls={`lp-panel-${item.id}`}
                tabIndex={index === active ? 0 : -1}
                className="lp-tab"
                onClick={() => setActive(index)}
              >
                <Icon className="size-4" aria-hidden="true" />
                {item.label}
              </button>
            )
          })}
        </div>

        <div
          key={current.id}
          id={`lp-panel-${current.id}`}
          role="tabpanel"
          aria-labelledby={`lp-tab-${current.id}`}
          className="lp-tab-panel-enter mt-8 grid items-start gap-8 lg:grid-cols-[1fr_300px]"
        >
          <div className="lp-frame">
            <div className="lp-frame-bar" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <img
              src={current.image}
              alt={current.alt}
              width={1440}
              height={900}
              loading="lazy"
              decoding="async"
              className="block h-auto w-full"
            />
          </div>
          <div className="lg:pt-4">
            <h3 className="text-xl font-semibold tracking-tight text-[var(--lp-ink)]">{current.title}</h3>
            <ul className="mt-4 grid gap-3">
              {current.points.map((point) => (
                <li key={point} className="flex gap-3 text-[15px] text-[var(--lp-ink-2)]">
                  <Check className="mt-1 size-4 shrink-0 text-[var(--lp-indigo-strong)]" aria-hidden="true" />
                  {point}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}
