import { ArrowRight, Menu, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { LogoMark, SectionLink } from './shared'
import { NAV_ITEMS } from './utils'

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('a, button')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        toggleRef.current?.focus()
      }
    }
    const onResize = () => {
      if (window.innerWidth >= 1024) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  return (
    <header className="lp-nav" data-scrolled={scrolled || open}>
      <nav aria-label="Primary" className="lp-container flex h-16 items-center justify-between gap-4">
        <Link to="/" className="flex shrink-0 items-center gap-2.5 text-white" aria-label="QTestHub home">
          <LogoMark />
          <span className="text-[17px] font-semibold tracking-tight">QTestHub</span>
        </Link>

        <ul className="hidden items-center gap-1 lg:flex">
          {NAV_ITEMS.map((item) => (
            <li key={item.id}>
              <SectionLink to={item.id} className="lp-nav-link">
                {item.label}
              </SectionLink>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <Link to="/login" className="lp-nav-link whitespace-nowrap">
            Sign In
          </Link>
          <span className="hidden sm:inline-flex">
            <Link to="/signup" className="lp-btn lp-btn-primary lp-btn-sm">
              Get Started
              <ArrowRight className="lp-arrow size-4" aria-hidden="true" />
            </Link>
          </span>
          <button
            ref={toggleRef}
            type="button"
            className="inline-flex size-10 items-center justify-center rounded-lg text-white hover:bg-white/10 lg:hidden"
            aria-expanded={open}
            aria-controls="lp-mobile-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}
          </button>
        </div>
      </nav>

      {open && (
        <div id="lp-mobile-menu" ref={menuRef} className="lp-mobile-menu lg:hidden">
          <ul className="lp-container flex flex-col gap-1 py-4">
            {NAV_ITEMS.map((item) => (
              <li key={item.id}>
                <SectionLink
                  to={item.id}
                  className="block rounded-lg px-3 py-3 text-base font-medium text-[var(--lp-on-dark)] hover:bg-white/5"
                  onNavigate={() => setOpen(false)}
                >
                  {item.label}
                </SectionLink>
              </li>
            ))}
            <li className="mt-3 grid grid-cols-2 gap-3 border-t border-white/10 pt-4">
              <Link to="/login" className="lp-btn lp-btn-ghost-dark">
                Sign In
              </Link>
              <Link to="/signup" className="lp-btn lp-btn-primary">
                Get Started
              </Link>
            </li>
          </ul>
        </div>
      )}
    </header>
  )
}
