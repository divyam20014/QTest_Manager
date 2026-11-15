import { Check } from 'lucide-react'
import { type KeyboardEvent, useRef, useState } from 'react'

import { TOUR } from './content'
import { ScreenshotFrame, SectionHeader } from './shared'

export function ProductTour({ id = 'tour' }: { id?: string }) {
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
    <section id={id} className="lp-section lp-soft" aria-labelledby="lp-tour-title">
      <div className="lp-container">
        <SectionHeader
          id="lp-tour-title"
          eyebrow="Product tour"
          title="See QTestHub in action."
          lead="Click through the core areas of the platform. These are real, read-only screenshots of QTestHub with sample data from a fictional insurance organization."
        />

        <div
          role="tablist"
          aria-label="Product areas"
          onKeyDown={onKeyDown}
          className="lp-reveal mx-auto mt-10 flex max-w-full gap-1 overflow-x-auto rounded-full border border-[var(--lp-border)] bg-white p-1 [scrollbar-width:none] sm:w-fit"
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
          className="lp-tab-panel-enter mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_280px]"
        >
          <ScreenshotFrame src={current.image} alt={current.alt} width={current.width} height={current.height} />
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
