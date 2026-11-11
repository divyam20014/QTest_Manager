import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bug, Building2, ChevronRight, FileStack, ListChecks, PlayCircle } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'

import { suggestDefectRootCause, type RootCauseSuggestion } from '@/api/ai'
import { ApiError } from '@/api/client'
import {
  getDefect,
  getDefectHistory,
  getPossibleDuplicates,
  reopenDefect,
  setDefectEnvironment,
  updateDefect,
  updateDefectBuildRelease,
  updateDefectRootCause,
  updateDefectStatus,
  type DefectStatus,
  type Priority,
  type RootCause,
} from '@/api/defects'
import { listFieldOptions } from '@/api/fieldCustomization'
import { listModules } from '@/api/modules'
import { listBuilds, listEnvironments, listReleases } from '@/api/testAssets'
import { listUsers } from '@/api/users'
import { AttachmentsCard } from '@/components/AttachmentsCard'
import { CommentsCard } from '@/components/CommentsCard'
import { CustomFieldsCard } from '@/components/CustomFieldsCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import { isManagerOrAbove } from '@/api/auth'
import { useToast } from '@/lib/toast'
import { ROOT_CAUSE_LABEL, ROOT_CAUSES, STATUS_ORDER, STATUS_TONE, severityTone } from './statusDisplay'

const HISTORY_ACTION_LABEL: Record<string, string> = {
  'defect.created': 'Defect created',
  'defect.status_changed': 'Status changed',
  'defect.link_added': 'Link added',
  'defect.root_cause_set': 'Root cause set',
  'defect.reopened': 'Reopened',
  'defect.environment_set': 'Environment set',
  'defect.build_release_set': 'Build/Release set',
}

const REOPENABLE_STATUSES: DefectStatus[] = ['Fixed', 'Verified', 'Closed']

