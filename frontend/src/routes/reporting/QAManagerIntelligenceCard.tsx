import { useQuery } from '@tanstack/react-query'

import {
  fetchFlakyTests,
  fetchReleaseReadiness,
  fetchWorkloadSummary,
} from '@/api/reporting'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// PV-7.1/7.2/7.4: the underlying metrics for one project, not one blended
// score -- a QA manager deciding release go/no-go needs completion, pass
// rate, open defects, and coverage as separate signals.
export function QAManagerIntelligenceCard({ projectId }: { projectId: string }) {
  const readinessQuery = useQuery({
    queryKey: ['reports', 'release-readiness', projectId],
    queryFn: () => fetchReleaseReadiness(projectId),
  })
  const workloadQuery = useQuery({
    queryKey: ['reports', 'workload', projectId],
    queryFn: () => fetchWorkloadSummary(projectId),
  })
  const flakyQuery = useQuery({
    queryKey: ['reports', 'flaky-tests', projectId],
    queryFn: () => fetchFlakyTests(projectId),
  })

  const readiness = readinessQuery.data
  const workload = workloadQuery.data?.entries ?? []
  const flaky = flakyQuery.data?.tests ?? []

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle>Release Readiness</CardTitle>
        </CardHeader>
        <CardContent>
          {!readiness ? (
            <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>
          ) : (
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--muted-foreground)]">Test cases</span>
                <span className="font-medium">{readiness.total_test_cases}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted-foreground)]">Execution completion</span>
                <span className="font-medium">{readiness.execution_completion_percentage}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted-foreground)]">Pass rate</span>
                <span className="font-medium">{readiness.pass_percentage}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted-foreground)]">Requirement coverage</span>
                <span className="font-medium">{readiness.requirement_coverage_percentage}%</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {Object.entries(readiness.open_defects_by_severity).length === 0 && (
                  <span className="text-xs text-[var(--muted-foreground)]">No open defects</span>
                )}
                {Object.entries(readiness.open_defects_by_severity).map(([sev, count]) => (
                  <Badge key={sev} tone={sev === 'Critical' || sev === 'High' ? 'critical' : 'neutral'}>
                    {sev}: {count}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Workload</CardTitle>
        </CardHeader>
        <CardContent>
          {workload.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No assignments yet.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {workload.map((w) => (
                <li key={w.user_id} className="flex flex-col gap-0.5 border-b border-[var(--border)] pb-1.5 last:border-0">
                  <span className="font-medium">{w.user_name ?? 'Unknown'}</span>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {w.assigned_test_cases} test case{w.assigned_test_cases === 1 ? '' : 's'} ·{' '}
                    {w.assigned_test_run_cases_pending + w.assigned_test_run_cases_in_progress} run case
                    {w.assigned_test_run_cases_pending + w.assigned_test_run_cases_in_progress === 1 ? '' : 's'} in
                    flight · {w.defects_reported_open} defect{w.defects_reported_open === 1 ? '' : 's'} reported
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Flaky Tests</CardTitle>
        </CardHeader>
        <CardContent>
          {flaky.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">
              No flaky tests detected (same-version pass/fail flips across executions).
            </p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {flaky.map((t) => (
                <li key={t.test_case_id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{t.test_case_title}</span>
                  <Badge tone="warning">{Math.round(t.flip_rate * 100)}% flip</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
