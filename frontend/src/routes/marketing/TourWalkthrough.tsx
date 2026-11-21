import './walkthrough.css'

import { ArrowLeft, ArrowRight, Info, Pause, Play, RotateCcw, X } from 'lucide-react'
import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'

import { prefersReducedMotion } from './utils'
import { WALKTHROUGH_STEPS as STEPS } from './walkthroughSteps'

const STEP_MS = 7000
const LAST = STEPS.length // index of the closing step
const TOTAL = STEPS.length + 1

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** A read-only, sample-data tour built from real screenshots. It is rendered
 * into the marketing root (so the page's palette and reduced-motion rules
 * apply) and never talks to the application API. */
export default function TourWalkthrough({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(() => !prefersReducedMotion())
  const [loaded, setLoaded] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const autoplaying = playing && index < LAST
  const step = index < LAST ? STEPS[index] : null

  function go(next: number) {
    setPlaying(false)
    setIndex(Math.max(0, Math.min(LAST, next)))
  }

  // Modal behaviour: lock page scroll, hide the rest of the page from
  // assistive tech and keyboard, and give focus back to the opener on close.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const panel = panelRef.current
    const root = document.querySelector('.qth-landing')
    const hidden = root
      ? Array.from(root.children).filter(
          (el): el is HTMLElement =>
            el instanceof HTMLElement && !el.contains(panel) && !el.classList.contains('lp-sticky-cta'),
        )
      : []
    const wasInert = hidden.map((el) => el.inert)
    hidden.forEach((el) => {
      el.inert = true
    })

    const { overflow, paddingRight } = document.body.style
    const scrollbar = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`

    panel?.focus()

    return () => {
      document.body.style.overflow = overflow
      document.body.style.paddingRight = paddingRight
      hidden.forEach((el, i) => {
        el.inert = wasInert[i]
      })
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const panel = panelRef.current
      if (!panel) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        setPlaying(false)
        setIndex((i) => Math.min(LAST, i + 1))
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setPlaying(false)
        setIndex((i) => Math.max(0, i - 1))
      } else if (event.key === 'Tab') {
        const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => el.getClientRects().length > 0,
        )
        if (items.length === 0) return
        const first = items[0]
        const last = items[items.length - 1]
        const active = document.activeElement
        if (!panel.contains(active) || active === panel) {
          event.preventDefault()
          ;(event.shiftKey ? last : first).focus()
        } else if (event.shiftKey && active === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && active === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    if (!autoplaying) return
    const timer = window.setTimeout(() => setIndex((i) => Math.min(LAST, i + 1)), STEP_MS)
    return () => window.clearTimeout(timer)
  }, [autoplaying, index])

  useEffect(() => {
    const next = STEPS[index + 1]
    if (next) new Image().src = next.image
  }, [index])

  const portalRoot = document.querySelector('.qth-landing') ?? document.body

  return createPortal(
    <div className="lp-wt">
      <div className="lp-wt-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lp-wt-heading"
        aria-describedby="lp-wt-note"
        tabIndex={-1}
        className="lp-wt-panel"
      >
        <header className="lp-wt-head">
          <div className="min-w-0">
            <h2 id="lp-wt-heading" className="lp-wt-heading">
              Explore QTestHub in 2 Minutes
            </h2>
            <p id="lp-wt-note" className="lp-wt-note">
              <Info className="size-3.5 shrink-0" aria-hidden="true" />
              Read-only preview with sample data &mdash; not the live application
            </p>
          </div>
          <div className="lp-wt-head-actions">
            {index < LAST && (
              <button
                type="button"
                className="lp-wt-icon-btn"
                onClick={() => setPlaying((p) => !p)}
                aria-label={autoplaying ? 'Pause automatic advance' : 'Play automatic advance'}
              >
                {autoplaying ? (
                  <Pause className="size-4" aria-hidden="true" />
                ) : (
                  <Play className="size-4" aria-hidden="true" />
                )}
                <span className="lp-wt-icon-label">{autoplaying ? 'Pause' : 'Play'}</span>
              </button>
            )}
            <button type="button" className="lp-wt-icon-btn" onClick={onClose} aria-label="Close tour">
              <X className="size-[18px]" aria-hidden="true" />
              <span className="lp-wt-icon-label">Close</span>
            </button>
          </div>
        </header>

        <div className="lp-wt-body">
          {step ? (
            <div key={step.id} className="lp-wt-grid">
              <div className="lp-wt-stage" style={{ '--ar': step.width / step.height } as CSSProperties}>
                <figure className="lp-frame lp-frame-dark lp-wt-frame">
                  <div className="lp-frame-bar" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <span>QTestHub &middot; sample data</span>
                  </div>
                  <div className="lp-wt-shot">
                    <img
                      src={step.image}
                      alt={step.alt}
                      width={step.width}
                      height={step.height}
                      decoding="async"
                      onLoad={() => setLoaded(step.id)}
                    />
                    <div className="lp-wt-callouts" aria-hidden="true">
                      {loaded === step.id &&
                        step.callouts.map((c, i) => (
                          <span
                            key={c.label}
                            className="lp-wt-ring"
                            style={{
                              left: `${c.x}%`,
                              top: `${c.y}%`,
                              width: `${c.w}%`,
                              height: `${c.h}%`,
                              animationDelay: `${300 + i * 500}ms`,
                            }}
                          >
                            <b>{i + 1}</b>
                          </span>
                        ))}
                    </div>
                  </div>
                </figure>
              </div>

              <aside className="lp-wt-side" aria-live={autoplaying ? 'off' : 'polite'}>
                <p className="lp-wt-kicker">
                  Step {index + 1} of {TOTAL}
                </p>
                <h3 className="lp-wt-title">{step.title}</h3>
                <p className="lp-wt-text">{step.body}</p>
                <ol className="lp-wt-legend">
                  {step.callouts.map((c, i) => (
                    <li key={c.label}>
                      <b aria-hidden="true">{i + 1}</b>
                      <span>{c.label}</span>
                    </li>
                  ))}
                </ol>
                {step.scope && <p className="lp-wt-scope">{step.scope}</p>}
              </aside>
            </div>
          ) : (
            <div key="end" className="lp-wt-end" aria-live={autoplaying ? 'off' : 'polite'}>
              <p className="lp-wt-kicker">
                Step {TOTAL} of {TOTAL}
              </p>
              <h3 className="lp-wt-end-title">That&rsquo;s QTestHub. Now see it with your own projects.</h3>
              <p className="lp-wt-text">
                A personalized demo walks through the workflows that matter to your team. Already have an account? Sign
                in to continue.
              </p>
              <div className="lp-wt-end-actions">
                <Link to="/request-demo" className="lp-btn lp-btn-light">
                  Request a Demo
                  <ArrowRight className="lp-arrow size-4" aria-hidden="true" />
                </Link>
                <Link to="/login" className="lp-btn lp-btn-ghost-dark">
                  Sign In
                </Link>
                <button type="button" className="lp-wt-replay" onClick={() => go(0)}>
                  <RotateCcw className="size-4" aria-hidden="true" />
                  Replay tour
                </button>
              </div>
            </div>
          )}
        </div>

        <footer className="lp-wt-foot">
          <ol className="lp-wt-segs" aria-label="Tour progress">
            {Array.from({ length: TOTAL }, (_, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="lp-wt-seg"
                  data-state={i < index ? 'done' : i === index ? 'current' : 'todo'}
                  aria-label={`Go to step ${i + 1}: ${i < LAST ? STEPS[i].title : 'Get started'}`}
                  aria-current={i === index ? 'step' : undefined}
                  onClick={() => go(i)}
                >
                  <i
                    key={i === index ? `${index}-${autoplaying}` : 'idle'}
                    data-run={i === index && autoplaying}
                    style={{ '--ms': `${STEP_MS}ms` } as CSSProperties}
                  />
                </button>
              </li>
            ))}
          </ol>
          <div className="lp-wt-nav">
            <button
              type="button"
              className="lp-btn lp-btn-sm lp-btn-ghost-dark"
              onClick={() => go(index - 1)}
              aria-disabled={index === 0}
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back
            </button>
            <button
              type="button"
              className="lp-btn lp-btn-sm lp-btn-light"
              onClick={() => go(index + 1)}
              aria-disabled={index === LAST}
            >
              Next
              <ArrowRight className="size-4" aria-hidden="true" />
            </button>
          </div>
        </footer>
      </div>
    </div>,
    portalRoot,
  )
}
