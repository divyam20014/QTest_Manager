import { useQuery } from '@tanstack/react-query'
import { ChevronsUpDown, Search } from 'lucide-react'
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { listProjects } from '@/api/projects'
import { useAuth } from '@/lib/auth'
import { type ProjectTabKey, switchTarget } from '@/lib/projectNav'
import { useRecents } from '@/lib/useRecents'
import { cn } from '@/lib/utils'

/**
 * Project switcher (ADR-122): a searchable combobox in the project header. Recent projects come
 * first, then the rest A to Z. Choosing one goes to the same tab in that project when it has the
 * tab (not hidden there, allowed for you), otherwise to its Overview.
 */
export function ProjectSwitcher({
  projectId,
  projectName,
  tabKey,
}: {
  projectId: string
  projectName: string
  tabKey: ProjectTabKey | null
}) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const recents = useRecents()
  const uid = useId()
  const listId = `${uid}-list`
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const projectsQuery = useQuery({
    queryKey: ['projects', 'switcher'],
    queryFn: () => listProjects({ page_size: 100, sort: 'name' }),
    enabled: open,
    staleTime: 30_000,
  })

  const options = useMemo(() => {
    const all = projectsQuery.data?.items ?? []
    const recentIds = recents.items.filter((r) => r.type === 'project').map((r) => r.id)
    const rank = (id: string) => {
      const i = recentIds.indexOf(id)
      return i === -1 ? Number.MAX_SAFE_INTEGER : i
    }
    const needle = query.trim().toLowerCase()
    return all
      .filter((p) => !needle || p.name.toLowerCase().includes(needle))
      .map((p, index) => ({ project: p, index, recent: rank(p.id) !== Number.MAX_SAFE_INTEGER }))
      .sort((a, b) => rank(a.project.id) - rank(b.project.id) || a.index - b.index)
  }, [projectsQuery.data, recents.items, query])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  function close(returnFocus: boolean) {
    setOpen(false)
    setQuery('')
    setActive(0)
    if (returnFocus) triggerRef.current?.focus()
  }

  function choose(index: number) {
    const option = options[index]
    if (!option) return
    close(false)
    if (option.project.id !== projectId) navigate(switchTarget(tabKey, option.project, user))
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((i) => Math.min(options.length - 1, i + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (event.key === 'Home') {
      event.preventDefault()
      setActive(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setActive(Math.max(0, options.length - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(active)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    } else if (event.key === 'Tab') {
      close(false)
    }
  }

  const activeId = options[active] ? `${uid}-opt-${options[active].project.id}` : undefined

  return (
    <div ref={rootRef} className="md:relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Switch project"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        data-testid="project-switcher"
        title={`Switch project (now ${projectName})`}
        onClick={() => (open ? close(true) : setOpen(true))}
        className="inline-flex size-8 items-center justify-center rounded-[var(--radius-control)] border border-[var(--border)] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] max-md:size-11 [&_svg]:size-4"
      >
        <ChevronsUpDown aria-hidden="true" />
      </button>
      {open && (
        <div
          data-overlay-popup=""
          className="absolute top-full z-50 mt-1 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--tactile-surface-raised)] p-2 shadow-lg max-md:inset-x-0 md:left-0 md:w-[22rem]"
        >
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]"
            />
            <input
              ref={inputRef}
              role="combobox"
              aria-label="Search projects"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={activeId}
              aria-autocomplete="list"
              autoComplete="off"
              placeholder="Search projects"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(0)
              }}
              onKeyDown={onKeyDown}
              className="h-9 w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--background)] pl-8 pr-2 text-sm placeholder:text-[var(--muted-foreground)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)] max-md:h-11"
            />
          </div>
          <ul id={listId} role="listbox" aria-label="Projects" className="mt-2 max-h-72 overflow-y-auto">
            {projectsQuery.isLoading && <li className="px-2 py-2 text-sm text-[var(--muted-foreground)]">Loading projects...</li>}
            {projectsQuery.isError && (
              <li className="px-2 py-2 text-sm text-[var(--muted-foreground)]">Could not load projects.</li>
            )}
            {projectsQuery.isSuccess && options.length === 0 && (
              <li className="px-2 py-2 text-sm text-[var(--muted-foreground)]">No project matches.</li>
            )}
            {options.map((o, i) => (
              <li
                key={o.project.id}
                id={`${uid}-opt-${o.project.id}`}
                role="option"
                aria-selected={o.project.id === projectId}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(i)}
                className={cn(
                  'flex min-h-9 cursor-pointer items-center justify-between gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-sm max-md:min-h-11',
                  i === active && 'bg-[var(--muted)]',
                  o.project.id === projectId && 'font-semibold',
                )}
              >
                <span className="min-w-0 truncate">{o.project.name}</span>
                <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
                  {o.project.id === projectId ? 'Current' : o.recent ? 'Recent' : o.project.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
