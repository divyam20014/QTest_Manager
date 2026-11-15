import { Check } from 'lucide-react'
import { type KeyboardEvent, useRef, useState } from 'react'

import { TOUR } from './content'
import { ScreenshotFrame, SectionHeader } from './shared'

/** Tab state, roving focus and arrow-key handling shared by both tour layouts. */
function useTourTabs() {
  const [active, setActive] = useState(0)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

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

  return { active, setActive, tabRefs, onKeyDown, current: TOUR[active] }
}

function TourTabs({
  tabs,
  prefix,
  className,
}: {
  tabs: ReturnType<typeof useTourTabs>
  prefix: string
  className: string
}) {
  return (
    <div role="tablist" aria-label="Product areas" onKeyDown={tabs.onKeyDown} className={className}>
      {TOUR.map((item, index) => {
        const Icon = item.icon
        return (
          <button
            key={item.id}
            ref={(el) => {
              tabs.tabRefs.current[index] = el
            }}
            id={`${prefix}-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={index === tabs.active}
            aria-controls={`${prefix}-panel-${item.id}`}
            tabIndex={index === tabs.active ? 0 : -1}
            className="lp-tab"
            onClick={() => tabs.setActive(index)}
          >
            <Icon className="size-4" aria-hidden="true" />
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

export function ProductTour({ id = 'tour' }: { id?: string }) {
  const tabs = useTourTabs()
  const { current } = tabs

  return (
    <section id={id} className="lp-section lp-soft" aria-labelledby="lp-tour-title">
      <div className="lp-container">
        <SectionHeader
          id="lp-tour-title"
          eyebrow="Product tour"
          title="See QTestHub in action."
          lead="Click through the core areas of the platform. These are real, read-only screenshots of QTestHub with sample data from a fictional insurance organization."
        />

        <TourTabs
          tabs={tabs}
          prefix="lp"
          className="lp-reveal mx-auto mt-10 flex max-w-full gap-1 overflow-x-auto rounded-full border border-[var(--lp-border)] bg-white p-1 [scrollbar-width:none] sm:w-fit"
        />

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

/** The tour as the home hero's product frame. Only the first screenshot is in
 * the initial render; the others are fetched when their tab is opened. */
export function HeroTour() {
  const tabs = useTourTabs()
  const { current } = tabs

  return (
    <div id="tour" className="lp-stage">
      <TourTabs
        tabs={tabs}
        prefix="lp-hero"
        className="lp-tabs-dark mx-auto flex max-w-full gap-1 overflow-x-auto rounded-full p-1 [scrollbar-width:none] lg:w-fit"
      />
      <p className="mt-3 text-[14px] text-[var(--lp-on-dark-2)]" aria-live="polite">
        <span className="font-semibold text-white">{current.title}.</span>{' '}
        <span className="text-[var(--lp-on-dark-3)]">
          Real product screenshot · sample data from a fictional demo organization.
        </span>
      </p>
      <div className="lp-glowbar" aria-hidden="true" />
      <div
        id={`lp-hero-panel-${current.id}`}
        role="tabpanel"
        aria-labelledby={`lp-hero-tab-${current.id}`}
        className="lp-stage-frame"
      >
        <ScreenshotFrame
          dark
          eager={current.id === 'dashboard'}
          className="lp-frame-fixed"
          src={current.image}
          alt={current.alt}
          width={current.width}
          height={current.height}
        />
      </div>
    </div>
  )
}
