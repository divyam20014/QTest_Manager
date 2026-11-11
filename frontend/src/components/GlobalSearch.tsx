import { useQuery } from '@tanstack/react-query'
import { Bug, ClipboardList, FileStack, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { search, type SearchResultEntry, type SearchResultType } from '@/api/search'

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

export function GlobalSearch() {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const { data, isFetching } = useQuery({
    queryKey: ['global-search', query],
    queryFn: () => search(query),
    enabled: query.trim().length > 1,
  })

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const results = query.trim().length > 1 ? (data?.results ?? []) : []

  return (
    <div
      ref={containerRef}
      role="search"
      className="relative hidden w-72 md:block"
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <input
          type="search"
          name="qtesthub-global-search"
          placeholder="Search test cases, defects, requirements…"
          aria-label="Search test cases, defects, and requirements"
          // Bug report: this field was getting browser-autofilled with an
          // email address on Dashboard/Settings -- Chrome heuristically
          // matches a bare "search" input against saved form data unless
          // explicitly told not to. `off` is the correct value here (not
          // a specific autofill token, since there's nothing to suggest).
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] py-1.5 pl-8 pr-7 text-sm text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[var(--ring)]"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQuery('')
              setOpen(false)
            }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {open && query.trim().length > 1 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--background)] shadow-lg">
          {isFetching && results.length === 0 && (
            <p className="px-3 py-3 text-sm text-[var(--muted-foreground)]">Searching…</p>
          )}
          {!isFetching && results.length === 0 && (
            <p className="px-3 py-3 text-sm text-[var(--muted-foreground)]">No results</p>
          )}
          {results.map((entry) => {
            const Icon = TYPE_ICON[entry.type]
            return (
              <button
                key={`${entry.type}-${entry.id}`}
                type="button"
                onClick={() => {
                  setOpen(false)
                  setQuery('')
                  navigate(pathFor(entry))
                }}
                className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--muted)]"
              >
                <Icon className="mt-0.5 size-4 shrink-0 text-[var(--muted-foreground)]" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[var(--foreground)]">{entry.title}</span>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {TYPE_LABEL[entry.type]} · {entry.project_name}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
