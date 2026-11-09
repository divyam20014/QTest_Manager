import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { getDefect, updateDefectStatus, type DefectStatus } from '@/api/defects'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/lib/auth'
import { SEVERITY_TONE, STATUS_ORDER, STATUS_TONE } from './statusDisplay'

export function DefectDetail() {
  const { defectId } = useParams<{ defectId: string }>()
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const defectQuery = useQuery({
    queryKey: ['defects', 'detail', defectId],
    queryFn: () => getDefect(defectId!),
    enabled: !!defectId,
  })

  const statusMutation = useMutation({
    mutationFn: (status: DefectStatus) => updateDefectStatus(defectId!, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['defects', 'detail', defectId] }),
  })

  const defect = defectQuery.data
  if (defectQuery.isLoading) return <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>
  if (defectQuery.isError || !defect) return <p className="text-sm text-[var(--destructive)]">Defect not found.</p>

  const currentIndex = STATUS_ORDER.indexOf(defect.status)
  const nextStatus = STATUS_ORDER[currentIndex + 1]
  const canCloseStep = nextStatus !== 'Closed' || user?.role === 'admin' || user?.role === 'manager'
  const statusError = statusMutation.error instanceof ApiError ? statusMutation.error.message : null

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link to="/defects" className="text-xs text-[var(--muted-foreground)] hover:underline">
          ← Defects
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">{defect.title}</h1>
          <Badge tone={SEVERITY_TONE[defect.severity]}>{defect.severity}</Badge>
          <Badge tone={STATUS_TONE[defect.status]}>{defect.status}</Badge>
        </div>
      </div>

      {nextStatus && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={!canCloseStep || statusMutation.isPending}
            onClick={() => statusMutation.mutate(nextStatus)}
          >
            Advance to {nextStatus}
          </Button>
          {!canCloseStep && (
            <span className="text-xs text-[var(--muted-foreground)]">Only Admin/Manager can close a defect.</span>
          )}
        </div>
      )}
      {statusError && <p className="text-xs text-[var(--destructive)]">{statusError}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{defect.description || 'No description provided.'}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Traceability</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-[var(--muted-foreground)]">Project</dt>
              <dd>
                <Link to={`/projects/${defect.project_id}`} className="underline-offset-2 hover:underline">
                  {defect.project_name}
                </Link>
              </dd>
              <dt className="text-[var(--muted-foreground)]">Test Case</dt>
              <dd>
                {defect.test_case_id ? (
                  <Link to={`/test-cases/${defect.test_case_id}`} className="underline-offset-2 hover:underline">
                    {defect.test_case_title}
                  </Link>
                ) : (
                  '—'
                )}
              </dd>
              <dt className="text-[var(--muted-foreground)]">Test Run</dt>
              <dd>
                {defect.test_run_id ? (
                  <Link to={`/test-runs/${defect.test_run_id}`} className="underline-offset-2 hover:underline">
                    {defect.test_run_name}
                  </Link>
                ) : (
                  '—'
                )}
              </dd>
              <dt className="text-[var(--muted-foreground)]">Step</dt>
              <dd>{defect.step_number !== null ? `Step ${defect.step_number}` : '—'}</dd>
              <dt className="text-[var(--muted-foreground)]">Reported</dt>
              <dd>{new Date(defect.created_at).toLocaleString()}</dd>
              <dt className="text-[var(--muted-foreground)]">Closed</dt>
              <dd>{defect.closed_at ? new Date(defect.closed_at).toLocaleString() : '—'}</dd>
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
