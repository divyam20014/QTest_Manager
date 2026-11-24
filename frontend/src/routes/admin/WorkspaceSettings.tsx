import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { ApiError } from '@/api/client'
import { getWorkspaceConfig, putWorkspaceConfig, type WorkspaceConfig } from '@/api/workspace'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ErrorState } from '@/components/ui/empty-state'
import { FormError } from '@/components/ui/form-field'
import { PageHeader } from '@/components/ui/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { useConfirm } from '@/components/ui/useConfirm'
import { NAV_ENTRY_META, fullNavOrder, hiddenNavIds } from '@/lib/navRegistry'
import { DEFAULT_TAB_ORDER, PROJECT_TABS, fullOrder, hiddenTabs } from '@/lib/projectNav'
import { useToast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { VIEW_MODE_LABEL, type ViewMode } from '@/lib/viewMode'
import {
  LIST_VIEW_LABELS,
  LIST_VIEW_MODES,
  WORKSPACE_QUERY_KEY,
  availableModes,
  normalizeWorkspaceConfig,
} from '@/lib/workspaceConfig'

const ARROW_CLASS =
  'inline-flex size-9 items-center justify-center rounded-[var(--radius-control)] border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:pointer-events-none disabled:opacity-40 max-md:size-11 [&_svg]:size-4'

const NAV_DESCRIPTIONS: Record<string, string> = {
  home: 'The organisation dashboard.',
  projects: 'Every project you can open.',
  'my-work': 'What is assigned to the signed-in person.',
  'test-management': 'The test case repository. It shows in the sidebar as the Test Cases link until it has a second page.',
  'test-execution': 'Test runs and the execution console.',
  defects: 'Defects across projects.',
  reports: 'Reports, analytics and compliance reports.',
  admin: 'Users, roles, settings and audit logs. People who may not open Admin never see it.',
}

interface Draft {
  navOrder: string[]
  navHidden: Set<string>
  tabOrder: string[]
  tabHidden: Set<string>
  modes: Record<string, ViewMode[]>
}

function draftFrom(config: WorkspaceConfig): Draft {
  const modes: Record<string, ViewMode[]> = {}
  for (const [key, builtIn] of Object.entries(LIST_VIEW_MODES)) modes[key] = [...availableModes(config, key, builtIn)]
  return {
    navOrder: fullNavOrder(config.sidebar.order),
    navHidden: hiddenNavIds(config.sidebar.hidden),
    tabOrder: fullOrder(config.project_tabs),
    tabHidden: new Set<string>(hiddenTabs(config.project_tabs)),
    modes,
  }
}

const BUILT_IN_NAV_ORDER = NAV_ENTRY_META.map((m) => m.id)

/** The document to store: anything equal to the built-in default is left out, so a reset stores nothing. */
function toConfig(d: Draft): WorkspaceConfig {
  const sameOrder = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])
  const view_modes: WorkspaceConfig['view_modes'] = {}
  for (const [key, builtIn] of Object.entries(LIST_VIEW_MODES)) {
    const chosen = builtIn.filter((m) => d.modes[key]?.includes(m) || m === 'list')
    if (chosen.length < builtIn.length) view_modes[key] = chosen
  }
  return {
    sidebar: {
      order: sameOrder(d.navOrder, BUILT_IN_NAV_ORDER) ? [] : d.navOrder,
      hidden: BUILT_IN_NAV_ORDER.filter((id) => d.navHidden.has(id)),
    },
    project_tabs: {
      order: sameOrder(d.tabOrder, DEFAULT_TAB_ORDER) ? [] : d.tabOrder,
      hidden: DEFAULT_TAB_ORDER.filter((k) => d.tabHidden.has(k)),
    },
    view_modes,
  }
}

interface Row {
  key: string
  label: string
  description: string
  hideable: boolean
}

