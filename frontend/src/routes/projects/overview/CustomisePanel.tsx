import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import {
  type ProjectLayout,
  clearProjectDefaultLayout,
  resetProjectLayout,
  saveProjectDefaultLayout,
  saveProjectLayout,
} from '@/api/projectDashboard'
import { ApiError } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { FormError } from '@/components/ui/form-field'
import { useAuth } from '@/lib/auth'
import {
  WIDGET_META,
  fromDraft,
  moveDraft,
  sameLayout,
  setDraftVisible,
  toDraft,
} from '@/lib/projectDashboard'
import { useToast } from '@/lib/toast'

const ARROW_CLASS =
  'inline-flex size-9 items-center justify-center rounded-[var(--radius-control)] border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:pointer-events-none disabled:opacity-40 max-md:size-11 [&_svg]:size-4'

const SOURCE_TEXT = {
  user: 'You are using your own layout.',
  project_default: "You are using this project's default layout.",
  builtin: 'You are using the built-in layout.',
} as const

/**
 * Customise (ADR-123): show or hide the Overview widgets and put them in order with Up / Down
 * buttons (no drag, keyboard operable). Sizes are fixed per widget. "Save" keeps a personal layout;
 * "Reset" drops it, returning to the project default (or the built-in layout). People who can edit
 * the project can also publish the layout as the project default.
 */
export function CustomisePanel({
  projectId,
  layout,
  onClose,
}: {
  projectId: string
  layout: ProjectLayout
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const userId = useAuth().user?.user_id ?? 'anon'
  const [draft, setDraft] = useState(() => toDraft(layout.widgets, layout.catalogue))
  const [announcement, setAnnouncement] = useState('')
  const [focusId, setFocusId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // After a move the row has a new position; put focus back on the button the user pressed.
  useEffect(() => {
    if (!focusId) return
    const el = document.getElementById(focusId) as HTMLButtonElement | null
    if (el && !el.disabled) el.focus()
    else {
      const other = document.getElementById(focusId.endsWith('-up') ? focusId.replace('-up', '-down') : focusId.replace('-down', '-up'))
      ;(other as HTMLButtonElement | null)?.focus()
    }
    setFocusId(null)
  }, [focusId, draft])

  const chosen = useMemo(() => fromDraft(draft), [draft])
  const unchanged = sameLayout(chosen, layout.widgets)

  function publish(next: ProjectLayout, message: string) {
    queryClient.setQueryData(['projects', projectId, 'dashboard-layout', userId], next)
    showToast('success', message)
    onClose()
  }
  const onError = (e: unknown) => setError(e instanceof ApiError ? e.message : 'Could not save the layout.')

  const save = useMutation({
    mutationFn: () => saveProjectLayout(projectId, chosen),
    onSuccess: (next) => publish(next, 'Dashboard layout saved'),
    onError,
  })
  const reset = useMutation({
    mutationFn: () => resetProjectLayout(projectId),
    onSuccess: (next) => publish(next, 'Dashboard layout reset'),
    onError,
  })
  const saveDefault = useMutation({
    mutationFn: () => saveProjectDefaultLayout(projectId, chosen),
    onSuccess: (next) => publish(next, 'Project default layout saved'),
    onError,
  })
  const clearDefault = useMutation({
    mutationFn: () => clearProjectDefaultLayout(projectId),
    onSuccess: (next) => publish(next, 'Project default layout removed'),
    onError,
  })
  const busy = save.isPending || reset.isPending || saveDefault.isPending || clearDefault.isPending

  function move(index: number, delta: -1 | 1, direction: 'up' | 'down') {
    const item = draft[index]
    const next = moveDraft(draft, index, delta)
    if (next === draft) return
    setDraft(next)
    setFocusId(`dash-${item.widget_type}-${direction}`)
    setAnnouncement(`${WIDGET_META[item.widget_type].label} moved ${direction} to position ${index + delta + 1} of ${draft.length}`)
  }

  return (
    <Dialog open onClose={onClose} title="Customise dashboard" className="max-w-2xl">
      <div className="flex flex-col gap-4 text-sm" data-testid="customise-panel">
        <p className="text-[var(--muted-foreground)]">
          Choose the widgets this project&apos;s Overview shows and their order. This changes your view of this
          project only; the organisation dashboard for all projects is separate. {SOURCE_TEXT[layout.layout_source]}
        </p>
        <ol className="flex flex-col gap-1.5" aria-label="Dashboard widgets">
          {draft.map((w, i) => {
            const meta = WIDGET_META[w.widget_type]
            return (
              <li
                key={w.widget_type}
                className="flex items-center gap-3 rounded-md border border-[var(--border)] px-3 py-2"
                data-testid={`customise-row-${w.widget_type}`}
              >
                <input
                  id={`dash-${w.widget_type}-show`}
                  type="checkbox"
                  className="size-4 shrink-0 accent-[var(--primary)] max-md:size-5"
                  checked={w.visible}
                  onChange={(e) => setDraft(setDraftVisible(draft, w.widget_type, e.target.checked))}
                />
                <label htmlFor={`dash-${w.widget_type}-show`} className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{meta.label}</span>
                  <span className="text-xs text-[var(--muted-foreground)]">{meta.description}</span>
                </label>
                <span className="flex shrink-0 gap-1">
                  <button
                    id={`dash-${w.widget_type}-up`}
                    type="button"
                    className={ARROW_CLASS}
                    aria-label={`Move ${meta.label} up`}
                    disabled={i === 0}
                    onClick={() => move(i, -1, 'up')}
                  >
                    <ArrowUp aria-hidden="true" />
                  </button>
                  <button
                    id={`dash-${w.widget_type}-down`}
                    type="button"
                    className={ARROW_CLASS}
                    aria-label={`Move ${meta.label} down`}
                    disabled={i === draft.length - 1}
                    onClick={() => move(i, 1, 'down')}
                  >
                    <ArrowDown aria-hidden="true" />
                  </button>
                </span>
              </li>
            )
          })}
        </ol>
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
        {layout.can_set_default && (
          <div className="flex flex-col gap-2 rounded-md bg-[var(--muted)] p-3" data-testid="customise-default">
            <p className="font-medium">Project default</p>
            <p className="text-xs text-[var(--muted-foreground)]">
              {layout.has_project_default
                ? 'A default is set. Everyone who has not saved their own layout sees it.'
                : 'No default is set, so everyone sees the built-in layout until they customise.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => saveDefault.mutate()}>
                Save as project default
              </Button>
              {layout.has_project_default && (
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => clearDefault.mutate()}>
                  Remove project default
                </Button>
              )}
            </div>
          </div>
        )}
        {error && <FormError>{error}</FormError>}
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" disabled={busy || layout.layout_source !== 'user'} onClick={() => reset.mutate()}>
          Reset to default
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" disabled={busy || unchanged} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