export function DefectDetail() {
  const { defectId } = useParams<{ defectId: string }>()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const [verificationConfirmed, setVerificationConfirmed] = useState(false)
  const onMutationError = (err: unknown, fallback: string) =>
    showToast('error', err instanceof ApiError ? err.message : fallback)

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
  const duplicatesQuery = useQuery({
    queryKey: ['defects', 'possible-duplicates', defectId],
    queryFn: () => getPossibleDuplicates(defectId!),
    enabled: !!defectId,
  })
  const environmentsQuery = useQuery({ queryKey: ['environments'], queryFn: listEnvironments })
  const projectId = defectQuery.data?.project_id
  const buildsQuery = useQuery({
    queryKey: ['builds', projectId],
    queryFn: () => listBuilds(projectId!),
    enabled: !!projectId,
  })
  const releasesQuery = useQuery({
    queryKey: ['releases', projectId],
    queryFn: () => listReleases(projectId!),
    enabled: !!projectId,
  })
  const prioritiesQuery = useQuery({
    queryKey: ['field-options', 'defect_priority'],
    queryFn: () => listFieldOptions('defect_priority'),
  })
  const modulesQuery = useQuery({
    queryKey: ['test-modules', projectId],
    queryFn: () => listModules(projectId!),
    enabled: !!projectId,
  })
  // Pass 2: assigned_to is restricted server-side to project members; this
  // tenant-wide list is a simpler v1 (no dedicated "list project members"
  // endpoint exists yet) -- a non-member selection is rejected by the
  // server with a clear error rather than silently allowed.
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers })

  const updateMutation = useMutation({
    mutationFn: (req: Parameters<typeof updateDefect>[1]) => updateDefect(defectId!, req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['defects', 'detail', defectId] })
      queryClient.invalidateQueries({ queryKey: ['defects', 'history', defectId] })
      showToast('success', 'Defect updated')
    },
    onError: (err) => onMutationError(err, 'Could not update defect'),
  })

  const statusMutation = useMutation({
    mutationFn: (status: DefectStatus) => updateDefectStatus(defectId!, status, verificationConfirmed),
    onSuccess: () => {
      setVerificationConfirmed(false)
      queryClient.invalidateQueries({ queryKey: ['defects', 'detail', defectId] })
      queryClient.invalidateQueries({ queryKey: ['defects', 'history', defectId] })
      showToast('success', 'Status updated')
    },
    // No onError toast -- `statusError` already renders this inline below
    // (see JSX), avoiding the duplicate-text strict-mode-locator problem
    // confirmed by a real Playwright failure elsewhere in this pass.
  })

  const rootCauseMutation = useMutation({
    mutationFn: (rootCause: RootCause | null) => updateDefectRootCause(defectId!, rootCause),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['defects', 'detail', defectId] })
      queryClient.invalidateQueries({ queryKey: ['defects', 'history', defectId] })
      showToast('success', 'Root cause updated')
    },
    onError: (err) => onMutationError(err, 'Could not update root cause'),
  })

  const [aiSuggestion, setAiSuggestion] = useState<RootCauseSuggestion | null>(null)
  const aiSuggestMutation = useMutation({
    mutationFn: () => suggestDefectRootCause(defectId!),
    onSuccess: (data) => setAiSuggestion(data),
  })

  const reopenMutation = useMutation({
    mutationFn: () => reopenDefect(defectId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['defects', 'detail', defectId] })
      queryClient.invalidateQueries({ queryKey: ['defects', 'history', defectId] })
      showToast('success', 'Defect reopened')
    },
    onError: (err) => onMutationError(err, 'Could not reopen defect'),
  })

  const environmentMutation = useMutation({
    mutationFn: (environmentId: string | null) => setDefectEnvironment(defectId!, environmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['defects', 'detail', defectId] })
      queryClient.invalidateQueries({ queryKey: ['defects', 'history', defectId] })
      showToast('success', 'Environment updated')
    },
    onError: (err) => onMutationError(err, 'Could not update environment'),
  })

  const buildReleaseMutation = useMutation({
    mutationFn: ({ buildId, releaseId }: { buildId: string | null; releaseId: string | null }) =>
      updateDefectBuildRelease(defectId!, buildId, releaseId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['defects', 'detail', defectId] })
      queryClient.invalidateQueries({ queryKey: ['defects', 'history', defectId] })
      showToast('success', 'Build/Release updated')
    },
    onError: (err) => onMutationError(err, 'Could not update build/release'),
  })

  const defect = defectQuery.data
  if (defectQuery.isLoading) return <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>
  if (defectQuery.isError || !defect) return <p className="text-sm text-[var(--destructive)]">Defect not found.</p>

  const currentIndex = STATUS_ORDER.indexOf(defect.status)
  const nextStatus = STATUS_ORDER[currentIndex + 1]
  const isClosing = nextStatus === 'Closed'
  const canCloseRole = isManagerOrAbove(user)
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
          <Badge tone={severityTone(defect.severity)}>{defect.severity}</Badge>
          <Badge tone={STATUS_TONE[defect.status]}>{defect.status_label}</Badge>
          {defect.sla_breached && <Badge tone="critical">SLA Breached · {defect.age_days}d</Badge>}
          {defect.reopened_count > 0 && (
            <Badge tone="neutral">Reopened {defect.reopened_count}x</Badge>
          )}
        </div>
      </div>

      {canCloseRole && REOPENABLE_STATUSES.includes(defect.status) && (
        <div>
          <Button
            variant="outline"
            size="sm"
            disabled={reopenMutation.isPending}
            onClick={() => reopenMutation.mutate()}
          >
            Reopen Defect
          </Button>
        </div>
      )}

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

      {(duplicatesQuery.data ?? []).length > 0 && (
        <div className="rounded-md border border-[var(--border)] bg-[var(--muted)] p-3 text-sm">
          <p className="font-medium">Possible duplicates found</p>
          <p className="text-xs text-[var(--muted-foreground)]">
            This is a suggestion only — nothing is linked or merged automatically.
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {duplicatesQuery.data?.map((d) => (
              <li key={d.defect_id} className="flex items-center justify-between">
                <Link to={`/defects/${d.defect_id}`} className="underline-offset-2 hover:underline">
                  {d.title}
                </Link>
                <span className="text-xs text-[var(--muted-foreground)]">
                  {d.status} · {Math.round(d.similarity)}% similar
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

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
                <dt className="text-xs text-[var(--muted-foreground)]">Steps to Reproduce</dt>
                <dd className="whitespace-pre-line">{defect.steps_to_reproduce || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted-foreground)]">Priority</dt>
                <dd>
                  <Select
                    aria-label="Priority"
                    value={defect.priority}
                    disabled={updateMutation.isPending}
                    onChange={(e) => updateMutation.mutate({ priority: e.target.value as Priority })}
                    className="w-56"
                  >
                    {(prioritiesQuery.data ?? []).map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.label}
                      </option>
                    ))}
                  </Select>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted-foreground)]">Module</dt>
                <dd>
                  <Select
                    aria-label="Module"
                    value={defect.module_id ?? ''}
                    disabled={updateMutation.isPending}
                    onChange={(e) => updateMutation.mutate({ module_id: e.target.value || null })}
                    className="w-56"
                  >
                    <option value="">Not set</option>
                    {modulesQuery.data?.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.parent_id ? `↳ ${m.name}` : m.name}
                      </option>
                    ))}
                  </Select>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted-foreground)]">Assigned To</dt>
                <dd>
                  <Select
                    aria-label="Assigned to"
                    value={defect.assigned_to ?? ''}
                    disabled={updateMutation.isPending}
                    onChange={(e) => updateMutation.mutate({ assigned_to: e.target.value || null })}
                    className="w-56"
                  >
                    <option value="">Unassigned</option>
                    {usersQuery.data?.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </Select>
                </dd>
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
                <dd>
                  <Select
                    aria-label="Environment"
                    value={defect.environment_id ?? ''}
                    disabled={environmentMutation.isPending}
                    onChange={(e) => environmentMutation.mutate(e.target.value || null)}
                    className="w-56"
                  >
                    <option value="">
                      {defect.environment ? `Unmapped: ${defect.environment}` : 'Not set'}
                    </option>
                    {environmentsQuery.data?.map((env) => (
                      <option key={env.id} value={env.id}>
                        {env.name}
                      </option>
                    ))}
                  </Select>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted-foreground)]">Found in Build</dt>
                <dd>
                  <Select
                    aria-label="Found in build"
                    value={defect.found_in_build_id ?? ''}
                    disabled={buildReleaseMutation.isPending}
                    onChange={(e) =>
                      buildReleaseMutation.mutate({
                        buildId: e.target.value || null,
                        releaseId: defect.fixed_in_release_id,
                      })
                    }
                    className="w-56"
                  >
                    <option value="">Not set</option>
                    {buildsQuery.data?.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </Select>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted-foreground)]">Fixed in Release</dt>
                <dd>
                  <Select
                    aria-label="Fixed in release"
                    value={defect.fixed_in_release_id ?? ''}
                    disabled={buildReleaseMutation.isPending}
                    onChange={(e) =>
                      buildReleaseMutation.mutate({
                        buildId: defect.found_in_build_id,
                        releaseId: e.target.value || null,
                      })
                    }
                    className="w-56"
                  >
                    <option value="">Not set</option>
                    {releasesQuery.data?.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </Select>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted-foreground)]">Reported By</dt>
                <dd>{defect.reported_by_name ?? 'Unknown'}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted-foreground)]">Root Cause</dt>
                <dd>
                  <Select
                    aria-label="Root cause"
                    value={defect.root_cause ?? ''}
                    disabled={rootCauseMutation.isPending}
                    onChange={(e) =>
                      rootCauseMutation.mutate((e.target.value || null) as RootCause | null)
                    }
                    className="w-56"
                  >
                    <option value="">Uncategorized</option>
                    {ROOT_CAUSES.map((rc) => (
                      <option key={rc} value={rc}>
                        {ROOT_CAUSE_LABEL[rc]}
                      </option>
                    ))}
                  </Select>
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Traceability</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col flex-wrap items-stretch gap-2 md:flex-row md:items-center">
              <TraceNode
                icon={Building2}
                label="Project"
                value={defect.project_name}
                to={`/projects/${defect.project_id}`}
              />
              <TraceArrow />
              <TraceNode
                icon={FileStack}
                label="Test Case"
                value={defect.test_case_title}
                sub={defect.test_case_version_number !== null ? `v${defect.test_case_version_number}` : undefined}
                to={defect.test_case_id ? `/test-cases/${defect.test_case_id}` : null}
              />
              <TraceArrow />
              <TraceNode
                icon={PlayCircle}
                label="Test Run"
                value={defect.test_run_name}
                to={defect.test_run_id ? `/test-runs/${defect.test_run_id}` : null}
              />
              <TraceArrow />
              <TraceNode
                icon={ListChecks}
                label="Failed Step"
                value={defect.step_number !== null ? `Step ${defect.step_number}` : null}
                to={executionConsoleUrl}
              />
              <TraceArrow />
              <TraceNode icon={Bug} label="Defect" value={defect.title} current />
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-y-2 border-t border-[var(--border)] pt-4 text-sm">
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
                    {entry.action === 'defect.root_cause_set' &&
                      ` (${entry.event_metadata.from ?? 'none'} → ${entry.event_metadata.to ?? 'none'})`}
                  </p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>AI Suggestion</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-xs text-[var(--muted-foreground)]">
                Suggestion only — never applied automatically. AI-generated, verify independently.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                disabled={aiSuggestMutation.isPending}
                onClick={() => aiSuggestMutation.mutate()}
              >
                {aiSuggestMutation.isPending ? 'Thinking…' : 'Suggest Root Cause'}
              </Button>
              {aiSuggestMutation.isError && (
                <p className="text-xs text-[var(--destructive)]">
                  {aiSuggestMutation.error instanceof ApiError
                    ? aiSuggestMutation.error.message
                    : 'The assistant is unavailable.'}
                </p>
              )}
              {aiSuggestion && (
                <div className="flex flex-col gap-2 rounded border border-[var(--border)] p-3">
                  <p className="text-xs">
                    <span className="font-medium">Suggested category:</span>{' '}
                    {ROOT_CAUSE_LABEL[aiSuggestion.category as keyof typeof ROOT_CAUSE_LABEL] ??
                      aiSuggestion.category}
                  </p>
                  <p className="text-xs text-[var(--muted-foreground)]">{aiSuggestion.reasoning}</p>
                  <p className="text-xs">
                    <span className="font-medium">Next steps:</span> {aiSuggestion.next_steps}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    className="self-start"
                    disabled={rootCauseMutation.isPending}
                    onClick={() =>
                      rootCauseMutation.mutate(aiSuggestion.category as RootCause)
                    }
                  >
                    Apply this category
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <CustomFieldsCard ownerType="defect" ownerId={defect.id} />
        <AttachmentsCard ownerType="defect" ownerId={defect.id} />
        <CommentsCard ownerType="defect" ownerId={defect.id} />
      </div>
    </div>
  )
}

function TraceArrow() {
  return (
    <ChevronRight className="hidden size-4 shrink-0 self-center text-[var(--muted-foreground)] md:block" />
  )
}

function TraceNode({
  icon: Icon,
  label,
  value,
  sub,
  to,
  current,
}: {
  icon: typeof Bug
  label: string
  value: string | null | undefined
  sub?: string
  to?: string | null
  current?: boolean
}) {
  const content = (
    <div
      className={cn(
        'flex min-w-0 flex-1 items-center gap-2.5 rounded-md border px-3 py-2 md:flex-none md:basis-44',
        current
          ? 'border-[var(--brand)] bg-[var(--brand-muted)]'
          : 'border-[var(--border)]',
        to && 'hover:bg-[var(--muted)]',
      )}
    >
      <Icon className="size-4 shrink-0 text-[var(--muted-foreground)]" />
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">{label}</p>
        <p className="truncate text-sm font-medium">{value ?? '—'}</p>
        {sub && <p className="text-xs text-[var(--muted-foreground)]">{sub}</p>}
      </div>
    </div>
  )
  if (to && value) {
    return (
      <Link to={to} className="block min-w-0 md:flex-none">
        {content}
      </Link>
    )
  }
  return content
}
