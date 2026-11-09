import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { getDefect, getDefectHistory, updateDefectStatus, type DefectStatus } from '@/api/defects'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/lib/auth'
import { SEVERITY_TONE, STATUS_ORDER, STATUS_TONE } from './statusDisplay'

const HISTORY_ACTION_LABEL: Record<string, string> = {
  'defect.created': 'Defect created',
  'defect.status_changed': 'Status changed',
  'defect.link_added': 'Link added',
}

export function DefectDetail() {
  const { defectId } = useParams<{ defectId: string }>()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [verificationConfirmed, setVerificationConfirmed] = useState(false)

  const defectQuery = useQuery({
    queryKey: ['defects', 'detail', defectId],
    queryFn: () => getDefect(defectId!),
    enabled: !!defectId,
  })
  const historyQuery = useQuery({
    queryKey: ['defects', 'history', defectId],
    queryFn: () => getDefectHistory(defectId!),
    enabled: !!defectId,
  })

  const statusMutation = useMutation({
    mutationFn: (status: DefectStatus) => updateDefectStatus(defectId!, status, verificationConfirmed),
    onSuccess: () => {
      setVerificationConfirmed(false)
      queryClient.invalidateQueries({ queryKey: ['defects', 'detail', defectId] })
      queryClient.invalidateQueries({ queryKey: ['defects', 'history', defectId] })
    },
  })

  const defect = defectQuery.data
  if (defectQuery.isLoading) return <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>
  if (defectQuery.isError || !defect) return <p className="text-sm text-[var(--destructive)]">Defect not found.</p>

  const currentIndex = STATUS_ORDER.indexOf(defect.status)
  const nextStatus = STATUS_ORDER[currentIndex + 1]
  const isClosing = nextStatus === 'Closed'
  const canCloseRole = user?.role === 'admin' || user?.role === 'manager'
  const canAdvance = !isClosing || canCloseRole
  const advanceDisabled = !canAdvance || statusMutation.isPending || (isClosing && !verificationConfirmed)
  const statusError = statusMutation.error instanceof ApiError ? statusMutation.error.message : null

  const executionConsoleUrl =
    defect.test_run_case_id && defect.test_run_id
      ? `/test-run-cases/${defect.test_run_case_id}?runId=${defect.test_run_id}`
      : null

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
        <div className="flex flex-col gap-2">
          {isClosing && canCloseRole && (
            <label className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
              <input
                type="checkbox"
                checked={verificationConfirmed}
                onChange={(e) => setVerificationConfirmed(e.target.checked)}
              />
              I confirm this defect has been verified and should be closed.
            </label>
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={advanceDisabled} onClick={() => statusMutation.mutate(nextStatus)}>
              Advance to {nextStatus}
            </Button>
            {!canAdvance && (
              <span className="text-xs text-[var(--muted-foreground)]">Only Admin/Manager can close a defect.</span>
            )}
          </div>
        </div>
      )}
      {statusError && <p className="text-xs text-[var(--destructive)]">{statusError}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-[var(--muted-foreground)]">Description</dt>
                <dd>{defect.description || 'No description provided.'}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted-foreground)]">Actual Result</dt>
                <dd>{defect.actual_result || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted-foreground)]">Expected Result</dt>
                <dd>{defect.expected_result || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted-foreground)]">Environment</dt>
                <dd>{defect.environment || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted-foreground)]">Reported By</dt>
                <dd>{defect.reported_by_name ?? 'Unknown'}</dd>
              </div>
            </dl>
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
              <dt className="text-[var(--muted-foreground)]">Test Case Version</dt>
              <dd>{defect.test_case_version_number !== null ? `v${defect.test_case_version_number}` : '—'}</dd>
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
              <dt className="text-[var(--muted-foreground)]">Failed Step</dt>
              <dd>
                {defect.step_number !== null ? (
                  executionConsoleUrl ? (
                    <Link to={executionConsoleUrl} className="underline-offset-2 hover:underline">
                      Step {defect.step_number} (open in console)
                    </Link>
                  ) : (
                    `Step ${defect.step_number}`
                  )
                ) : (
                  '—'
                )}
              </dd>
              <dt className="text-[var(--muted-foreground)]">Reported</dt>
              <dd>{new Date(defect.created_at).toLocaleString()}</dd>
              <dt className="text-[var(--muted-foreground)]">Closed</dt>
              <dd>{defect.closed_at ? new Date(defect.closed_at).toLocaleString() : '—'}</dd>
            </dl>
          </CardContent>
        </Card>

        {defect.execution_evidence && (
          <Card>
            <CardHeader>
              <CardTitle>Execution Evidence</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-[var(--muted-foreground)]">Verdict</dt>
                <dd>{defect.execution_evidence.verdict ?? '—'}</dd>
                <dt className="text-[var(--muted-foreground)]">Opened</dt>
                <dd>
                  {defect.execution_evidence.opened_at
                    ? new Date(defect.execution_evidence.opened_at).toLocaleString()
                    : '—'}
                </dd>
                <dt className="text-[var(--muted-foreground)]">Closed</dt>
                <dd>
                  {defect.execution_evidence.closed_at
                    ? new Date(defect.execution_evidence.closed_at).toLocaleString()
                    : '—'}
                </dd>
                <dt className="text-[var(--muted-foreground)]">Duration</dt>
                <dd>{defect.execution_evidence.duration_ms !== null ? `${defect.execution_evidence.duration_ms}ms` : '—'}</dd>
                <dt className="text-[var(--muted-foreground)]">Executed By</dt>
                <dd>{defect.execution_evidence.executed_by_name ?? '—'}</dd>
              </dl>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {(historyQuery.data ?? []).length === 0 && (
                <li className="text-[var(--muted-foreground)]">No history recorded.</li>
              )}
              {historyQuery.data?.map((entry) => (
                <li key={entry.id} className="border-b border-[var(--border)] pb-2 last:border-0">
                  <p className="font-medium">{HISTORY_ACTION_LABEL[entry.action] ?? entry.action}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {entry.user_name ?? 'System'} · {new Date(entry.created_at).toLocaleString()}
                    {entry.action === 'defect.status_changed' &&
                      typeof entry.event_metadata.from === 'string' &&
                      typeof entry.event_metadata.to === 'string' &&
                      ` (${entry.event_metadata.from} → ${entry.event_metadata.to})`}
                  </p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