/** One show/hide + move up/down list (keyboard operable, no drag). */
function OrderList({
  id,
  label,
  rows,
  order,
  hidden,
  onMove,
  onToggle,
}: {
  id: string
  label: string
  rows: Record<string, Row>
  order: string[]
  hidden: Set<string>
  onMove: (key: string, delta: -1 | 1) => void
  onToggle: (key: string, shown: boolean) => void
}) {
  return (
    <ol aria-label={label} className="flex flex-col divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
      {order.map((key, index) => {
        const row = rows[key]
        if (!row) return null
        const isHidden = hidden.has(key)
        return (
          <li key={key} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2" data-testid={`${id}-row-${key}`}>
            <div className="min-w-0 flex-1 basis-48">
              <p className={cn('text-sm font-medium', isHidden && 'text-[var(--muted-foreground)] line-through')}>{row.label}</p>
              <p className="text-xs text-[var(--muted-foreground)]">{row.description}</p>
            </div>
            {row.hideable ? (
              <label className="flex min-h-9 items-center gap-2 text-sm max-md:min-h-11">
                <input
                  type="checkbox"
                  checked={!isHidden}
                  aria-label={`Show ${row.label}`}
                  onChange={(e) => onToggle(key, e.target.checked)}
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
                id={`${id}-move-${key}-up`}
                className={ARROW_CLASS}
                aria-label={`Move ${row.label} up`}
                disabled={index === 0}
                onClick={() => onMove(key, -1)}
              >
                <ArrowUp aria-hidden="true" />
              </button>
              <button
                type="button"
                id={`${id}-move-${key}-down`}
                className={ARROW_CLASS}
                aria-label={`Move ${row.label} down`}
                disabled={index === order.length - 1}
                onClick={() => onMove(key, 1)}
              >
                <ArrowDown aria-hidden="true" />
              </button>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

const NAV_ROWS: Record<string, Row> = Object.fromEntries(
  NAV_ENTRY_META.map((m) => [m.id, { key: m.id, label: m.label, description: NAV_DESCRIPTIONS[m.id] ?? '', hideable: !m.core }]),
)
const TAB_ROWS: Record<string, Row> = Object.fromEntries(
  PROJECT_TABS.map((t) => [t.key, { key: t.key, label: t.label, description: t.description, hideable: t.hideable }]),
)

/**
 * Admin > Workspace (ADR-125): the tenant's defaults for the sidebar entries, the project tabs and
 * the board / calendar views of the lists. Everything here is presentation: a hidden entry or tab is
 * removed from the menu only (its URL still opens), nobody gains or loses access, and every person's
 * own favourites and recents stay on their device. A project with its own tab setup keeps it.
 */
export function WorkspaceSettings() {
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const { ask, dialog: confirmDialog } = useConfirm()
  const query = useQuery({ queryKey: WORKSPACE_QUERY_KEY, queryFn: getWorkspaceConfig, staleTime: 5 * 60_000 })
  const saved = useMemo(() => normalizeWorkspaceConfig(query.data), [query.data])
  const savedKey = JSON.stringify(toConfig(draftFrom(saved)))
  const [draft, setDraft] = useState<Draft>(() => draftFrom(saved))
  const [announcement, setAnnouncement] = useState('')
  const [focusId, setFocusId] = useState<string | null>(null)

  // Follow the saved value (first load, after saving or resetting); unchanged refetches keep edits.
  useEffect(() => {
    setDraft(draftFrom(saved))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey])

  // After a move the row is re-keyed; put focus back on the button that was pressed.
  useEffect(() => {
    if (!focusId) return
    const el = document.getElementById(focusId) as HTMLButtonElement | null
    if (el && !el.disabled) el.focus()
    else if (el) {
      const alt = focusId.endsWith('-up') ? focusId.replace(/-up$/, '-down') : focusId.replace(/-down$/, '-up')
      document.getElementById(alt)?.focus()
    }
    setFocusId(null)
  }, [focusId, draft])

  const dirty = JSON.stringify(toConfig(draft)) !== savedKey
  const atDefaults = savedKey === JSON.stringify(toConfig(draftFrom(normalizeWorkspaceConfig(null)))) && !dirty

  const saveMutation = useMutation({
    mutationFn: (config: WorkspaceConfig) => putWorkspaceConfig(config),
    onSuccess: (data, config) => {
      queryClient.setQueryData(WORKSPACE_QUERY_KEY, data)
      showToast(
        'success',
        JSON.stringify(config) === JSON.stringify(toConfig(draftFrom(normalizeWorkspaceConfig(null))))
          ? 'Workspace reset to the defaults'
          : 'Workspace defaults saved',
      )
    },
  })
  const error =
    saveMutation.error instanceof ApiError
      ? saveMutation.error.message
      : saveMutation.error
        ? 'Could not save the workspace defaults.'
        : null

  function move(kind: 'nav' | 'tab', key: string, delta: -1 | 1) {
    const list = kind === 'nav' ? draft.navOrder : draft.tabOrder
    const from = list.indexOf(key)
    const to = from + delta
    if (to < 0 || to >= list.length) return
    const next = [...list]
    next.splice(from, 1)
    next.splice(to, 0, key)
    setDraft({ ...draft, ...(kind === 'nav' ? { navOrder: next } : { tabOrder: next }) })
    const rows = kind === 'nav' ? NAV_ROWS : TAB_ROWS
    setAnnouncement(`${rows[key]?.label} moved to position ${to + 1} of ${next.length}`)
    setFocusId(`${kind}-move-${key}-${delta < 0 ? 'up' : 'down'}`)
  }

  function toggle(kind: 'nav' | 'tab', key: string, shown: boolean) {
    const set = new Set(kind === 'nav' ? draft.navHidden : draft.tabHidden)
    if (shown) set.delete(key)
    else set.add(key)
    setDraft({ ...draft, ...(kind === 'nav' ? { navHidden: set } : { tabHidden: set }) })
    const rows = kind === 'nav' ? NAV_ROWS : TAB_ROWS
    setAnnouncement(`${rows[key]?.label} ${shown ? 'shown' : 'hidden'}`)
  }

  function toggleMode(listKey: string, mode: ViewMode, on: boolean) {
    const current = draft.modes[listKey] ?? [...LIST_VIEW_MODES[listKey]]
    const next = on ? [...current, mode] : current.filter((m) => m !== mode)
    setDraft({ ...draft, modes: { ...draft.modes, [listKey]: next } })
    setAnnouncement(`${VIEW_MODE_LABEL[mode]} view ${on ? 'on' : 'off'} for ${LIST_VIEW_LABELS[listKey]}`)
  }

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <PageHeader title="Workspace" description="Defaults for how your organisation's workspace is laid out." />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (query.isError) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Workspace" description="Defaults for how your organisation's workspace is laid out." />
        <ErrorState message="Could not load the workspace defaults." error={query.error} onRetry={() => query.refetch()} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {confirmDialog}
      <PageHeader
        title="Workspace"
        description="Defaults for how your organisation's workspace is laid out. Hiding only removes an item from the menu; nobody gains or loses access to anything."
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              disabled={atDefaults || saveMutation.isPending}
              onClick={() =>
                ask({
                  title: 'Reset the workspace to the defaults?',
                  description:
                    'Every hidden sidebar entry and project tab is shown again, the original order returns and every list offers all its views. Projects with their own tab setup keep it.',
                  confirmLabel: 'Reset to defaults',
                  run: () => saveMutation.mutateAsync({ sidebar: { order: [], hidden: [] }, project_tabs: { order: [], hidden: [] }, view_modes: {} }),
                })
              }
            >
              Reset to defaults
            </Button>
            <Button type="button" disabled={!dirty || saveMutation.isPending} onClick={() => saveMutation.mutate(toConfig(draft))}>
              Save changes
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Sidebar</CardTitle>
          <p className="text-xs text-[var(--muted-foreground)]">
            The entries of the left sidebar, the phone menu and the command palette, in order. Dashboard, Projects, My Work and
            Admin are always shown. Each person still sees only what their role allows, and keeps their own favourites and recents.
          </p>
        </CardHeader>
        <CardContent>
          <OrderList
            id="nav"
            label="Sidebar entry order"
            rows={NAV_ROWS}
            order={draft.navOrder}
            hidden={draft.navHidden}
            onMove={(k, d) => move('nav', k, d)}
            onToggle={(k, s) => toggle('nav', k, s)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Project tabs</CardTitle>
          <p className="text-xs text-[var(--muted-foreground)]">
            The default tabs of a project. A project that has its own tab setup (Project settings, Navigation) keeps it. Overview,
            Requirements, Test Cases, Test Runs, Defects and Reports are always shown.
          </p>
        </CardHeader>
        <CardContent>
          <OrderList
            id="tab"
            label="Project tab order"
            rows={TAB_ROWS}
            order={draft.tabOrder}
            hidden={draft.tabHidden}
            onMove={(k, d) => move('tab', k, d)}
            onToggle={(k, s) => toggle('tab', k, s)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>List views</CardTitle>
          <p className="text-xs text-[var(--muted-foreground)]">
            The views each list offers besides the table. The list view is always available. A list left with only the list view
            shows no view switch.
          </p>
        </CardHeader>
        <CardContent>
          <ul aria-label="List views" className="flex flex-col divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
            {Object.entries(LIST_VIEW_MODES).map(([listKey, builtIn]) => (
              <li key={listKey} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2" data-testid={`modes-row-${listKey}`}>
                <p className="min-w-0 flex-1 basis-40 text-sm font-medium">{LIST_VIEW_LABELS[listKey]}</p>
                <span className="flex min-h-9 items-center text-sm text-[var(--muted-foreground)] max-md:min-h-11">
                  List (always on)
                </span>
                {builtIn
                  .filter((m) => m !== 'list')
                  .map((mode) => (
                    <label key={mode} className="flex min-h-9 items-center gap-2 text-sm max-md:min-h-11">
                      <input
                        type="checkbox"
                        checked={draft.modes[listKey]?.includes(mode) ?? true}
                        aria-label={`${VIEW_MODE_LABEL[mode]} view for ${LIST_VIEW_LABELS[listKey]}`}
                        onChange={(e) => toggleMode(listKey, mode, e.target.checked)}
                        className="size-4"
                      />
                      {VIEW_MODE_LABEL[mode]}
                    </label>
                  ))}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <FormError>{error}</FormError>
    </div>
  )
}
