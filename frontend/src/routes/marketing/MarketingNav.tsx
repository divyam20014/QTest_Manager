import {
  ArrowRight,
  BarChart3,
  Briefcase,
  ChevronDown,
  Cpu,
  LayoutGrid,
  type LucideIcon,
  Menu,
  ShieldCheck,
  Sparkles,
  UsersRound,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'

import { LogoMark } from './shared'
import { prefersReducedMotion } from './utils'

interface MenuLink {
  to: string
  label: string
  description: string
  icon: LucideIcon
}

const MENUS: Array<{ id: string; label: string; links: MenuLink[] }> = [
  {
    id: 'platform',
    label: 'Platform',
    links: [
      {
        to: '/platform',
        label: 'Platform Overview',
        description: 'How QTestHub connects the QA lifecycle',
        icon: LayoutGrid,
      },
      {
        to: '/features',
        label: 'Features',
        description: 'Every module, in detail',
        icon: Sparkles,
      },
      {
        to: '/quality-intelligence',
        label: 'Quality Intelligence',
        description: 'Insights for better release decisions',
        icon: Cpu,
      },
      {
        to: '/security',
        label: 'Security',
        description: 'Access control, isolation and audit',
        icon: ShieldCheck,
      },
    ],
  },
  {
    id: 'solutions',
    label: 'Solutions',
    links: [
      {
        to: '/solutions#qa-managers',
        label: 'For QA Managers',
        description: 'Visibility into progress and quality',
        icon: BarChart3,
      },
      {
        to: '/solutions#qa-teams',
        label: 'For QA Teams',
        description: 'Structured planning and execution',
        icon: UsersRound,
      },
      {
        to: '/solutions#engineering',
        label: 'For Engineering Organizations',
        description: 'Delivery risk and governance',
        icon: Briefcase,
      },
    ],
  },
]

const TOP_LINKS = [
  { to: '/about', label: 'About Us' },
  { to: '/pricing', label: 'Pricing' },
]

function isCurrent(to: string, pathname: string, hash: string) {
  const [path, fragment] = to.split('#')
  return path === pathname && (!fragment || `#${fragment}` === hash)
}

export function MarketingNav() {
  const { pathname, hash } = useLocation()
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const navRef = useRef<HTMLElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const mobileRef = useRef<HTMLDivElement>(null)
  const [closing, setClosing] = useState(false)

  const closeMobile = (returnFocus = true) => {
    if (returnFocus) toggleRef.current?.focus()
    if (prefersReducedMotion()) {
      setMobileOpen(false)
      return
    }
    setClosing(true)
    window.setTimeout(() => {
      setMobileOpen(false)
      setClosing(false)
    }, 160)
  }

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!openMenu) return
    const onPointer = (event: MouseEvent) => {
      if (!navRef.current?.contains(event.target as Node)) setOpenMenu(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      document.getElementById(`lp-menu-btn-${openMenu}`)?.focus()
      setOpenMenu(null)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [openMenu])

  useEffect(() => {
    if (!mobileOpen) return
    mobileRef.current?.querySelector<HTMLElement>('a, button')?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMobile()
        return
      }
      if (event.key !== 'Tab') return
      // Keep Tab inside the menu and its toggle while it is open.
      const items = [
        toggleRef.current,
        ...(mobileRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? []),
      ].filter((el): el is HTMLElement => !!el)
      const first = items[0]
      const last = items[items.length - 1]
      const current = document.activeElement
      if (event.shiftKey && current === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && current === last) {
        event.preventDefault()
        first.focus()
      } else if (!items.includes(current as HTMLElement)) {
        event.preventDefault()
        first.focus()
      }
    }
    const onResize = () => {
      if (window.innerWidth >= 1024) setMobileOpen(false)
    }
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileOpen])

  return (
    <header ref={navRef} className="lp-nav" data-scrolled={scrolled || mobileOpen} data-condensed={scrolled}>
      <nav aria-label="Primary" className="lp-container lp-nav-bar flex items-center justify-between gap-4">
        <Link to="/" className="flex shrink-0 items-center gap-2.5 text-[var(--lp-on-dark)]" aria-label="QTestHub home">
          <LogoMark />
          <span className="text-[17px] font-semibold tracking-tight">QTestHub</span>
        </Link>

        <ul className="hidden items-center gap-1 lg:flex">
          {MENUS.map((menu) => {
            const open = openMenu === menu.id
            return (
              <li key={menu.id} className="relative">
                <button
                  id={`lp-menu-btn-${menu.id}`}
                  type="button"
                  className="lp-nav-link"
                  aria-expanded={open}
                  aria-controls={`lp-menu-${menu.id}`}
                  onClick={() => setOpenMenu(open ? null : menu.id)}
                >
                  {menu.label}
                  <ChevronDown className="size-3.5" aria-hidden="true" />
                </button>
                {open && (
                  <div id={`lp-menu-${menu.id}`} className="lp-dropdown">
                    <ul className="grid gap-0.5">
                      {menu.links.map(({ to, label, description, icon: Icon }) => (
                        <li key={to}>
                          <Link
                            to={to}
                            className="lp-dropdown-item"
                            aria-current={isCurrent(to, pathname, hash) ? 'page' : undefined}
                          >
                            <span className="lp-icon lp-icon-sm">
                              <Icon className="size-4" aria-hidden="true" />
                            </span>
                            <span>
                              <span className="block text-[14px] font-semibold">{label}</span>
                              <span className="block text-[13px] text-[var(--lp-ink-3)]">{description}</span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            )
          })}
          {TOP_LINKS.map((link) => (
            <li key={link.to}>
              <NavLink to={link.to} className="lp-nav-link">
                {link.label}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <Link to="/login" className="lp-nav-link whitespace-nowrap">
            Sign In
          </Link>
          <span className="hidden sm:inline-flex">
            <Link to="/request-demo" className="lp-btn lp-btn-light lp-btn-sm">
              Request a Demo
              <ArrowRight className="lp-arrow size-4" aria-hidden="true" />
            </Link>
          </span>
          <button
            ref={toggleRef}
            type="button"
            className="inline-flex size-11 items-center justify-center rounded-lg text-[var(--lp-on-dark)] hover:bg-white/10 lg:hidden"
            aria-expanded={mobileOpen}
            aria-controls="lp-mobile-menu"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            onClick={() => (mobileOpen && !closing ? closeMobile(false) : setMobileOpen(true))}
          >
            {mobileOpen ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}
          </button>
        </div>
      </nav>

      {mobileOpen && (
        <div
          id="lp-mobile-menu"
          ref={mobileRef}
          role="dialog"
          aria-label="Site menu"
          data-closing={closing}
          className="lp-mobile-menu lg:hidden"
        >
          <div className="lp-container grid gap-6 py-5">
            {MENUS.map((menu) => (
              <div key={menu.id}>
                <p className="px-3 text-[12px] font-semibold uppercase tracking-wider text-[var(--lp-on-dark-3)]">
                  {menu.label}
                </p>
                <ul className="mt-2 grid gap-0.5">
                  {menu.links.map(({ to, label }) => (
                    <li key={to}>
                      <Link
                        to={to}
                        className="flex min-h-11 items-center rounded-lg px-3 text-[15px] font-medium text-[var(--lp-on-dark)] hover:bg-white/5"
                        aria-current={isCurrent(to, pathname, hash) ? 'page' : undefined}
                      >
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <ul className="grid gap-0.5 border-t border-white/10 pt-4">
              {TOP_LINKS.map((link) => (
                <li key={link.to}>
                  <NavLink
                    to={link.to}
                    className="flex min-h-11 items-center rounded-lg px-3 text-[15px] font-medium text-[var(--lp-on-dark)] hover:bg-white/5"
                  >
                    {link.label}
                  </NavLink>
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-2 gap-3 border-t border-white/10 pt-4">
              <Link to="/login" className="lp-btn lp-btn-ghost-dark">
                Sign In
              </Link>
              <Link to="/request-demo" className="lp-btn lp-btn-light">
                Request a Demo
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
