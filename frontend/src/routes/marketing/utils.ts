import { type CSSProperties, useEffect, useRef } from 'react'

export const CURRENT_YEAR = new Date().getFullYear()

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function delay(ms: number): CSSProperties {
  return { '--lp-delay': `${ms}ms` } as CSSProperties
}

/** Adds `is-visible` to every `.lp-reveal` inside the root once it scrolls
 * into view, re-scanning whenever `key` (the route) changes. The root only
 * opts into the hidden initial state after mount, so content is never hidden
 * if JS or IntersectionObserver is unavailable. */
export function useRevealOnScroll<T extends HTMLElement>(key: string) {
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
    root.querySelectorAll('.lp-reveal:not(.is-visible)').forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [key])
  return ref
}

const DEFAULT_DESCRIPTION =
  'Manage test cases, test plans, test execution, defects and quality analytics with QTestHub, an integrated enterprise QA management platform.'

/** Per-page <title> and meta description, restored when the page unmounts. */
export function usePageMeta(title: string, description: string = DEFAULT_DESCRIPTION) {
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    const previousTitle = document.title
    const previousDescription = meta?.content
    document.title = title
    if (meta) meta.content = description
    return () => {
      document.title = previousTitle
      if (meta && previousDescription !== undefined) meta.content = previousDescription
    }
  }, [title, description])
}
