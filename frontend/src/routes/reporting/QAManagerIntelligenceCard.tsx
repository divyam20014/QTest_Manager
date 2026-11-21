import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import {
  fetchFlakyTests,
  fetchReleaseReadiness,
  fetchWorkloadSummary,
} from '@/api/reporting'
import { hasPermission } from '@/api/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { QuarantinedBadge } from '@/components/ui/QuarantinedBadge'
import { QuarantineDialog } from '@/components/ui/QuarantineDialog'
import { useAuth } from '@/lib/auth'
import { Skeleton } from '@/components/ui/skeleton'
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmbossedCard } from '@/components/ui/EmbossedCard'

// PV-7.1/7.2/7.4: the underlying metrics for one project, not one blended
// score -- a QA manager deciding release go/no-go needs completion, pass
// rate, open defects, and coverage as separate signals.
export function QAManagerIntelligenceCard({ projectId }: { projectId: string }) {
  const { user } = useAuth()
  const canQuarantine = hasPermission(user, 'testcase.approve')
  const [target, setTarget] = useState<{ id: string; title: string } | null>(null)
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
      <EmbossedCard>
        <CardHeader>
          <CardTitle>Release Readiness</CardTitle>
        </CardHeader>
        <CardContent>
          {!readiness ? (
            <div role="status" className="flex flex-col gap-2"><span className="sr-only">Loading</span><Skeleton className="h-4 w-48" /><Skeleton className="h-4 w-32" /></div>
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
              {(readiness.quarantined_count ?? 0) > 0 && (
                <div className="flex justify-between gap-2">
                  <span className="text-[var(--muted-foreground)]">Quarantined cases (not counted as passing)</span>
                  <span className="font-medium">{readiness.quarantined_count}</span>
                </div>
              )}
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
      </EmbossedCard>

      <EmbossedCard>
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
      </EmbossedCard>

      <EmbossedCard>
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
                <li key={t.test_case_id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate">{t.test_case_title}</span>
                  <Badge tone="warning">{Math.round(t.flip_rate * 100)}% flip</Badge>
                  {t.quarantined ? (
                    <QuarantinedBadge />
                  ) : (
                    canQuarantine && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setTarget({ id: t.test_case_id, title: t.test_case_title })}
                      >
                        Quarantine
                      </Button>
                    )
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </EmbossedCard>
      {target && (
        <QuarantineDialog
          testCaseId={target.id}
          title={target.title}
          open
          onClose={() => setTarget(null)}
        />
      )}
    </div>
  )
}
