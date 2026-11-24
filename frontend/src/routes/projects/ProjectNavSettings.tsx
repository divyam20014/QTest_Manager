import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { ApiError } from '@/api/client'
import { type Project, updateProject } from '@/api/projects'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FormError } from '@/components/ui/form-field'
import { useConfirm } from '@/components/ui/useConfirm'
import {
  DEFAULT_TAB_ORDER,
  type ProjectTabKey,
  fullOrder,
  hiddenTabs,
  tabDef,
} from '@/lib/projectNav'
import { useToast } from '@/lib/toast'
import { effectiveNavConfig, useWorkspaceConfig } from '@/lib/workspaceConfig'
import { cn } from '@/lib/utils'

const ARROW_CLASS =
  'inline-flex size-9 items-center justify-center rounded-[var(--radius-control)] border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:pointer-events-none disabled:opacity-40 max-md:size-11 [&_svg]:size-4'

/**
 * Project Settings > Navigation (ADR-122): choose which optional tabs are shown and put the tabs
 * in order. Reordering uses Up / Down buttons (keyboard operable, no drag). Saved with
 * PATCH /projects/{id} {nav_config}; "Reset to defaults" stores null again. Core tabs can be moved
 * but not hidden, Settings is always shown to people who can edit.
 */
export function ProjectNavSettings({ project }: { project: Project }) {
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const { ask, dialog: confirmDialog } = useConfirm()
  // A project with no configuration of its own shows the workspace default (ADR-125).
  const { config: workspace } = useWorkspaceConfig()
  const effective = effectiveNavConfig(project.nav_config, workspace)
  // Keyed on the content, so a background refetch of an unchanged project keeps unsaved edits.
  const configKey = JSON.stringify(effective)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const savedOrder = useMemo(() => fullOrder(effective), [configKey])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const savedHidden = useMemo(() => [...hiddenTabs(effective)], [configKey])
  const [order, setOrder] = useState<ProjectTabKey[]>(savedOrder)
  const [hidden, setHidden] = useState<Set<ProjectTabKey>>(new Set(savedHidden))
  const [announcement, setAnnouncement] = useState('')
  const [focusId, setFocusId] = useState<string | null>(null)

  // Follow the saved value when it changes (after save, reset or a reload).
  useEffect(() => {
    setOrder(savedOrder)
    setHidden(new Set(savedHidden))
  }, [savedOrder, savedHidden])

  // After a move the row is re-keyed in the list; put focus back on the button the user pressed.
  useEffect(() => {
    if (focusId) {
      const el = document.getElementById(focusId) as HTMLButtonElement | null
      if (el && !el.disabled) el.focus()
      else if (el) {
        const fallback = document.getElementById(focusId.endsWith('-up') ? focusId.replace('-up', '-down') : focusId.replace('-down', '-up'))
        ;(fallback as HTMLButtonElement | null)?.focus()
      }
      setFocusId(null)
    }
  }, [focusId, order])

  const hiddenList = DEFAULT_TAB_ORDER.filter((k) => hidden.has(k))
  const sameHidden = hiddenList.length === savedHidden.length && hiddenList.every((k) => savedHidden.includes(k))
  const dirty = order.join('|') !== savedOrder.join('|') || !sameHidden
  const atDefaults = project.nav_config === null && !dirty

  const saveMutation = useMutation({
    mutationFn: (config: { order: string[]; hidden: string[] } | null) =>
      updateProject(project.id, { nav_config: config, expected_version: project.version }),
    onSuccess: (_data, config) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      showToast('success', config === null ? 'Project tabs reset to the defaults' : 'Project tabs saved')
    },
  })
  const error =
    saveMutation.error instanceof ApiError
      ? saveMutation.error.message
      : saveMutation.error
        ? 'Could not save the project tabs.'
        : null

  function move(key: ProjectTabKey, delta: -1 | 1) {
    const from = order.indexOf(key)
    const to = from + delta
    if (to < 0 || to >= order.length) return
    const next = [...order]
    next.splice(from, 1)
    next.splice(to, 0, key)
    setOrder(next)
    setAnnouncement(`${tabDef(key)?.label} moved to position ${to + 1} of ${next.length}`)
    setFocusId(`nav-move-${key}-${delta < 0 ? 'up' : 'down'}`)
  }

  function toggle(key: ProjectTabKey, shown: boolean) {
    setHidden((prev) => {
      const next = new Set(prev)
      if (shown) next.delete(key)
      else next.add(key)
      return next
    })
    setAnnouncement(`${tabDef(key)?.label} tab ${shown ? 'shown' : 'hidden'}`)
  }

  return (
    <Card>
      {confirmDialog}
      <CardHeader>
        <CardTitle>Project navigation</CardTitle>
        <p className="text-xs text-[var(--muted-foreground)]">
          Choose which tabs this project shows and in what order. Hiding a tab only removes it from the tab bar; its page
          still opens from a direct link, and nobody gains or loses access to any data. A project that is never customised follows the workspace default tabs.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ol aria-label="Project tab order" className="flex flex-col divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
          {order.map((key, index) => {
            const def = tabDef(key)!
            const isHidden = hidden.has(key)
            return (
              <li key={key} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2" data-testid={`nav-row-${key}`}>
                <div className="min-w-0 flex-1 basis-48">
                  <p className={cn('text-sm font-medium', isHidden && 'text-[var(--muted-foreground)] line-through')}>
                    {def.label}
                  </p>
                  <p className="text-xs text-[var(--muted-foreground)]">{def.description}</p>
                </div>
                {def.hideable ? (
                  <label className="flex min-h-9 items-center gap-2 text-sm max-md:min-h-11">
                    <input
                      type="checkbox"
                      checked={!isHidden}
                      aria-label={`Show ${def.label} tab`}
                      onChange={(e) => toggle(key, e.target.checked)}
                      className="size-4"
                    />
                    Show
                  </label>
                ) : (
                  <span className="text-xs text-[var(--muted-foreground)]">Always shown</span>
                )}
                <div className="flex gap-1">
                  <button
                    type="button"
                    id={`nav-move-${key}-up`}
                    className={ARROW_CLASS}
                    aria-label={`Move ${def.label} up`}
                    disabled={index === 0}
                    onClick={() => move(key, -1)}
                  >
                    <ArrowUp aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    id={`nav-move-${key}-down`}
                    className={ARROW_CLASS}
                    aria-label={`Move ${def.label} down`}
                    disabled={index === order.length - 1}
                    onClick={() => move(key, 1)}
                  >
                    <ArrowDown aria-hidden="true" />
                  </button>
                </div>
              </li>
            )
          })}
        </ol>
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
        <FormError>{error}</FormError>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={!dirty || saveMutation.isPending}
            onClick={() => saveMutation.mutate({ order, hidden: hiddenList })}
          >
            Save tabs
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={atDefaults || saveMutation.isPending}
            onClick={() =>
              ask({
                title: 'Reset project tabs to the defaults?',
                description: 'Every hidden tab is shown again and the tabs go back to their standard order.',
                confirmLabel: 'Reset to defaults',
                run: () => saveMutation.mutateAsync(null),
              })
            }
          >
            Reset to defaults
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
