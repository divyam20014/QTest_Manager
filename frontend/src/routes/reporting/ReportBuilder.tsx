import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Play, Plus, Save, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { ApiError } from '@/api/client'
import {
  createSavedReport,
  deleteSavedReport,
  fetchReportSources,
  listSavedReports,
  previewReport,
  reportExportPath,
  runSavedReport,
  updateSavedReport,
  type Operator,
  type ReportColumn,
  type ReportDefinition,
  type ReportFilter,
  type ReportResult,
  type ReportRow,
  type SavedReport,
  type SourceField,
  type SourceKey,
} from '@/api/reportBuilder'
import { ResponsiveTable, type ResponsiveColumn } from '@/components/table/ResponsiveTable'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { ExportButton } from '@/components/ui/ExportButton'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/PageHeader'
import { Pagination } from '@/components/ui/pagination'
import { Select } from '@/components/ui/select'
import { useConfirm } from '@/components/ui/useConfirm'
import { useToast } from '@/lib/toast'

const PAGE_SIZE = 25
const OP_LABEL: Record<Operator, string> = {
  eq: 'is',
  neq: 'is not',
  in: 'is one of',
  contains: 'contains',
  gt: 'is after / greater than',
  gte: 'is on or after / at least',
  lt: 'is before / less than',
  lte: 'is on or before / at most',
  is_null: 'is empty',
}

interface FilterRow {
  field: string
  op: Operator
  value: string
}

const CONTROL = 'min-h-11 w-full'

function toValue(field: SourceField, op: Operator, raw: string): ReportFilter['value'] {
  const one = (v: string) => (field.type === 'number' ? Number(v) : field.type === 'bool' ? v === 'true' : v)
  if (op === 'is_null') return undefined
  if (op === 'in')
    return raw
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => one(v) as string | number)
  return one(raw.trim()) as string | number | boolean
}

function errMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Something went wrong while running the report.'
}

