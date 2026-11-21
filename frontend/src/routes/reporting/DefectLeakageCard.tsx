import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import {
  defectLeakageExportXlsxPath,
  fetchDefectLeakage,
  type DefectLeakageReport,
  type LeakageReleaseRow,
} from '@/api/reporting'
import { ResponsiveTable, type ResponsiveColumn } from '@/components/table/ResponsiveTable'
import { ChartPanel } from '@/components/ui/ChartPanel'
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmbossedCard } from '@/components/ui/EmbossedCard'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { ExportButton } from '@/components/ui/ExportButton'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { usePrefersReducedMotion } from '@/lib/useMediaQuery'
import { useThemePreference } from '@/lib/useThemePreference'
import { categoricalColor } from './palette'

const tooltipStyle = {
  background: 'var(--tactile-surface-raised)',
  border: 'none',
  borderRadius: 10,
  boxShadow: 'var(--elevation-raised-sm)',
  fontSize: 12,
  color: 'var(--foreground)',
}

function pct(value: number | null): string {
  return value === null ? 'No defects' : `${value}%`
}

const COLUMNS: ResponsiveColumn<LeakageReleaseRow>[] = [
  { key: 'release', header: 'Release', card: 'title', cell: (r) => r.release_name },
  { key: 'date', header: 'Release date', cell: (r) => r.release_date ?? 'Not set' },
  { key: 'total', header: 'Defects', cell: (r) => r.total_defects },
  { key: 'escaped', header: 'Escaped', cell: (r) => r.escaped_defects },
  { key: 'leakage', header: 'Leakage', cell: (r) => pct(r.leakage_percentage) },
  { key: 'effectiveness', header: 'Detection effectiveness', cell: (r) => pct(r.detection_effectiveness_percentage) },
  { key: 'open', header: 'Open escaped', cell: (r) => r.open_escaped_defects },
]

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-md border border-[var(--border)] p-3">
      <dt className="text-xs font-medium text-[var(--muted-foreground)]">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
      {detail && <dd className="mt-1 text-xs text-[var(--muted-foreground)]">{detail}</dd>}
    </div>
  )
}

function Trend({ report }: { report: DefectLeakageReport }) {
  const [theme] = useThemePreference()
  const reduceMotion = usePrefersReducedMotion()
  const isDark = theme === 'dark'
  return (
    <ChartPanel
      title="Leakage trend by month"
      bodyClassName="h-56"
      summary={`Line chart by month of total and escaped defects: ${report.total_defects} total, ${report.escaped_defects} escaped.`}
      table={
        report.trend.length
          ? {
              columns: ['Month', 'Defects', 'Escaped', 'Leakage'],
              rows: report.trend.map((p) => [p.period, p.total_defects, p.escaped_defects, pct(p.leakage_percentage)]),
            }
          : undefined
      }
    >
      {report.trend.length === 0 ? (
        <EmptyState title="No trend yet" description="Defects appear here by the month they were reported." />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={report.trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="period"
              tick={{ fontSize: 12, fill: 'var(--chart-axis-text)' }}
              axisLine={{ stroke: 'var(--chart-axis-line)' }}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 12, fill: 'var(--chart-axis-text)' }}
              axisLine={false}
              tickLine={false}
              width={28}
            />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line
              isAnimationActive={!reduceMotion}
              type="monotone"
              dataKey="total_defects"
              name="All defects"
              stroke={categoricalColor(1, isDark)}
              strokeWidth={2}
              dot={false}
            />
            <Line
              isAnimationActive={!reduceMotion}
              type="monotone"
              dataKey="escaped_defects"
              name="Escaped"
              stroke={categoricalColor(7, isDark)}
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartPanel>
  )
}

/** ADR-097: defect leakage and test effectiveness. */
export function DefectLeakageCard({ projectId }: { projectId?: string }) {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const query = useQuery({
    queryKey: ['reports', 'defect-leakage', projectId, dateFrom, dateTo],
    queryFn: () => fetchDefectLeakage(projectId, dateFrom || undefined, dateTo || undefined),
    retry: 1,
  })
  const r = query.data
  const sev = r ? Object.entries(r.escaped_by_severity) : []

  return (
    <EmbossedCard>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-x-3 gap-y-2 space-y-0">
        <CardTitle>Defect Leakage &amp; Test Effectiveness</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
            From
            <Input
              type="date"
              aria-label="Leakage from date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-40 max-md:w-full"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
            To
            <Input
              type="date"
              aria-label="Leakage to date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-40 max-md:w-full"
            />
          </label>
          <ExportButton
            path={defectLeakageExportXlsxPath(projectId, dateFrom || undefined, dateTo || undefined)}
            fallbackName="defect_leakage.xlsx"
            ariaLabel="defect leakage"
          />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-xs leading-snug text-[var(--muted-foreground)]">
          A defect has <strong>escaped</strong> when it is linked to a release whose release date has passed, or when its
          environment is Production or Prod. Leakage % = escaped ÷ all defects. Detection effectiveness % = (all −
          escaped) ÷ all. Both show &ldquo;No defects&rdquo; when there is nothing to measure. Quarantined test cases are
          counted separately and never as passing.
        </p>
        {query.isLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} message="Could not load defect leakage." />
        ) : !r || r.total_defects === 0 ? (
          <EmptyState
            title="No defects in this selection"
            description="Report defects, or widen the project and date filters, to measure leakage."
          />
        ) : (
          <>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="leakage-headline">
              <Stat label="Total defects" value={String(r.total_defects)} />
              <Stat label="Escaped defects" value={String(r.escaped_defects)} />
              <Stat label="Leakage" value={pct(r.leakage_percentage)} />
              <Stat label="Detection effectiveness" value={pct(r.detection_effectiveness_percentage)} />
              <Stat
                label="Open escaped defects"
                value={String(r.open_escaped_defects)}
                detail={`Under 7 days: ${r.open_escaped_age_buckets.under_7d} · 7-30 days: ${r.open_escaped_age_buckets.d7_to_30} · Over 30 days: ${r.open_escaped_age_buckets.over_30d}`}
              />
              <Stat
                label="Escaped by severity"
                value={sev.length ? String(r.escaped_defects) : '0'}
                detail={sev.length ? sev.map(([k, v]) => `${k}: ${v}`).join(' · ') : 'None escaped'}
              />
              <Stat
                label="Quarantined test cases"
                value={String(r.quarantined_test_cases)}
                detail="Reported separately; never counted as passing"
              />
            </dl>
            <ResponsiveTable
              label="Defect leakage by release"
              rows={r.releases}
              rowKey={(row) => row.release_id ?? 'none'}
              columns={COLUMNS}
            />
            <Trend report={r} />
          </>
        )}
      </CardContent>
    </EmbossedCard>
  )
}
