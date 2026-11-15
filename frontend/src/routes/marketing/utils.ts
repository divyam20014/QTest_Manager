import { type CSSProperties, useEffect, useRef } from 'react'

export const NAV_ITEMS = [
  { id: 'platform', label: 'Platform' },
  { id: 'features', label: 'Features' },
  { id: 'solutions', label: 'Solutions' },
  { id: 'about', label: 'About' },
] as const

export const CURRENT_YEAR = new Date().getFullYear()

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function scrollToSection(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })
  history.replaceState(null, '', `#${id}`)
}

export function delay(ms: number): CSSProperties {
  return { '--lp-delay': `${ms}ms` } as CSSProperties
}

/** Adds `is-visible` to every `.lp-reveal` inside the root once it scrolls
 * into view. The root only opts into the hidden initial state after mount,
 * so content is never hidden if JS or IntersectionObserver is unavailable. */
export function useRevealOnScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const root = ref.current
    if (!root || typeof IntersectionObserver === 'undefined' || prefersReducedMotion()) return
    root.dataset.reveal = 'on'
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
            observer.unobserve(entry.target)
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    )
    root.querySelectorAll('.lp-reveal').forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])
  return ref
}
