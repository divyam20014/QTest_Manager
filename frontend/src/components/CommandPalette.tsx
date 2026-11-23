import { useQuery } from '@tanstack/react-query'
import { Bug, Building2, ClipboardList, FileStack, History, PlayCircle, Search, Star } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { listAllTestRuns } from '@/api/execution'
import { listProjects } from '@/api/projects'
import { search as searchApi, type SearchResultEntry, type SearchResultType } from '@/api/search'
import { useAuth } from '@/lib/auth'
import { PALETTE_EXTRA_ENTRIES, paletteEntries, resolveRegistry } from '@/lib/navRegistry'
import { PIN_TYPE_LABEL } from '@/lib/pinnedItems'
import { getQuickCreateActions, projectIdFromPath } from '@/lib/quickCreate'
import { canAccessPath } from '@/lib/routeAccess'
import { useFavourites } from '@/lib/useFavourites'
import { useRecents } from '@/lib/useRecents'
import { cn } from '@/lib/utils'

const TYPE_ICON: Record<SearchResultType, typeof FileStack> = {
  test_case: FileStack,
  defect: Bug,
  requirement: ClipboardList,
}
const TYPE_LABEL: Record<SearchResultType, string> = {
  test_case: 'Test Case',
  defect: 'Defect',
  requirement: 'Requirement',
}
function pathFor(entry: SearchResultEntry): string {
  switch (entry.type) {
    case 'test_case':
      return `/test-cases/${entry.id}`
    case 'defect':
      return `/defects/${entry.id}`
    case 'requirement':
      return `/requirements/${entry.id}`
  }
}

type Group = 'Favourites' | 'Recent' | 'Search results' | 'Quick actions' | 'Navigate'

interface PaletteItem {
  id: string
  label: string
  sublabel?: string
  group: Group
  icon?: typeof FileStack
}

const GROUP_ORDER: Group[] = ['Search results', 'Favourites', 'Recent', 'Quick actions', 'Navigate']
// With nothing typed, show a short list of the user's own shortcuts, not all of them.
const EMPTY_QUERY_PINNED_LIMIT = 5

