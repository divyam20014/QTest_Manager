import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Plus, Settings2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import {
  MAX_WIDGETS,
  getDashboard,
  replaceDashboardWidgets,
  type DashboardWidget,
  type WidgetDraft,
  type WidgetSettings,
  type WidgetSize,
  type WidgetType,
} from '@/api/dashboards'
import { listProjects } from '@/api/projects'
import { listSavedReports } from '@/api/reportBuilder'
import { listReleases } from '@/api/testAssets'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { ErrorState } from '@/components/ui/empty-state'
import { EmbossedCard } from '@/components/ui/EmbossedCard'
import { PageHeader } from '@/components/ui/PageHeader'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'
import { NotFound } from '@/routes/NotFound'

import {
  SIZE_LABEL,
  WIDGET_BY_TYPE,
  WIDGET_CATALOGUE,
  settingsComplete,
  type WidgetDef,
} from './widgetCatalogue'
import { WidgetView } from './Widgets'

const SPAN: Record<WidgetSize, string> = { S: 'md:col-span-1', M: 'md:col-span-2', L: 'md:col-span-3' }
const GRID = 'grid grid-cols-1 gap-4 md:grid-cols-3'
const ICON_BTN = 'max-md:min-h-11 max-md:min-w-11'

interface Draft extends WidgetDraft {
  uid: string
}

let uidCounter = 0
const nextUid = () => `w${++uidCounter}`

function toDrafts(widgets: DashboardWidget[]): Draft[] {
  return widgets.map((w) => ({
    uid: nextUid(),
    widget_type: w.widget_type,
    size: w.size,
    settings: { ...w.settings },
  }))
}

function errMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Something went wrong'
}

