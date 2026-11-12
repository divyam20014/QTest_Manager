import { useQuery } from '@tanstack/react-query'
import { Bug, ClipboardList, FileStack, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { isAdmin, isManagerOrAbove } from '@/api/auth'
import { search as searchApi, type SearchResultEntry, type SearchResultType } from '@/api/search'
import { NAV_SECTIONS } from '@/routes/AppShell'
import { useAuth } from '@/lib/auth'
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

interface PaletteItem {
  id: string
  label: string
  sublabel?: string
  group: 'Search results' | 'Quick actions' | 'Navigate'
  icon?: typeof FileStack
}

const GROUP_ORDER: PaletteItem['group'][] = ['Search results', 'Quick actions', 'Navigate']

/**
 * Phase 2: Ctrl+K / Cmd+K command palette. Reuses the existing global
 * search endpoint (`GlobalSearch.tsx` / `api/search.ts`) for "find
 * anything", and the same navigation routes/entry points already in the
 * sidebar (`NAV_SECTIONS`) for quick navigation -- no new creation flow
 * is invented; "Quick actions" navigate to the existing list page with
 * `?action=create`, which that page already honors to auto-open its
 * existing create dialog/drawer.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth()
  const navigate = useNavigate()
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
  const searchQuery = useQuery({
    queryKey: ['command-palette-search', trimmed],
    queryFn: () => searchApi(trimmed),
    enabled: open && trimmed.length > 1,
  })

  function go(path: string) {
    navigate(path)
    onClose()
  }

  const quickActions: { label: string; path: string }[] = [
    { label: 'Create Test Case', path: '/test-repository?action=create' },
    { label: 'Create Defect', path: '/defects?action=create' },
    { label: 'Create Project', path: '/projects?action=create' },
  ]

  const navEntries = useMemo(() => {
    const out: { label: string; sublabel: string; path: string }[] = []
    for (const section of NAV_SECTIONS) {
      for (const item of section.items) {
        const visible = item.allowedRoles?.includes('manager-or-above')
          ? isManagerOrAbove(user)
          : !item.adminOnly || isAdmin(user)
        if (!visible) continue
        out.push({ label: item.label, sublabel: section.label, path: item.to })
      }
    }
    return out
  }, [user])

  const items: (PaletteItem & { onSelect: () => void })[] = useMemo(() => {
    const lower = trimmed.toLowerCase()
    const matchesQuery = (label: string) => lower.length === 0 || label.toLowerCase().includes(lower)

    const searchItems =
      trimmed.length > 1
        ? (searchQuery.data?.results ?? []).map((entry) => ({
            id: `search-${entry.type}-${entry.id}`,
            label: entry.title,
            sublabel: `${TYPE_LABEL[entry.type]} · ${entry.project_name}`,
            group: 'Search results' as const,
            icon: TYPE_ICON[entry.type],
            onSelect: () => go(pathFor(entry)),
          }))
        : []

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

    return [...searchItems, ...actionItems, ...navItems]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed, searchQuery.data, navEntries])

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

  let runningIndex = -1

  return (
    <div
      className="qth-animate-in fixed inset-0 z-[100] flex items-start justify-center bg-black/40 p-4 pt-[12vh] backdrop-blur-[1px]"
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
          <kbd className="shrink-0 rounded border border-[var(--border)] bg-[var(--muted)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--muted-foreground)]">
            Esc
          </kbd>
        </div>
        <div className="max-h-96 overflow-y-auto p-1.5">
          {items.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-[var(--muted-foreground)]">
              {trimmed.length > 1 && searchQuery.isFetching ? 'Searching…' : 'No matches.'}
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