/**
 * Ctrl+K / Cmd+K command palette (also opened by the top bar's search field). One place to
 * find a test case, defect, requirement, project or test run, jump to a page, start a create
 * flow, or reopen a favourite / recent record. Records come from the existing search
 * endpoint, the projects list and the runs list (server-side `search`); pages come from the
 * nav registry. Quick actions navigate to the existing create flows, filtered by permission.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const favourites = useFavourites()
  const recents = useRecents()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return undefined
    triggerRef.current = document.activeElement as HTMLElement | null
    setQuery('')
    setActiveIndex(0)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => {
      window.clearTimeout(timer)
      triggerRef.current?.focus?.()
    }
  }, [open])

  const trimmed = query.trim()
  const searching = open && trimmed.length > 1
  const searchQuery = useQuery({
    queryKey: ['command-palette-search', trimmed],
    queryFn: () => searchApi(trimmed),
    enabled: searching,
  })
  const projectsQuery = useQuery({
    queryKey: ['command-palette-projects', trimmed],
    queryFn: () => listProjects({ search: trimmed, page_size: 5 }),
    enabled: searching,
  })
  const runsQuery = useQuery({
    queryKey: ['command-palette-runs', trimmed],
    queryFn: () => listAllTestRuns({ search: trimmed, page_size: 5 }),
    enabled: searching,
  })

  function go(path: string) {
    navigate(path)
    onClose()
  }

  // Same permission-filtered list as the top bar's "+ New" menu.
  const quickActions = getQuickCreateActions(user, projectIdFromPath(pathname)).map((a) => ({
    label: a.paletteLabel,
    path: a.path,
  }))

  const navEntries = useMemo(() => {
    const out = paletteEntries(resolveRegistry(user))
    for (const extra of PALETTE_EXTRA_ENTRIES) {
      if (canAccessPath(user, extra.path)) out.push(extra)
    }
    return out
  }, [user])

  const items: (PaletteItem & { onSelect: () => void })[] = useMemo(() => {
    const lower = trimmed.toLowerCase()
    const matchesQuery = (label: string) => lower.length === 0 || label.toLowerCase().includes(lower)

    const recordItems = searching
      ? (searchQuery.data?.results ?? []).map((entry) => ({
          id: `search-${entry.type}-${entry.id}`,
          label: entry.title,
          sublabel: `${TYPE_LABEL[entry.type]} · ${entry.project_name}`,
          group: 'Search results' as const,
          icon: TYPE_ICON[entry.type],
          onSelect: () => go(pathFor(entry)),
        }))
      : []
    const projectItems = searching
      ? (projectsQuery.data?.items ?? []).map((p) => ({
          id: `project-${p.id}`,
          label: p.name,
          sublabel: 'Project',
          group: 'Search results' as const,
          icon: Building2,
          onSelect: () => go(`/projects/${p.id}`),
        }))
      : []
    const runItems = searching
      ? (runsQuery.data?.items ?? []).map((r) => ({
          id: `run-${r.id}`,
          label: r.name,
          sublabel: 'Test run',
          group: 'Search results' as const,
          icon: PlayCircle,
          onSelect: () => go(`/test-runs/${r.id}`),
        }))
      : []

    const pinnedItems = (list: typeof favourites.items, group: 'Favourites' | 'Recent', icon: typeof Star) =>
      list
        .filter((i) => matchesQuery(i.title))
        .slice(0, lower.length === 0 ? EMPTY_QUERY_PINNED_LIMIT : list.length)
        .map((i) => ({
          id: `${group}-${i.type}-${i.id}`,
          label: i.title,
          sublabel: PIN_TYPE_LABEL[i.type],
          group,
          icon,
          onSelect: () => go(i.url),
        }))

    const actionItems = quickActions
      .filter((a) => matchesQuery(a.label))
      .map((a) => ({
        id: `action-${a.path}`,
        label: a.label,
        group: 'Quick actions' as const,
        onSelect: () => go(a.path),
      }))

    const navItems = navEntries
      .filter((n) => matchesQuery(n.label))
      .map((n) => ({
        id: `nav-${n.path}`,
        label: n.label,
        sublabel: n.sublabel,
        group: 'Navigate' as const,
        onSelect: () => go(n.path),
      }))

    const all = [
      ...recordItems,
      ...projectItems,
      ...runItems,
      ...pinnedItems(favourites.items, 'Favourites', Star),
      ...pinnedItems(recents.items, 'Recent', History),
      ...actionItems,
      ...navItems,
    ]
    // Display order is by group; keep the keyboard order identical to it.
    return GROUP_ORDER.flatMap((g) => all.filter((i) => i.group === g))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    trimmed,
    searching,
    searchQuery.data,
    projectsQuery.data,
    runsQuery.data,
    navEntries,
    favourites.items,
    recents.items,
  ])

  useEffect(() => setActiveIndex(0), [trimmed])

  useEffect(() => {
    if (!open) return undefined
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, items.length - 1))
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((i) => Math.max(i - 1, 0))
      } else if (event.key === 'Enter') {
        event.preventDefault()
        items[activeIndex]?.onSelect()
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [open, items, activeIndex, onClose])

  if (!open) return null

  const fetching = searchQuery.isFetching || projectsQuery.isFetching || runsQuery.isFetching
  let runningIndex = -1

  return (
    <div
      className="qth-animate-in fixed inset-0 z-[100] flex items-start justify-center bg-[var(--overlay-backdrop)] p-4 pt-[12vh] backdrop-blur-sm"
      style={{ animation: 'qth-fade-in 0.12s ease-out' }}
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="qth-animate-in flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--background)] shadow-2xl"
        style={{ animation: 'qth-scale-in 0.14s ease-out' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
          <Search className="size-4 shrink-0 text-[var(--muted-foreground)]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search or jump to…"
            aria-label="Command palette search"
            autoComplete="off"
            className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--muted-foreground)]"
          />
          <kbd className="shrink-0 rounded-md border border-[var(--border)] bg-[var(--muted)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--muted-foreground)]">
            Esc
          </kbd>
        </div>
        <div className="max-h-96 overflow-y-auto p-1.5">
          {items.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-[var(--muted-foreground)]">
              {searching && fetching ? 'Searching…' : 'No matches.'}
            </p>
          )}
          {GROUP_ORDER.map((group) => {
            const groupItems = items.filter((i) => i.group === group)
            if (groupItems.length === 0) return null
            return (
              <div key={group} className="mb-1 last:mb-0">
                <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  {group}
                </p>
                {groupItems.map((item) => {
                  runningIndex += 1
                  const index = runningIndex
                  const Icon = item.icon
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => item.onSelect()}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm',
                        index === activeIndex ? 'bg-[var(--muted)]' : 'hover:bg-[var(--muted)]',
                      )}
                    >
                      {Icon && <Icon className="size-4 shrink-0 text-[var(--muted-foreground)]" />}
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{item.label}</span>
                        {item.sublabel && (
                          <span className="truncate text-xs text-[var(--muted-foreground)]">{item.sublabel}</span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
