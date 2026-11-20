import { ArrowUp, List } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { HOME_SECTIONS } from './homeSections'
import { prefersReducedMotion } from './utils'

/** Thin bar under the header that fills as the page is read. Updates a CSS
 * transform straight from the scroll handler, so it never re-renders React. */
export function ScrollProgress() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const max = document.documentElement.scrollHeight - window.innerHeight
      const ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0
      if (ref.current) ref.current.style.transform = `scaleX(${ratio})`
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])
  return <div ref={ref} className="lp-progress" role="presentation" data-testid="lp-progress" />
}

/** Round button that returns to the top once the first screen is behind. */
export function BackToTop() {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const update = () => setVisible(window.scrollY > window.innerHeight)
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [])
  return (
    <button
      type="button"
      className="lp-top-btn"
      data-visible={visible}
      inert={!visible}
      aria-label="Back to top"
      onClick={() => {
        window.scrollTo({
          top: 0,
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        })
        document.getElementById('lp-main')?.focus({ preventScroll: true })
      }}
    >
      <ArrowUp className="size-5" aria-hidden="true" />
    </button>
  )
}

/** Section in view = the last heading above a reference line at 35% of the
 * viewport, so a long section keeps its dot and scrolling up updates it. */
function useActiveSection(ready: number) {
  const [active, setActive] = useState(HOME_SECTIONS[0].id)
  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const line = window.innerHeight * 0.35
      let current = HOME_SECTIONS[0].id
      for (const { id } of HOME_SECTIONS) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= line) current = id
      }
      setActive(current)
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [ready])
  return active
}

/** Home sections as a guided story. From 1280px a rail of dots (labels on
 * hover/focus); below that a "Sections" pill that opens a short list. The
 * section in view carries aria-current="location". */
export function SectionRail({ ready }: { ready: number }) {
  const active = useActiveSection(ready)
  const [open, setOpen] = useState(false)
  const [shown, setShown] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const update = () => setShown(window.scrollY > window.innerHeight * 0.6)
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      box.current?.querySelector<HTMLElement>('button')?.focus()
    }
    const onPointer = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer)
    }
  }, [open])

  const links = (compact: boolean) =>
    HOME_SECTIONS.map(({ id, label }) => (
      <li key={id}>
        <Link
          to={`/#${id}`}
          className="lp-rail-dot"
          aria-current={active === id ? 'location' : undefined}
          onClick={compact ? () => setOpen(false) : undefined}
        >
          <span className="lp-rail-label">{label}</span>
          <span className="lp-rail-pip" aria-hidden="true" />
        </Link>
      </li>
    ))
  return (
    <>
      <nav className="lp-rail" aria-label="Page sections">
        <ol>{links(false)}</ol>
      </nav>
      <div ref={box} className="lp-sections" data-visible={shown || open} inert={!(shown || open)}>
        <button
          type="button"
          className="lp-sections-btn"
          aria-expanded={open}
          aria-controls="lp-sections-list"
          onClick={() => setOpen((v) => !v)}
        >
          <List className="size-4" aria-hidden="true" />
          Sections
        </button>
        {open && (
          <nav id="lp-sections-list" className="lp-sections-list" aria-label="Page sections list">
            <ol>{links(true)}</ol>
          </nav>
        )}
      </div>
    </>
  )
}
