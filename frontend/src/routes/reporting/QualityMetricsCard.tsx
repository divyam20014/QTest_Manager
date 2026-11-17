import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import {
  fetchQualityMetrics,
  qualityMetricsExportXlsxPath,
  type QualityMetricsReport,
  type QualityRunType,
} from '@/api/reporting'
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RangeControl } from '@/components/ui/ChartPanel'
import { EmbossedCard } from '@/components/ui/EmbossedCard'
import { ErrorState } from '@/components/ui/empty-state'
import { ExportButton } from '@/components/ui/ExportButton'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

const RANGES = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
  { value: 365, label: '1y' },
]

const RUN_TYPES: { value: QualityRunType; label: string }[] = [
  { value: 'Regression', label: 'Regression runs' },
  { value: 'Smoke', label: 'Smoke runs' },
  { value: 'Sanity', label: 'Sanity runs' },
  { value: 'all', label: 'All run types' },
]

function formatPercent(value: number | null): string {
  return value === null ? 'No data yet' : `${value}%`
}

function formatHours(hours: number | null): string {
  if (hours === null) return 'No data yet'
  if (hours < 1) return `${Math.round(hours * 60)} min`
  if (hours < 48) return `${hours} h`
  return `${(hours / 24).toFixed(1)} days`
}

interface MetricDef {
  key: string
  label: string
  value: string
  detail: string
  /** Plain-language definition, always visible (not a hover-only tooltip). */
  definition: string
  empty: boolean
}

function buildMetrics(r: QualityMetricsReport): MetricDef[] {
  return [
    {
      key: 'precision',
      label: 'Step-level defect precision',
      value: formatPercent(r.step_defect_precision_percentage),
      detail:
        r.execution_defect_count > 0
          ? `${r.step_linked_defect_count} of ${r.execution_defect_count} defects raised from a test run point to an exact step`
          : 'No defects were raised from a test run in this period',
      definition:
        'Of the defects raised while executing a test run in the period, the share linked to the exact failing step.',
      empty: r.step_defect_precision_percentage === null,
    },
    {
      key: 'cycle',
      label: 'Average regression cycle time',
      value: formatHours(r.average_cycle_time_hours),
      detail:
        r.finished_run_count > 0
          ? `Across ${r.finished_run_count} finished run${r.finished_run_count === 1 ? '' : 's'}`
          : 'No finished runs of this type were created in this period',
      definition:
        'Average time from a run being created to it being finished, for runs of the selected type created in the period. Unfinished runs are left out, not counted as zero.',
      empty: r.average_cycle_time_hours === null,
    },
    {
      key: 'pass',
      label: 'Step pass rate',
      value: formatPercent(r.step_pass_percentage),
      detail:
        r.step_sample_size > 0
          ? `Based on ${r.step_sample_size} step result${r.step_sample_size === 1 ? '' : 's'} recorded in the period`
          : 'No step results were recorded in this period',
      definition: 'Share of step results recorded in the period that passed (same definition as the Dashboard).',
      empty: r.step_pass_percentage === null,
    },
    {
      key: 'gate',
      label: 'Review-gate coverage',
      value: formatPercent(r.review_gate_coverage_percentage),
      detail:
        r.total_test_cases > 0
          ? `${r.approved_test_cases} of ${r.total_test_cases} test cases are Approved`
          : 'There are no test cases yet',
      definition:
        'Share of all current test cases that have passed review and are Approved. A snapshot, not limited to the period.',
      empty: r.review_gate_coverage_percentage === null,
    },
  ]
}

/** BRD success metrics (ADR-071), computed server-side from real data. A
 * metric with nothing to measure says "No data yet" rather than showing 0%. */
export function QualityMetricsCard({ projectId }: { projectId?: string }) {
  const [days, setDays] = useState(30)
  const [runType, setRunType] = useState<QualityRunType>('Regression')
  const query = useQuery({
    queryKey: ['reports', 'quality-metrics', days, projectId, runType],
    queryFn: () => fetchQualityMetrics(days, projectId, runType),
    retry: 1,
  })
  const report = query.data
  const metrics = report ? buildMetrics(report) : []
  const byProject = report?.cycle_time_by_project ?? []

  return (
    <EmbossedCard>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-x-3 gap-y-2 space-y-0">
        <CardTitle>Quality Metrics</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <RangeControl label="Metrics period" value={days} options={RANGES} onChange={setDays} />
          <Select
            aria-label="Run type for cycle time"
            value={runType}
            onChange={(e) => setRunType(e.target.value as QualityRunType)}
            className="w-44 max-md:w-full"
          >
            {RUN_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
          <ExportButton
            path={qualityMetricsExportXlsxPath(days, projectId, runType)}
            fallbackName="quality_metrics.xlsx"
            ariaLabel="Export quality metrics to Excel"
          />
        </div>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} message="Could not load quality metrics." />
        ) : (
          <>
            <p className="mb-3 text-xs text-[var(--muted-foreground)]">
              {projectId ? 'For the selected project' : 'Across all projects you can access'} · last {days} days
            </p>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {metrics.map((m) => (
                <div key={m.key} className="rounded-md border border-[var(--border)] p-3">
                  <dt className="text-xs font-medium text-[var(--muted-foreground)]">{m.label}</dt>
                  <dd
                    className={
                      m.empty
                        ? 'mt-1 text-base font-medium text-[var(--muted-foreground)]'
                        : 'mt-1 text-2xl font-semibold tabular-nums'
                    }
                  >
                    {m.value}
                  </dd>
                  <dd className="mt-1 text-xs">{m.detail}</dd>
                  <dd className="mt-2 text-[11px] leading-snug text-[var(--muted-foreground)]">{m.definition}</dd>
                </div>
              ))}
            </dl>
            {byProject.length > 0 && !projectId && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <caption className="mb-1 text-left text-xs font-medium text-[var(--muted-foreground)]">
                    Cycle time by project
                  </caption>
                  <thead>
                    <tr className="text-[var(--muted-foreground)]">
                      <th scope="col" className="px-2 py-1.5 font-medium">
                        Project
                      </th>
                      <th scope="col" className="px-2 py-1.5 font-medium">
                        Finished runs
                      </th>
                      <th scope="col" className="px-2 py-1.5 font-medium">
                        Average cycle time
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {byProject.map((p) => (
                      <tr key={p.project_id} className="border-t border-[var(--border)]">
                        <th scope="row" className="px-2 py-1.5 font-normal">
                          {p.project_name}
                        </th>
                        <td className="px-2 py-1.5 tabular-nums">{p.finished_run_count}</td>
                        <td className="px-2 py-1.5 tabular-nums">{formatHours(p.average_cycle_time_hours)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </EmbossedCard>
  )
}