export function ReportBuilder() {
  const qc = useQueryClient()
  const { show } = useToast()
  const { ask, dialog } = useConfirm()
  const sources = useQuery({
    queryKey: ['report-builder', 'sources'],
    queryFn: fetchReportSources,
  })
  const saved = useQuery({
    queryKey: ['report-builder', 'reports'],
    queryFn: listSavedReports,
  })

  const [source, setSource] = useState<SourceKey>('defects')
  const [fields, setFields] = useState<string[]>(['title', 'severity', 'status'])
  const [filters, setFilters] = useState<FilterRow[]>([])
  const [groupBy, setGroupBy] = useState<string[]>([])
  const [sortField, setSortField] = useState('')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [result, setResult] = useState<ReportResult | null>(null)
  const [runError, setRunError] = useState<unknown>(null)
  const [page, setPage] = useState(1)
  const [current, setCurrent] = useState<SavedReport | null>(null)
  const [name, setName] = useState('')
  const [shared, setShared] = useState(false)

  const meta = useMemo(() => sources.data?.find((s) => s.key === source), [sources.data, source])
  const fieldMap = useMemo(() => new Map((meta?.fields ?? []).map((f) => [f.key, f])), [meta])
  const grouped = groupBy.length > 0

  function buildDefinition(): ReportDefinition {
    return {
      source,
      fields: grouped ? [] : fields,
      filters: filters
        .filter((f) => f.op === 'is_null' || f.value.trim() !== '')
        .map((f) => {
          const spec = fieldMap.get(f.field)
          const value = spec ? toValue(spec, f.op, f.value) : undefined
          return value === undefined ? { field: f.field, op: f.op } : { field: f.field, op: f.op, value }
        }),
      group_by: groupBy,
      sort: sortField ? { field: sortField, dir: sortDir } : null,
    }
  }

  function loadDefinition(def: ReportDefinition) {
    setSource(def.source)
    setFields(def.fields)
    setGroupBy(def.group_by)
    setSortField(def.sort?.field ?? '')
    setSortDir(def.sort?.dir ?? 'asc')
    setFilters(
      def.filters.map((f) => ({
        field: f.field,
        op: f.op,
        value: Array.isArray(f.value) ? f.value.join(', ') : f.value == null ? '' : String(f.value),
      })),
    )
  }

  function changeSource(next: SourceKey) {
    const first = sources.data?.find((s) => s.key === next)?.fields[1]?.key
    setSource(next)
    setFields(first ? [first] : [])
    setFilters([])
    setGroupBy([])
    setSortField('')
    setResult(null)
    setCurrent(null)
  }

  const run = useMutation({
    mutationFn: (p: { page: number; savedId?: string }) =>
      p.savedId ? runSavedReport(p.savedId, p.page, PAGE_SIZE) : previewReport(buildDefinition(), p.page, PAGE_SIZE),
    onSuccess: (data, vars) => {
      setResult(data)
      setPage(vars.page)
      setRunError(null)
    },
    onError: (e) => {
      setRunError(e)
      setResult(null)
    },
  })

  const refresh = () => qc.invalidateQueries({ queryKey: ['report-builder', 'reports'] })
  const save = useMutation({
    mutationFn: (p: { asNew: boolean }) => {
      const def = buildDefinition()
      return current && !p.asNew && current.can_edit
        ? updateSavedReport(current.id, {
            name: name.trim() || current.name,
            definition: def,
            is_shared: shared,
          })
        : createSavedReport(name.trim(), def, shared)
    },
    onSuccess: (r) => {
      setCurrent(r)
      setName(r.name)
      void refresh()
      show('success', 'Report saved')
    },
    onError: (e) => show('error', errMessage(e)),
  })
  const remove = useMutation({
    mutationFn: (id: string) => deleteSavedReport(id),
    onSuccess: (_d, id) => {
      if (current?.id === id) setCurrent(null)
      void refresh()
      show('success', 'Report deleted')
    },
    onError: (e) => show('error', errMessage(e)),
  })

  function open(r: SavedReport) {
    setCurrent(r)
    setName(r.name)
    setShared(r.is_shared)
    loadDefinition(r.definition)
    run.mutate({ page: 1, savedId: r.id })
  }

  function toggleField(key: string) {
    setFields((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : cur.length >= 12 ? cur : [...cur, key]))
  }
  function move(key: string, delta: number) {
    setFields((cur) => {
      const i = cur.indexOf(key)
      const j = i + delta
      if (i < 0 || j < 0 || j >= cur.length) return cur
      const next = [...cur]
      ;[next[i], next[j]] = [next[j]!, next[i]!]
      return next
    })
  }
  function setGroup(index: number, key: string) {
    setGroupBy((cur) => {
      const next = [...cur]
      if (key) next[index] = key
      else next.splice(index, 1)
      return next.filter((k, i) => next.indexOf(k) === i)
    })
    setSortField('')
  }

  const columns: ResponsiveColumn<ReportRow>[] = (result?.columns ?? []).map((c: ReportColumn, i) => ({
    key: c.key,
    header: c.label,
    card: i === 0 ? 'title' : 'meta',
    cell: (row) => {
      const v = row[c.key]
      if (v === null || v === undefined || v === '') return <span className="text-[var(--muted-foreground)]">-</span>
      if (typeof v === 'boolean') return v ? 'Yes' : 'No'
      if (c.type === 'date' && typeof v === 'string') return new Date(v).toLocaleString()
      return String(v)
    },
  }))

  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.page_size)) : 1
  const mine = (saved.data ?? []).filter((r) => r.is_owner)
  const others = (saved.data ?? []).filter((r) => !r.is_owner)
  const sortChoices = grouped
    ? [...groupBy.map((k) => ({ key: k, label: fieldMap.get(k)?.label ?? k })), { key: 'count', label: 'Count' }]
    : (meta?.fields ?? []).filter((f) => f.sortable).map((f) => ({ key: f.key, label: f.label }))

  const tableState = run.isPending ? undefined : runError ? (
    <ErrorState error={runError} message={errMessage(runError)} onRetry={() => run.mutate({ page })} />
  ) : result && result.rows.length === 0 ? (
    <EmptyState title="No rows match" description="Adjust the filters and run the report again." />
  ) : !result ? (
    <EmptyState title="Run the report" description="Choose fields and filters, then press Run." />
  ) : undefined

  function renderSaved(title: string, items: SavedReport[]) {
    return (
      <section aria-label={title} className="space-y-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {items.length === 0 && <p className="text-sm text-[var(--muted-foreground)]">None yet.</p>}
        <ul className="space-y-2">
          {items.map((r) => (
            <li key={r.id} className="flex items-center gap-2">
              <Button
                type="button"
                variant={current?.id === r.id ? 'default' : 'outline'}
                className="min-h-11 flex-1 justify-start truncate"
                onClick={() => open(r)}
              >
                {r.name}
                {!r.is_owner && <span className="ml-2 text-xs opacity-70">by {r.owner_name}</span>}
              </Button>
              {r.can_edit && (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 min-w-11"
                  aria-label={`Delete report ${r.name}`}
                  onClick={() =>
                    ask({
                      title: 'Delete this report?',
                      description: `"${r.name}" will be removed for everyone it is shared with. This cannot be undone.`,
                      run: () => remove.mutateAsync(r.id),
                    })
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>
    )
  }

  if (sources.isError) return <ErrorState error={sources.error} onRetry={() => void sources.refetch()} />

  return (
    <div className="space-y-6">
      <PageHeader title="Report builder" description="Build, save and export a report from your project data." />
      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <aside className="space-y-6">
          {renderSaved('My reports', mine)}
          {renderSaved('Shared reports', others)}
        </aside>
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Source</span>
              <Select className={CONTROL} value={source} onChange={(e) => changeSource(e.target.value as SourceKey)}>
                {(sources.data ?? []).map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Sort by</span>
              <span className="flex gap-2">
                <Select
                  className={CONTROL}
                  aria-label="Sort field"
                  value={sortField}
                  onChange={(e) => setSortField(e.target.value)}
                >
                  <option value="">Default</option>
                  {sortChoices.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </Select>
                <Select
                  className="min-h-11 w-28"
                  aria-label="Sort direction"
                  value={sortDir}
                  onChange={(e) => setSortDir(e.target.value as 'asc' | 'desc')}
                >
                  <option value="asc">Asc</option>
                  <option value="desc">Desc</option>
                </Select>
              </span>
            </label>
          </div>

          <fieldset className="space-y-2" disabled={grouped}>
            <legend className="text-sm font-medium">
              Fields{' '}
              {grouped && (
                <span className="font-normal text-[var(--muted-foreground)]">
                  (grouped reports show the group fields and a count)
                </span>
              )}
            </legend>
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {(meta?.fields ?? []).map((f) => (
                <label key={f.key} className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={fields.includes(f.key)}
                    onChange={() => toggleField(f.key)}
                  />
                  {f.label}
                </label>
              ))}
            </div>
            {fields.length > 1 && (
              <ol className="flex flex-wrap gap-2" aria-label="Column order">
                {fields.map((k, i) => (
                  <li key={k} className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs">
                    <span>{fieldMap.get(k)?.label ?? k}</span>
                    <button
                      type="button"
                      className="min-h-11 min-w-11 md:min-h-7 md:min-w-7"
                      aria-label={`Move ${fieldMap.get(k)?.label ?? k} earlier`}
                      disabled={i === 0}
                      onClick={() => move(k, -1)}
                    >
                      &larr;
                    </button>
                    <button
                      type="button"
                      className="min-h-11 min-w-11 md:min-h-7 md:min-w-7"
                      aria-label={`Move ${fieldMap.get(k)?.label ?? k} later`}
                      disabled={i === fields.length - 1}
                      onClick={() => move(k, 1)}
                    >
                      &rarr;
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </fieldset>

          <section className="space-y-2" aria-label="Filters">
            <h2 className="text-sm font-medium">Filters</h2>
            {filters.map((f, i) => {
              const spec = fieldMap.get(f.field)
              const upd = (patch: Partial<FilterRow>) =>
                setFilters((cur) => cur.map((x, j) => (j === i ? { ...x, ...patch } : x)))
              return (
                <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_1.5fr_auto]">
                  <Select
                    className={CONTROL}
                    aria-label={`Filter ${i + 1} field`}
                    value={f.field}
                    onChange={(e) => {
                      const s = fieldMap.get(e.target.value)
                      upd({
                        field: e.target.value,
                        op: s?.operators[0] ?? 'eq',
                        value: '',
                      })
                    }}
                  >
                    {(meta?.fields ?? []).map((x) => (
                      <option key={x.key} value={x.key}>
                        {x.label}
                      </option>
                    ))}
                  </Select>
                  <Select
                    className={CONTROL}
                    aria-label={`Filter ${i + 1} operator`}
                    value={f.op}
                    onChange={(e) => upd({ op: e.target.value as Operator, value: '' })}
                  >
                    {(spec?.operators ?? []).map((o) => (
                      <option key={o} value={o}>
                        {OP_LABEL[o]}
                      </option>
                    ))}
                  </Select>
                  {f.op === 'is_null' ? (
                    <span className="min-h-11" />
                  ) : spec?.type === 'bool' ? (
                    <Select
                      className={CONTROL}
                      aria-label={`Filter ${i + 1} value`}
                      value={f.value || 'true'}
                      onChange={(e) => upd({ value: e.target.value })}
                    >
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </Select>
                  ) : spec?.type === 'enum' && f.op !== 'in' ? (
                    <Select
                      className={CONTROL}
                      aria-label={`Filter ${i + 1} value`}
                      value={f.value}
                      onChange={(e) => upd({ value: e.target.value })}
                    >
                      <option value="">Choose...</option>
                      {spec.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      className={CONTROL}
                      aria-label={`Filter ${i + 1} value`}
                      type={
                        spec?.type === 'date' ? 'date' : spec?.type === 'number' && f.op !== 'in' ? 'number' : 'text'
                      }
                      placeholder={f.op === 'in' ? 'Comma separated' : 'Value'}
                      maxLength={200}
                      value={f.value}
                      onChange={(e) => upd({ value: e.target.value })}
                    />
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 min-w-11"
                    aria-label={`Remove filter ${i + 1}`}
                    onClick={() => setFilters((cur) => cur.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              )
            })}
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={filters.length >= 8 || !meta}
              onClick={() =>
                setFilters((cur) => [
                  ...cur,
                  {
                    field: meta!.fields[1]?.key ?? 'id',
                    op: meta!.fields[1]?.operators[0] ?? 'eq',
                    value: '',
                  },
                ])
              }
            >
              <Plus className="mr-1 size-4" /> Add filter
            </Button>
          </section>

          <section className="grid gap-2 sm:grid-cols-2" aria-label="Group by">
            {[0, 1].map((i) => (
              <label key={i} className="space-y-1 text-sm">
                <span className="font-medium">{i === 0 ? 'Group by (count)' : 'Then group by'}</span>
                <Select
                  className={CONTROL}
                  value={groupBy[i] ?? ''}
                  disabled={i === 1 && groupBy.length === 0}
                  onChange={(e) => setGroup(i, e.target.value)}
                >
                  <option value="">None</option>
                  {(meta?.fields ?? [])
                    .filter((f) => f.groupable && (groupBy[i] === f.key || !groupBy.includes(f.key)))
                    .map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                </Select>
              </label>
            ))}
          </section>

          <div className="grid gap-3 border-t pt-4 sm:grid-cols-[1fr_auto_auto]">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Report name</span>
              <Input
                className={CONTROL}
                value={name}
                maxLength={80}
                placeholder="e.g. Open critical defects"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="flex min-h-11 items-center gap-2 self-end text-sm">
              <input
                type="checkbox"
                className="size-5"
                checked={shared}
                onChange={(e) => setShared(e.target.checked)}
              />
              Share with workspace
            </label>
            <div className="flex flex-wrap gap-2 self-end">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={!name.trim() || save.isPending || (current !== null && !current.can_edit)}
                onClick={() => save.mutate({ asNew: false })}
              >
                <Save className="mr-1 size-4" /> Save report
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={!name.trim() || save.isPending || (current !== null && name.trim() === current.name)}
                onClick={() => save.mutate({ asNew: true })}
              >
                Save as
              </Button>
              <Button
                type="button"
                className="min-h-11"
                disabled={run.isPending || (!grouped && fields.length === 0)}
                onClick={() => run.mutate({ page: 1 })}
              >
                <Play className="mr-1 size-4" /> Run
              </Button>
            </div>
          </div>

          <section aria-label="Results" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Results</h2>
              {current && (
                <div className="flex gap-2">
                  <ExportButton
                    label="Export CSV"
                    path={reportExportPath(current.id, 'csv')}
                    fallbackName="report.csv"
                    className="min-h-11"
                  />
                  <ExportButton
                    label="Export Excel"
                    path={reportExportPath(current.id, 'xlsx')}
                    fallbackName="report.xlsx"
                    className="min-h-11"
                  />
                </div>
              )}
            </div>
            <ResponsiveTable
              label="Report results"
              rows={result?.rows ?? []}
              rowKey={(r) => JSON.stringify(r)}
              columns={columns}
              loading={run.isPending}
              state={tableState}
            />
            {result && (
              <Pagination
                page={page}
                totalPages={totalPages}
                total={result.total}
                noun="row"
                onPageChange={(p) => run.mutate({ page: p, savedId: undefined })}
              />
            )}
            {current && (
              <p className="text-xs text-[var(--muted-foreground)]">
                Exports use the saved version of this report (up to 5000 rows).
              </p>
            )}
          </section>
        </div>
      </div>
      {dialog}
    </div>
  )
}
