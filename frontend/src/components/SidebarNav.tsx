import { ChevronDown, ExternalLink, History, Star, X } from 'lucide-react'
import {
  type ComponentType,
  type ReactNode,
  type Ref,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { Link, useLocation } from 'react-router-dom'

import { PIN_ICON } from '@/components/pinIcons'
import { useAuth } from '@/lib/auth'
import { navBadgeLabel, navBadgeText } from '@/lib/navBadges'
import {
  type BadgeCounts,
  type NavGroup,
  type NavLeaf,
  type ResolvedEntry,
  activeGroupId,
  isGroupActive,
  isLeafActive,
  leafBadge,
} from '@/lib/navRegistry'
import { PIN_TYPE_LABEL, type PinnedItem, pinKey } from '@/lib/pinnedItems'
import { useFavourites } from '@/lib/useFavourites'
import { useRecents } from '@/lib/useRecents'
import { cn } from '@/lib/utils'

type Icon = ComponentType<{ className?: string }>

// ---- shared styling --------------------------------------------------------------

const FOCUS =
  'outline-offset-[-2px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--sidebar-accent)]'
const ROW =
  'relative flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-sm text-[var(--sidebar-foreground)] transition-colors hover:bg-[var(--sidebar-bg-raised)] hover:text-white motion-reduce:transition-none'
// Active page: tinted fill + a 3px accent bar, so the state is not carried by colour alone.
const ACTIVE =
  'bg-[var(--sidebar-active-bg)] font-medium text-[var(--sidebar-active-foreground)] before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-r-full before:bg-[var(--sidebar-accent)]'

function rowClass(opts: { rail?: boolean; active?: boolean; className?: string }) {
  return cn(ROW, FOCUS, opts.rail && 'justify-center', opts.active && ACTIVE, opts.className)
}

// ---- remembered open/closed state -------------------------------------------------

function readOpenState(key: string | null): Record<string, boolean> {
  if (!key) return {}
  try {
    const raw = localStorage.getItem(key)
    const data: unknown = raw ? JSON.parse(raw) : {}
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return {}
    return Object.fromEntries(Object.entries(data).filter(([, v]) => typeof v === 'boolean'))
  } catch {
    return {}
  }
}

/**
 * Open/closed state of the groups and the Favourites / Recent sections, remembered per
 * tenant and user. Everything is open until the user closes it. Storage failures just mean
 * the state is not remembered across reloads.
 */
function useOpenState(autoOpenId: string | null) {
  const { user } = useAuth()
  const key = user ? `qtesthub:nav-groups:${user.tenant_id}:${user.user_id}` : null
  const [store, setStore] = useState(() => ({ key, data: readOpenState(key) }))
  // A different signed-in user reads their own remembered state.
  const data = store.key === key ? store.data : readOpenState(key)

  const setOpen = useCallback(
    (id: string, value: boolean) => {
      setStore((prev) => {
        const base = prev.key === key ? prev.data : readOpenState(key)
        if ((base[id] !== false) === value) return prev.key === key ? prev : { key, data: base }
        const next = { ...base, [id]: value }
        if (key) {
          try {
            localStorage.setItem(key, JSON.stringify(next))
          } catch {
            // Blocked storage: the toggle still works for this page view.
          }
        }
        return { key, data: next }
      })
    },
    [key],
  )

  // The group holding the current page opens when you arrive there (including by URL).
  // Only the route triggers this, so closing it by hand sticks until you navigate again.
  const { pathname } = useLocation()
  useEffect(() => {
    if (autoOpenId) setOpen(autoOpenId, true)
  }, [pathname, autoOpenId, setOpen])

  return { isOpen: (id: string) => data[id] !== false, setOpen }
}

// ---- collapsed-rail tooltip --------------------------------------------------------

// The nav is overflow-clipped, so tooltips are position:fixed, placed from the element's
// bounding box on hover / keyboard focus; Escape dismisses.
function useRailTip(enabled: boolean, externalRef?: RefObject<HTMLElement | null>) {
  const [tip, setTip] = useState<{ top: number; left: number } | null>(null)
  const ownRef = useRef<HTMLElement>(null)
  const ref = externalRef ?? ownRef
  const show = () => {
    if (!enabled || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    setTip({ top: r.top + r.height / 2, left: r.right + 8 })
  }
  const hide = () => setTip(null)
  useEffect(() => {
    if (!tip) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTip(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [tip])
  return { ref, tip, events: { onMouseEnter: show, onMouseLeave: hide, onFocus: show, onBlur: hide } }
}

function RailTooltip({ tip, label }: { tip: { top: number; left: number } | null; label: string }) {
  if (!tip) return null
  return (
    <span
      role="tooltip"
      style={{ top: tip.top, left: tip.left }}
      className="pointer-events-none fixed z-[var(--z-overlay)] -translate-y-1/2 whitespace-nowrap rounded-[var(--radius-control)] bg-[var(--foreground)] px-2 py-1 text-xs text-[var(--background)] shadow-md"
    >
      {label}
    </span>
  )
}

// ---- one link -----------------------------------------------------------------------

export function SidebarLink({
  item,
  collapsed,
  counts,
  className,
}: {
  item: NavLeaf
  /** Icon-rail rendering: icon only, with tooltip. */
  collapsed: boolean
  counts?: BadgeCounts
  className?: string
}) {
  const { pathname } = useLocation()
  const { ref, tip, events } = useRailTip(collapsed)
  const active = isLeafActive(item, pathname)
  const badgeInfo = counts ? leafBadge(item, counts) : null
  const count = badgeInfo?.count ?? 0
  const badge = navBadgeText(count)
  const badgedLabel = badge ? navBadgeLabel(item.label, count, badgeInfo?.noun) : item.label

  const content = (
    <>
      <span className="relative flex shrink-0">
        <item.icon className="size-4 shrink-0" aria-hidden="true" />
        {badge && collapsed && (
          <span
            aria-hidden="true"
            className="absolute -right-1.5 -top-1.5 flex min-w-3.5 items-center justify-center rounded-full bg-[var(--sidebar-accent)] px-0.5 text-[9px] font-semibold leading-3.5 text-[var(--sidebar-bg)]"
          >
            {badge}
          </span>
        )}
      </span>
      {!collapsed && (
        <span className="truncate">
          {item.label}
          {badge && (
            <span className="sr-only">
              , {count} {badgeInfo?.noun ?? 'open'}
            </span>
          )}
        </span>
      )}
      {badge && !collapsed && (
        <span
          aria-hidden="true"
          className="ml-auto rounded-full bg-[var(--sidebar-bg-raised)] px-1.5 text-[11px] font-medium leading-5 text-[var(--sidebar-foreground)]"
        >
          {badge}
        </span>
      )}
      {item.newTab && !collapsed && <ExternalLink className="ml-auto size-3 shrink-0 opacity-70" aria-hidden="true" />}
      {item.newTab && <span className="sr-only"> (opens in a new tab)</span>}
    </>
  )

  const cls = rowClass({ rail: collapsed, active, className })
  return (
    <>
      {item.newTab ? (
        <a
          ref={ref as Ref<HTMLAnchorElement>}
          href={item.to}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={collapsed ? `${badgedLabel} (opens in a new tab)` : undefined}
          data-testid={`nav-${item.id}`}
          className={cls}
          {...events}
        >
          {content}
        </a>
      ) : (
        <Link
          ref={ref as Ref<HTMLAnchorElement>}
          to={item.to}
          aria-label={collapsed ? badgedLabel : undefined}
          aria-current={active ? 'page' : undefined}
          data-testid={`nav-${item.id}`}
          className={cls}
          {...events}
        >
          {content}
        </Link>
      )}
      {collapsed && <RailTooltip tip={tip} label={badgedLabel} />}
    </>
  )
}

// ---- icon-rail flyout (groups, favourites, recent) -------------------------------

function RailFlyout({
  icon: IconCmp,
  label,
  active,
  testId,
  children,
}: {
  icon: Icon
  label: string
  active?: boolean
  testId?: string
  children: ReactNode
}) {
  // Open for the page it was opened on: any navigation closes it without an effect.
  const { pathname } = useLocation()
  const [openAt, setOpenAt] = useState<string | null>(null)
  const open = openAt === pathname
  const setOpen = (value: boolean) => setOpenAt(value ? pathname : null)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const tipState = useRailTip(!open, buttonRef)

  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenAt(null)
        buttonRef.current?.focus()
      }
    }
    const onMouseDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpenAt(null)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onMouseDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [open])

  function toggle() {
    if (!open && buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect()
      setPos({ top: Math.max(8, r.top), left: r.right + 8 })
    }
    tipState.events.onMouseLeave()
    setOpen(!open)
  }

  return (
    <div
      ref={wrapRef}
      onBlur={(event) => {
        if (open && !wrapRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={open ? panelId : undefined}
        aria-current={active ? 'true' : undefined}
        data-testid={testId}
        onClick={toggle}
        className={rowClass({ rail: true, active })}
        {...tipState.events}
      >
        <IconCmp className="size-4 shrink-0" aria-hidden="true" />
      </button>
      {!open && <RailTooltip tip={tipState.tip} label={label} />}
      {open && (
        <div
          id={panelId}
          role="group"
          aria-label={label}
          style={{ top: pos.top, left: pos.left, maxHeight: `calc(100vh - ${pos.top}px - 16px)` }}
          className="fixed z-[var(--z-overlay)] flex w-60 flex-col gap-0.5 overflow-y-auto rounded-lg border border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] p-1.5 shadow-lg"
        >
          <p className="px-2.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--sidebar-foreground-muted)]">
            {label}
          </p>
          {children}
        </div>
      )}
    </div>
  )
}

// ---- an expandable group ------------------------------------------------------------

function SidebarGroup({
  group,
  collapsed,
  counts,
  open,
  onToggle,
}: {
  group: NavGroup
  collapsed: boolean
  counts: BadgeCounts
  open: boolean
  onToggle: (open: boolean) => void
}) {
  const { pathname } = useLocation()
  const panelId = useId()
  const holdsActive = isGroupActive(group, pathname)

  if (collapsed) {
    return (
      <RailFlyout icon={group.icon} label={group.label} active={holdsActive} testId={`nav-group-${group.id}`}>
        {group.items.map((leaf) => (
          <SidebarLink key={leaf.id} item={leaf} collapsed={false} counts={counts} />
        ))}
      </RailFlyout>
    )
  }

  return (
    <div className="flex flex-col gap-0.5">
      {/* A toggle, never a link: it only opens and closes its list. */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        data-testid={`nav-group-${group.id}`}
        onClick={() => onToggle(!open)}
        className={rowClass({ className: cn('font-medium', !open && holdsActive && 'text-white') })}
      >
        <group.icon className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{group.label}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'ml-auto size-3.5 shrink-0 text-[var(--sidebar-foreground-muted)] transition-transform duration-150 motion-reduce:transition-none',
            !open && '-rotate-90',
          )}
        />
      </button>
      <ul
        id={panelId}
        hidden={!open}
        className="ml-3.5 flex flex-col gap-0.5 border-l border-[var(--sidebar-border)] pl-1"
      >
        {group.items.map((leaf) => (
          <li key={leaf.id}>
            <SidebarLink item={leaf} collapsed={false} counts={counts} className="gap-2 px-2" />
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---- favourites and recent ---------------------------------------------------------

function PinnedRow({
  item,
  noun,
  onRemove,
}: {
  item: PinnedItem
  noun: 'favourites' | 'recent'
  onRemove: () => void
}) {
  const TypeIcon = PIN_ICON[item.type]
  const { pathname } = useLocation()
  const here = pathname === item.url.split('?')[0]
  const titleId = useId()
  return (
    <li className="group/pin relative">
      <Link
        to={item.url}
        title={`${PIN_TYPE_LABEL[item.type]}: ${item.title}`}
        className={rowClass({ active: here, className: 'pr-8' })}
      >
        <TypeIcon className="size-4 shrink-0" aria-hidden="true" />
        <span id={titleId} className="truncate">{item.title}</span>
      </Link>
      <button
        type="button"
        // The title is the description, not part of the name, so the button never matches a
        // search for a page's own words (an item called "Edited payout" is not an Edit button).
        aria-label={noun === 'favourites' ? 'Unpin favourite' : 'Clear from recent'}
        aria-describedby={titleId}
        onClick={onRemove}
        className="absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-[var(--sidebar-foreground-muted)] opacity-0 hover:bg-[var(--sidebar-bg)] hover:text-white focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--sidebar-accent)] group-focus-within/pin:opacity-100 group-hover/pin:opacity-100 pointer-coarse:opacity-100"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </li>
  )
}

function PinnedSection({
  id,
  label,
  noun,
  icon: IconCmp,
  items,
  collapsed,
  open,
  onToggle,
  onRemove,
}: {
  id: 'favourites' | 'recent'
  label: string
  noun: 'favourites' | 'recent'
  icon: Icon
  items: PinnedItem[]
  collapsed: boolean
  open: boolean
  onToggle: (open: boolean) => void
  onRemove: (key: string) => void
}) {
  const panelId = useId()
  if (items.length === 0) return null

  const rows = items.map((item) => (
    <PinnedRow key={pinKey(item)} item={item} noun={noun} onRemove={() => onRemove(pinKey(item))} />
  ))

  if (collapsed) {
    return (
      <RailFlyout icon={IconCmp} label={label} testId={`nav-pinned-${id}`}>
        <ul className="flex flex-col gap-0.5">{rows}</ul>
      </RailFlyout>
    )
  }

  return (
    <section aria-label={label} className="flex flex-col gap-0.5">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        data-testid={`nav-pinned-${id}`}
        onClick={() => onToggle(!open)}
        className={cn(
          ROW,
          FOCUS,
          'h-8 text-[11px] font-semibold uppercase tracking-wider text-[var(--sidebar-foreground-muted)]',
        )}
      >
        <span className="truncate">{label}</span>
        <span className="ml-auto flex items-center gap-1.5 font-medium normal-case tracking-normal">
          <span aria-hidden="true">{items.length}</span>
          <ChevronDown
            aria-hidden="true"
            className={cn('size-3.5 transition-transform duration-150 motion-reduce:transition-none', !open && '-rotate-90')}
          />
        </span>
      </button>
      <ul id={panelId} hidden={!open} className="flex flex-col gap-0.5">
        {rows}
      </ul>
    </section>
  )
}

// ---- the whole navigation ------------------------------------------------------------

export function SidebarNav({
  entries,
  collapsed,
  counts,
  announcement,
}: {
  entries: ResolvedEntry[]
  collapsed: boolean
  counts: BadgeCounts
  /** Polite live-region text for badge changes. */
  announcement: string
}) {
  const { pathname } = useLocation()
  const { isOpen, setOpen } = useOpenState(activeGroupId(entries, pathname))
  const favourites = useFavourites()
  const recents = useRecents()

  return (
    <nav
      aria-label="Workspace"
      className="flex flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden px-3 pb-4"
    >
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
      {entries.map((entry) =>
        entry.kind === 'link' ? (
          <SidebarLink key={entry.item.id} item={entry.item} collapsed={collapsed} counts={counts} />
        ) : (
          <SidebarGroup
            key={entry.group.id}
            group={entry.group}
            collapsed={collapsed}
            counts={counts}
            open={isOpen(entry.group.id)}
            onToggle={(v) => setOpen(entry.group.id, v)}
          />
        ),
      )}
      {(favourites.items.length > 0 || recents.items.length > 0) && (
        <hr aria-hidden="true" className="mx-2 my-2 border-0 border-t border-[var(--sidebar-border)]" />
      )}
      <PinnedSection
        id="favourites"
        label="Favourites"
        noun="favourites"
        icon={Star}
        items={favourites.items}
        collapsed={collapsed}
        open={isOpen('favourites')}
        onToggle={(v) => setOpen('favourites', v)}
        onRemove={favourites.remove}
      />
      <PinnedSection
        id="recent"
        label="Recent"
        noun="recent"
        icon={History}
        items={recents.items}
        collapsed={collapsed}
        open={isOpen('recent')}
        onToggle={(v) => setOpen('recent', v)}
        onRemove={recents.remove}
      />
    </nav>
  )
}
