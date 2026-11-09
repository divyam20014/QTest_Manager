import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { fetchAggregateReport, fetchDomainDistribution, complianceExportUrl, type GroupBy, type Metric } from '@/api/reporting'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { useAuth } from '@/lib/auth'
import { pivotAggregateRows } from './aggregate'
import { categoricalColor, prefersDark, SEQUENTIAL_BLUE_LIGHT } from './palette'

const METRICS: { value: Metric; label: string }[] = [
  { value: 'run_status', label: 'Test Run Status' },
  { value: 'priority', label: 'Test Case Priority' },
  { value: 'defect_severity', label: 'Defect Severity' },
  { value: 'defect_status', label: 'Defect Status' },
]

const GROUP_BYS: { value: GroupBy; label: string }[] = [
  { value: 'project', label: 'Project' },
  { value: 'domain', label: 'Domain' },
  { value: 'assignee', label: 'Assignee' },
]

export function Reporting() {
  const { user } = useAuth()
  const [metric, setMetric] = useState<Metric>('run_status')
  const [groupBy, setGroupBy] = useState<GroupBy>('project')
  const isDark = prefersDark()

  const domainQuery = useQuery({ queryKey: ['dashboard', 'domain-distribution'], queryFn: fetchDomainDistribution })
  const aggregateQuery = useQuery({
    queryKey: ['reports', 'aggregate', metric, groupBy],
    queryFn: () => fetchAggregateReport(metric, groupBy),
  })

  const { data: aggregateData, valueOrder } = pivotAggregateRows(aggregateQuery.data?.rows ?? [])
  const canExport = user?.role === 'admin' || user?.role === 'manager'

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Reporting</h1>
        {canExport && (
          <a
            href={complianceExportUrl}
            download
            className="rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--muted)]"
          >
            Download Compliance CSV
          </a>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Project &amp; Test Case Distribution by Domain</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={domainQuery.data ?? []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={isDark ? '#2c2c2a' : '#e1e0d9'} />
                <XAxis
                  dataKey="domain"
                  tick={{ fontSize: 12, fill: isDark ? '#c3c2b7' : '#52514e' }}
                  axisLine={{ stroke: isDark ? '#383835' : '#c3c2b7' }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 12, fill: isDark ? '#c3c2b7' : '#52514e' }}
                  axisLine={false}
                  tickLine={false}
                  width={28}
                />
                <Tooltip
                  contentStyle={{
                    background: isDark ? '#1a1a19' : '#fcfcfb',
                    border: `1px solid ${isDark ? '#383835' : '#c3c2b7'}`,
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="project_count" name="Projects" fill={SEQUENTIAL_BLUE_LIGHT} radius={[4, 4, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {domainQuery.data?.map((d) => (
              <div key={d.domain} className="rounded-md border border-[var(--border)] p-3 text-sm">
                <p className="font-medium">{d.domain}</p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {d.test_case_count} test cases · {Math.round(d.approved_percentage)}% approved
                </p>
                <p className="text-xs text-[var(--muted-foreground)]">{d.open_defect_count} open defects</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Aggregate Report</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap gap-3">
            <Select
              aria-label="Metric"
              value={metric}
              onChange={(e) => setMetric(e.target.value as Metric)}
              className="w-52"
            >
              {METRICS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Group by"
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as GroupBy)}
              className="w-40"
            >
              {GROUP_BYS.map((g) => (
                <option key={g.value} value={g.value}>
                  By {g.label}
                </option>
              ))}
            </Select>
          </div>

          {aggregateData.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No data for this combination yet.</p>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={aggregateData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={isDark ? '#2c2c2a' : '#e1e0d9'} />
                  <XAxis
                    dataKey="group_label"
                    tick={{ fontSize: 12, fill: isDark ? '#c3c2b7' : '#52514e' }}
                    axisLine={{ stroke: isDark ? '#383835' : '#c3c2b7' }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 12, fill: isDark ? '#c3c2b7' : '#52514e' }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                  />
                  <Tooltip
                    contentStyle={{
                      background: isDark ? '#1a1a19' : '#fcfcfb',
                      border: `1px solid ${isDark ? '#383835' : '#c3c2b7'}`,
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {valueOrder.map((value, i) => (
                    <Bar
                      key={value}
                      dataKey={value}
                      name={value}
                      stackId="agg"
                      fill={categoricalColor(i, isDark)}
                      radius={i === valueOrder.length - 1 ? [4, 4, 0, 0] : undefined}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
