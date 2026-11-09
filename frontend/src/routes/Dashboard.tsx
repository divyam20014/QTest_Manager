import { useQuery } from '@tanstack/react-query'

import { fetchActivityStream, fetchDashboardSummary } from '@/api/reporting'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function Dashboard() {
  const summaryQuery = useQuery({ queryKey: ['dashboard', 'summary'], queryFn: fetchDashboardSummary })
  const activityQuery = useQuery({ queryKey: ['dashboard', 'activity'], queryFn: fetchActivityStream })

  const summary = summaryQuery.data

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Dashboard</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Total Projects</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{summary?.projects.total ?? '–'}</p>
            <p className="text-xs text-[var(--muted-foreground)]">
              {summary ? Object.entries(summary.projects.by_status).map(([s, n]) => `${s}: ${n}`).join(', ') : ''}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active Projects</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{summary?.projects.active ?? '–'}</p>
            <p className="text-xs text-[var(--muted-foreground)]">Not yet completed</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Total Test Cases</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{summary?.test_cases.total ?? '–'}</p>
            <p className="text-xs text-[var(--muted-foreground)]">
              {summary ? formatPercent(summary.test_cases.approved_ratio) : ''} approved
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Approved Test Cases</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{summary?.test_cases.approved_count ?? '–'}</p>
            <p className="text-xs text-[var(--muted-foreground)]">of {summary?.test_cases.total ?? 0} total</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active Test Runs</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{summary?.test_runs.active ?? '–'}</p>
            <p className="text-xs text-[var(--muted-foreground)]">
              {summary ? formatPercent(summary.test_runs.step_pass_percentage) : ''} steps passing
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Execution Pass %</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {summary ? formatPercent(summary.test_runs.step_pass_percentage) : '–'}
            </p>
            <p className="text-xs text-[var(--muted-foreground)]">across all executed steps</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Open Defects</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {summary ? Object.values(summary.defects.open_by_severity).reduce((a, b) => a + b, 0) : '–'}
            </p>
            <p className="text-xs text-[var(--muted-foreground)]">
              {summary
                ? Object.entries(summary.defects.open_by_severity).map(([s, n]) => `${s}: ${n}`).join(', ')
                : ''}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Critical Defects</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{summary?.defects.critical_count ?? '–'}</p>
            <p className="text-xs text-[var(--muted-foreground)]">open, Critical severity</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2 text-sm">
            {activityQuery.data?.length === 0 && (
              <li className="text-[var(--muted-foreground)]">No activity yet.</li>
            )}
            {activityQuery.data?.map((entry, i) => (
              <li key={i} className="flex justify-between gap-4 border-b border-[var(--border)] pb-2 last:border-0">
                <span>
                  <span className="font-medium">{entry.user_name ?? 'System'}</span>{' '}
                  <span className="text-[var(--muted-foreground)]">{entry.action.replace(/_/g, ' ')}</span>{' '}
                  <span className="text-[var(--muted-foreground)]">({entry.entity_type})</span>
                </span>
                <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
                  {new Date(entry.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