function SettingsForm({
  def,
  settings,
  onChange,
}: {
  def: WidgetDef
  settings: WidgetSettings
  onChange: (next: WidgetSettings) => void
}) {
  const projects = useQuery({ queryKey: ['projects', 'all'], queryFn: () => listProjects({ page_size: 100 }) })
  const projectId = settings.project_id ? String(settings.project_id) : ''
  const releases = useQuery({
    queryKey: ['dashboards', 'releases', projectId],
    queryFn: () => listReleases(projectId),
    enabled: !!projectId && def.fields.some((f) => f.kind === 'release'),
  })
  const reports = useQuery({
    queryKey: ['report-builder', 'reports'],
    queryFn: listSavedReports,
    enabled: def.fields.some((f) => f.kind === 'report'),
  })
  const set = (patch: Record<string, string | number | undefined>) => {
    const next: WidgetSettings = { ...settings }
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '') delete next[k]
      else next[k] = v
    }
    onChange(next)
  }
  if (def.fields.length === 0) return <p className="text-sm text-[var(--muted-foreground)]">No settings.</p>
  return (
    <div className="flex flex-col gap-3">
      {def.fields.map((f) => {
        const id = `wset-${f.kind}`
        if (f.kind === 'project') {
          return (
            <div key={f.kind} className="flex flex-col gap-1">
              <label htmlFor={id} className="text-sm font-medium">
                Project{f.required ? '' : ' (optional)'}
              </label>
              <Select
                id={id}
                value={projectId}
                onChange={(e) => set({ project_id: e.target.value, release_id: undefined })}
              >
                <option value="">{f.required ? 'Choose a project' : 'All projects'}</option>
                {(projects.data?.items ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
          )
        }
        if (f.kind === 'days') {
          return (
            <div key={f.kind} className="flex flex-col gap-1">
              <label htmlFor={id} className="text-sm font-medium">
                Period
              </label>
              <Select id={id} value={String(settings.days ?? 30)} onChange={(e) => set({ days: Number(e.target.value) })}>
                {[7, 14, 30, 90].map((d) => (
                  <option key={d} value={d}>
                    Last {d} days
                  </option>
                ))}
              </Select>
            </div>
          )
        }
        if (f.kind === 'top_n') {
          return (
            <div key={f.kind} className="flex flex-col gap-1">
              <label htmlFor={id} className="text-sm font-medium">
                How many tests
              </label>
              <Select id={id} value={String(settings.top_n ?? 10)} onChange={(e) => set({ top_n: Number(e.target.value) })}>
                {[5, 10, 20, 50].map((n) => (
                  <option key={n} value={n}>
                    Top {n}
                  </option>
                ))}
              </Select>
            </div>
          )
        }
        if (f.kind === 'release') {
          return (
            <div key={f.kind} className="flex flex-col gap-1">
              <label htmlFor={id} className="text-sm font-medium">
                Release (optional)
              </label>
              <Select
                id={id}
                value={settings.release_id ? String(settings.release_id) : ''}
                disabled={!projectId}
                onChange={(e) => set({ release_id: e.target.value })}
              >
                <option value="">Whole project</option>
                {(releases.data ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </div>
          )
        }
        return (
          <div key={f.kind} className="flex flex-col gap-1">
            <label htmlFor={id} className="text-sm font-medium">
              Saved report
            </label>
            <Select
              id={id}
              value={settings.report_id ? String(settings.report_id) : ''}
              onChange={(e) => set({ report_id: e.target.value })}
            >
              <option value="">Choose a report</option>
              {(reports.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
            {reports.data && reports.data.length === 0 && (
              <p className="text-xs text-[var(--muted-foreground)]">
                No saved reports yet. Save one in the Report builder first.
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Add (type chosen here) or edit (type fixed) one widget. */
function WidgetDialog({
  initial,
  onClose,
  onSubmit,
}: {
  initial: { type: WidgetType | null; size: WidgetSize; settings: WidgetSettings; editing: boolean }
  onClose: () => void
  onSubmit: (d: { type: WidgetType; size: WidgetSize; settings: WidgetSettings }) => void
}) {
  const [type, setType] = useState<WidgetType | null>(initial.type)
  const [size, setSize] = useState<WidgetSize>(initial.size)
  const [settings, setSettings] = useState<WidgetSettings>(initial.settings)
  const def = type ? WIDGET_BY_TYPE[type] : null
  const { user } = useAuth()
  const ok = !!def && settingsComplete(def, settings)

  return (
    <Dialog open onClose={onClose} title={initial.editing ? 'Widget settings' : 'Add widget'}>
      <div className="flex flex-col gap-4">
        {!initial.editing && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Widget type</legend>
            {WIDGET_CATALOGUE.map((d) => (
              <label
                key={d.type}
                className="flex min-h-11 cursor-pointer items-start gap-2 rounded-md border border-[var(--border)] p-2 text-sm has-[:checked]:border-[var(--ring)]"
              >
                <input
                  type="radio"
                  name="widget-type"
                  className="mt-1"
                  checked={type === d.type}
                  onChange={() => {
                    setType(d.type)
                    setSettings({ ...d.defaults })
                  }}
                />
                <span className="flex flex-col">
                  <span className="font-medium">{d.label}</span>
                  <span className="text-xs text-[var(--muted-foreground)]">{d.description}</span>
                  {d.needsReports && user?.reports_hidden && (
                    <span className="text-xs text-[var(--muted-foreground)]">
                      Needs Reports, which are hidden from Testers here.
                    </span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {def && (
          <>
            <SettingsForm def={def} settings={settings} onChange={setSettings} />
            <div className="flex flex-col gap-1">
              <label htmlFor="wset-size" className="text-sm font-medium">
                Size
              </label>
              <Select id="wset-size" value={size} onChange={(e) => setSize(e.target.value as WidgetSize)}>
                {(Object.keys(SIZE_LABEL) as WidgetSize[]).map((s) => (
                  <option key={s} value={s}>
                    {SIZE_LABEL[s]}
                  </option>
                ))}
              </Select>
            </div>
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={!ok} onClick={() => type && onSubmit({ type, size, settings })}>
            {initial.editing ? 'Apply' : 'Add widget'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

type DialogState = { index: number | null } | null

export function DashboardView() {
  const { dashboardId = '' } = useParams()
  const userId = useAuth().user?.user_id ?? 'anon'
  const qc = useQueryClient()
  const { show } = useToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Draft[]>([])
  const [dialog, setDialog] = useState<DialogState>(null)

  const q = useQuery({
    queryKey: ['dashboards', 'detail', userId, dashboardId],
    queryFn: () => getDashboard(dashboardId),
    retry: (count, e) => !(e instanceof ApiError && e.status === 404) && count < 1,
  })
  const projects = useQuery({ queryKey: ['projects', 'all'], queryFn: () => listProjects({ page_size: 100 }) })
  const projectName = (id: unknown) => projects.data?.items.find((p) => p.id === id)?.name

  const save = useMutation({
    mutationFn: () =>
      replaceDashboardWidgets(
        dashboardId,
        draft.map(({ widget_type, size, settings }) => ({ widget_type, size, settings })),
      ),
    onSuccess: (data) => {
      qc.setQueryData(['dashboards', 'detail', userId, dashboardId], data)
      void qc.invalidateQueries({ queryKey: ['dashboards', 'list'] })
      setEditing(false)
      show('success', 'Layout saved')
    },
    onError: (e) => show('error', errMessage(e)),
  })

  if (q.error instanceof ApiError && q.error.status === 404) return <NotFound />
  if (q.isPending) return <Skeleton className="h-40 w-full" />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const dash = q.data

  function startEdit() {
    setDraft(toDrafts(dash.widgets))
    setEditing(true)
  }
  function move(i: number, delta: number) {
    setDraft((d) => {
      const next = [...d]
      const j = i + delta
      if (j < 0 || j >= next.length) return d
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }
  const setAt = (i: number, patch: Partial<Draft>) =>
    setDraft((d) => d.map((w, k) => (k === i ? { ...w, ...patch } : w)))

  const dialogInitial =
    dialog === null
      ? null
      : dialog.index === null
        ? { type: null, size: 'M' as WidgetSize, settings: {}, editing: false }
        : {
            type: draft[dialog.index].widget_type,
            size: draft[dialog.index].size,
            settings: draft[dialog.index].settings,
            editing: true,
          }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        back={
          <Link to="/dashboards" className="text-xs text-[var(--link)] hover:underline">
            &larr; All dashboards
          </Link>
        }
        title={dash.name}
        meta={dash.is_team_default ? <StatusBadge tone="info">Team default</StatusBadge> : undefined}
        actions={
          dash.can_edit ? (
            editing ? (
              <>
                <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>
                  Save
                </Button>
              </>
            ) : (
              <Button type="button" variant="outline" onClick={startEdit}>
                <Settings2 className="mr-1 size-4" aria-hidden="true" /> Edit layout
              </Button>
            )
          ) : undefined
        }
      />

      {editing ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              disabled={draft.length >= MAX_WIDGETS}
              onClick={() => setDialog({ index: null })}
            >
              <Plus className="mr-1 size-4" aria-hidden="true" /> Add widget
            </Button>
            <span className="text-xs text-[var(--muted-foreground)]">
              {draft.length} of {MAX_WIDGETS} widgets
            </span>
          </div>
          {draft.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No widgets yet. Add one to get started.</p>
          ) : (
            <ol className={GRID} aria-label="Dashboard layout">
              {draft.map((w, i) => {
                const def = WIDGET_BY_TYPE[w.widget_type]
                const where = projectName(w.settings.project_id)
                return (
                  <li key={w.uid} className={SPAN[w.size]}>
                    <EmbossedCard className="flex h-full flex-col gap-3 p-4">
                      <div>
                        <p className="font-medium">{def.label}</p>
                        <p className="text-xs text-[var(--muted-foreground)]">
                          {where ? `Project: ${where}` : def.fields.some((f) => f.kind === 'project') ? 'All projects' : def.description}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className={ICON_BTN}
                          aria-label={`Move ${def.label} ${i + 1} up`}
                          disabled={i === 0}
                          onClick={() => move(i, -1)}
                        >
                          <ArrowUp className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className={ICON_BTN}
                          aria-label={`Move ${def.label} ${i + 1} down`}
                          disabled={i === draft.length - 1}
                          onClick={() => move(i, 1)}
                        >
                          <ArrowDown className="size-4" />
                        </Button>
                        <Select
                          aria-label={`Size of ${def.label} ${i + 1}`}
                          className="w-auto"
                          value={w.size}
                          onChange={(e) => setAt(i, { size: e.target.value as WidgetSize })}
                        >
                          {(Object.keys(SIZE_LABEL) as WidgetSize[]).map((s) => (
                            <option key={s} value={s}>
                              {SIZE_LABEL[s]}
                            </option>
                          ))}
                        </Select>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className={ICON_BTN}
                          aria-label={`Settings for ${def.label} ${i + 1}`}
                          onClick={() => setDialog({ index: i })}
                        >
                          <Settings2 className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className={ICON_BTN}
                          aria-label={`Remove ${def.label} ${i + 1}`}
                          onClick={() => setDraft((d) => d.filter((_, k) => k !== i))}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </EmbossedCard>
                  </li>
                )
              })}
            </ol>
          )}
        </>
      ) : dash.widgets.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">
          {dash.can_edit ? 'This dashboard is empty. Choose Edit layout to add widgets.' : 'This dashboard is empty.'}
        </p>
      ) : (
        <div className={GRID}>
          {dash.widgets.map((w) => (
            <div key={w.id} className={SPAN[w.size]}>
              <WidgetView widget={w} />
            </div>
          ))}
        </div>
      )}

      {dialogInitial && dialog && (
        <WidgetDialog
          key={dialog.index ?? 'new'}
          initial={dialogInitial}
          onClose={() => setDialog(null)}
          onSubmit={(d) => {
            if (dialog.index === null) {
              setDraft((cur) => [
                ...cur,
                { uid: nextUid(), widget_type: d.type, size: d.size, settings: d.settings },
              ])
            } else {
              setAt(dialog.index, { size: d.size, settings: d.settings })
            }
            setDialog(null)
          }}
        />
      )}
    </div>
  )
}
