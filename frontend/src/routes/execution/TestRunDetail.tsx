import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { finishTestRun, getTestRun } from '@/api/execution'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth'

const CASE_STATUS_TONE = {
  pending: 'neutral',
  in_progress: 'warning',
  passed: 'positive',
  failed: 'critical',
  blocked: 'critical',
  ignored: 'neutral',
} as const

export function TestRunDetail() {
  const { runId } = useParams<{ runId: string }>()
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const runQuery = useQuery({ queryKey: ['test-runs', 'detail', runId], queryFn: () => getTestRun(runId!), enabled: !!runId })

  const finishMutation = useMutation({
    mutationFn: () => finishTestRun(runId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['test-runs', 'detail', runId] }),
  })

  const run = runQuery.data
  if (runQuery.isLoading) return <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>
  if (runQuery.isError || !run) return <p className="text-sm text-[var(--destructive)]">Test run not found.</p>

  const canFinish = (user?.role === 'admin' || user?.role === 'manager') && !run.finished_at
  const finishError = finishMutation.error instanceof ApiError ? finishMutation.error.message : null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <Link to={`/projects/${run.project_id}/test-runs`} className="text-xs text-[var(--muted-foreground)] hover:underline">
            ← Test Runs
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">{run.name}</h1>
            <Badge tone={run.finished_at ? 'neutral' : 'positive'}>{run.finished_at ? 'Finished' : 'Active'}</Badge>
          </div>
        </div>
        {canFinish && (
          <Button onClick={() => finishMutation.mutate()} disabled={finishMutation.isPending}>
            Finish Run
          </Button>
        )}
      </div>
      {finishError && <p className="text-xs text-[var(--destructive)]">{finishError}</p>}

      <div className="overflow-hidden rounded-lg border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--muted)] text-left text-xs text-[var(--muted-foreground)]">
            <tr>
              <th className="px-4 py-2 font-medium">Test Case</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Progress</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {run.cases.map((rc) => (
              <tr key={rc.id} className="border-t border-[var(--border)] hover:bg-[var(--muted)]">
                <td className="px-4 py-2 font-medium">{rc.title}</td>
                <td className="px-4 py-2">
                  <Badge tone={CASE_STATUS_TONE[rc.status]}>{rc.status.replace('_', ' ')}</Badge>
                </td>
                <td className="px-4 py-2 text-xs text-[var(--muted-foreground)]">
                  {rc.passed_count + rc.failed_count + rc.ignored_count}/{rc.step_count} steps
                </td>
                <td className="px-4 py-2 text-right">
                  <Link
                    to={`/test-run-cases/${rc.id}?runId=${run.id}`}
                    className="text-sm underline-offset-2 hover:underline"
                  >
                    {run.finished_at ? 'View' : 'Execute'}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
