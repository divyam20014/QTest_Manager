import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bookmark, Check, Pencil, Star, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { ApiError } from '@/api/client'
import {
  createSavedView,
  deleteSavedView,
  listSavedViews,
  type SavedView,
  updateSavedView,
  type ViewListKey,
} from '@/api/savedViews'
import { type ViewState, viewsKey } from './viewsHelpers'

// ADR-096: private, server-stored saved views (named filter + sort sets) for a list page.
// `current` is the page's active filters (only non-empty values); `onApply` maps a view
// back onto whatever URL/filter state the page already uses.

const ICON_BTN =
  'inline-flex size-9 shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] max-md:size-11'

export function ViewsMenu({
  listKey,
  current,
  onApply,
}: {
  listKey: ViewListKey
  current: ViewState
  onApply: (view: ViewState) => void
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const query = useQuery({ queryKey: viewsKey(listKey), queryFn: () => listSavedViews(listKey), staleTime: 60_000 })
  const views = query.data ?? []

  useEffect(() => {
    if (!open) return
    function handleClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  function onError(err: unknown) {
    setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.')
  }
  function refresh() {
    setError(null)
    return queryClient.invalidateQueries({ queryKey: viewsKey(listKey) })
  }

  const save = useMutation({
    mutationFn: () =>
      createSavedView({ list_key: listKey, name: name.trim(), filters: current.filters, sort: current.sort }),
    onSuccess: () => {
      setName('')
      void refresh()
    },
    onError,
  })
  const rename = useMutation({
    mutationFn: (v: { id: string; name: string }) => updateSavedView(v.id, { name: v.name.trim() }),
    onSuccess: () => {
      setRenaming(null)
      void refresh()
    },
    onError,
  })
  const setDefault = useMutation({
    mutationFn: (v: SavedView) => updateSavedView(v.id, { is_default: !v.is_default }),
    onSuccess: () => void refresh(),
    onError,
  })
  const remove = useMutation({
    mutationFn: (v: SavedView) => deleteSavedView(v.id),
    onSuccess: () => void refresh(),
    onError,
  })

  return (
    <div ref={ref} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)] max-md:min-h-11"
      >
        <Bookmark className="size-3.5" aria-hidden="true" />
        Views
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Saved views"
          className="absolute right-0 top-full z-30 mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-md border border-[var(--border)] bg-[var(--background)] p-2 shadow-lg"
        >
          {query.isLoading && <p className="px-1 py-1 text-xs text-[var(--muted-foreground)]">Loading views…</p>}
          {!query.isLoading && views.length === 0 && (
            <p className="px-1 py-1 text-xs text-[var(--muted-foreground)]">
              No saved views yet. Set your filters, then name and save them below.
            </p>
          )}
          <ul className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
            {views.map((v) => (
              <li key={v.id} className="flex items-center gap-0.5 rounded-md hover:bg-[var(--muted)]">
                {renaming === v.id ? (
                  <form
                    className="flex min-w-0 flex-1 items-center gap-0.5"
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (renameValue.trim()) rename.mutate({ id: v.id, name: renameValue })
                    }}
                  >
                    <input
                      autoFocus
                      type="text"
                      maxLength={60}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      aria-label={`New name for view ${v.name}`}
                      className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[var(--ring)] max-md:min-h-11"
                    />
                    <button type="submit" aria-label="Save new name" className={ICON_BTN}>
                      <Check className="size-4" aria-hidden="true" />
                    </button>
                    <button type="button" aria-label="Cancel rename" onClick={() => setRenaming(null)} className={ICON_BTN}>
                      <X className="size-4" aria-hidden="true" />
                    </button>
                  </form>
                ) : (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onApply({ filters: v.filters, sort: v.sort })
                        setOpen(false)
                      }}
                      className="flex min-h-9 min-w-0 flex-1 items-center gap-1.5 truncate rounded-md px-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] max-md:min-h-11"
                    >
                      <span className="truncate">{v.name}</span>
                      {v.is_default && (
                        <span className="shrink-0 rounded-full border border-[var(--border)] px-1.5 text-[11px] text-[var(--muted-foreground)]">
                          Default
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      aria-label={v.is_default ? `Remove default from ${v.name}` : `Make ${v.name} the default view`}
                      aria-pressed={v.is_default}
                      onClick={() => setDefault.mutate(v)}
                      className={ICON_BTN}
                    >
                      <Star className={`size-4 ${v.is_default ? 'fill-current' : ''}`} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Rename view ${v.name}`}
                      onClick={() => {
                        setRenaming(v.id)
                        setRenameValue(v.name)
                      }}
                      className={ICON_BTN}
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete view ${v.name}`}
                      onClick={() => remove.mutate(v)}
                      className={`${ICON_BTN} hover:text-[var(--destructive)]`}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          <form
            className="mt-2 flex gap-1 border-t border-[var(--border)] pt-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (name.trim()) save.mutate()
            }}
          >
            <input
              type="text"
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name this view…"
              aria-label="Name for the new view"
              className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[var(--ring)] max-md:min-h-11"
            />
            <button
              type="submit"
              disabled={!name.trim() || save.isPending}
              className="shrink-0 rounded-md bg-[var(--primary)] px-3 text-xs font-medium text-[var(--primary-foreground)] disabled:opacity-50 max-md:min-h-11"
            >
              Save current
            </button>
          </form>
          {error && (
            <p role="alert" className="mt-2 text-xs text-[var(--destructive)]">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
