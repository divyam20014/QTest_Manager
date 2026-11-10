import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { listDefects, type Defect } from '@/api/defects'
import {
  getRunCaseContext,
  getTestRun,
  listRunCaseSteps,
  openStep,
  recordVerdict,
  type ExecutionStep,
  type RunCaseStatus,
  type Verdict,
} from '@/api/execution'
import { AttachmentsPanel } from '@/components/AttachmentsCard'
import { CommentsPanel } from '@/components/CommentsCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { DefectQuickCreateDialog, type FailedStepContext } from './DefectQuickCreateDialog'

const VERDICT_TONE = { pass: 'positive', fail: 'critical', ignore: 'neutral' } as const
const PRIORITY_TONE: Record<string, 'neutral' | 'warning' | 'critical'> = {
  Low: 'neutral',
  Medium: 'warning',
  High: 'warning',
  Critical: 'critical',
}
const RUN_CASE_STATUS_TONE: Record<RunCaseStatus, 'neutral' | 'positive' | 'warning' | 'critical'> = {
  pending: 'neutral',
  in_progress: 'warning',
  passed: 'positive',
  failed: 'critical',
  blocked: 'critical',
  ignored: 'neutral',
}

export function ExecutionConsole() {
  const { runCaseId } = useParams<{ runCaseId: string }>()
  const [searchParams] = useSearchParams()
  const runId = searchParams.get('runId')
  const queryClient = useQueryClient()
  const [failedStepContext, setFailedStepContext] = useState<FailedStepContext | null>(null)

  const contextQuery = useQuery({
    queryKey: ['execution-context', runCaseId],
    queryFn: () => getRunCaseContext(runCaseId!),
    enabled: !!runCaseId,
  })
  const context = contextQuery.data

  const stepsQuery = useQuery({
    queryKey: ['execution-steps', runCaseId],
    queryFn: () => listRunCaseSteps(runCaseId!),
    enabled: !!runCaseId,
  })

  // Left panel: every other test case in this run, for in-console
  // navigation without dropping back to the Test Run detail page.
  const runQuery = useQuery({
    queryKey: ['execution-console', 'run', runId],
    queryFn: () => getTestRun(runId!),
    enabled: !!runId,
  })

  // GAP-20: one batched call per run to find out which steps already have
  // a defect reported, instead of a per-step lookup. Also backs the right
  // panel's "Defects" card (filtered to this run-case specifically).
  const runDefectsQuery = useQuery({
    queryKey: ['defects', 'by-run', runId],
    queryFn: () => listDefects({ test_run_id: runId! }),
    enabled: !!runId,
  })
  const reportedVersionStepIds = new Set(
    (runDefectsQuery.data ?? []).map((d) => d.test_case_version_step_id),
  )
  // A defect can also be *linked* to this run's step without having been
  // originally created from it ("link to existing defect" flow) -- those
  // links reference the raw execution_steps.id, not the version-step id.
  const reportedExecutionStepIds = new Set(
    (runDefectsQuery.data ?? []).flatMap((d) =>
      d.links.filter((l) => l.linkable_type === 'execution_step').map((l) => l.linkable_id),
    ),
  )
  const caseDefects: Defect[] = (runDefectsQuery.data ?? []).filter(
    (d) => d.test_run_case_id === runCaseId,
  )

  const steps = stepsQuery.data ?? []
  const currentStep = steps.find((s) => s.verdict === null) ?? null
  const runLocked = contextQuery.data?.run_finished || contextQuery.data?.run_paused

  const openMutation = useMutation({ mutationFn: (stepId: string) => openStep(stepId) })

  // Start the server-side timer for the current step as soon as it becomes
  // current (FR-EXEC-002's "stop-clock" timer), not only when a verdict is
  // finally submitted.
  useEffect(() => {
    if (currentStep && currentStep.opened_at === null && !openMutation.isPending && !runLocked) {
      openMutation.mutate(currentStep.id, {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['execution-steps', runCaseId] }),
      })
    }
    // Deliberately scoped to currentStep?.id only: we want this to fire
    // once when the "current" step changes, not on every mutation-state
    // tick while opening is pending.
  }, [currentStep?.id, runLocked])

  const verdictMutation = useMutation({
    mutationFn: ({ stepId, verdict }: { stepId: string; verdict: Verdict }) => recordVerdict(stepId, verdict),
    onSuccess: (updatedStep) => {
      queryClient.invalidateQueries({ queryKey: ['execution-steps', runCaseId] })
      queryClient.invalidateQueries({ queryKey: ['test-runs'] })
      queryClient.invalidateQueries({ queryKey: ['execution-console', 'run', runId] })
      if (updatedStep.verdict === 'fail' && context) {
        setFailedStepContext({
          executionStepId: updatedStep.id,
          projectId: context.project_id,
          projectName: context.project_name,
          runName: context.run_name,
          testCaseTitle: context.test_case_title,
          stepNumber: updatedStep.step_number,
          action: updatedStep.action,
          expected: updatedStep.expected,
        })
      }
    },
  })

  function handleDefectDialogClose() {
    setFailedStepContext(null)
    queryClient.invalidateQueries({ queryKey: ['defects', 'by-run', runId] })
  }

  const submitVerdict = (verdict: Verdict) => {
    if (currentStep && !verdictMutation.isPending) {
      verdictMutation.mutate({ stepId: currentStep.id, verdict })
    }
  }

  // Keyboard shortcuts: P/F/I act on the current step. Disabled while the
  // defect dialog is open (it has its own text inputs) or the run is
  // locked (finished/paused).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (failedStepContext !== null || runLocked || !currentStep) return
      const key = e.key.toLowerCase()
      if (key === 'p') submitVerdict('pass')
      else if (key === 'f') submitVerdict('fail')
      else if (key === 'i') submitVerdict('ignore')
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep?.id, failedStepContext, runLocked, verdictMutation.isPending])

  if (stepsQuery.isLoading) return <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>

  const answeredCount = steps.filter((s) => s.verdict !== null).length
  const progressPercent = steps.length ? Math.round((answeredCount / steps.length) * 100) : 0

  return (
    <div className="flex h-[calc(100vh-7.5rem)] gap-4">
      {/* Left panel: test case navigation within this run */}
      <aside className="flex w-64 shrink-0 flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--background)]">
        <div className="shrink-0 border-b border-[var(--border)] p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Test Run</p>
          <p className="truncate text-sm font-medium">{runQuery.data?.name ?? context?.run_name ?? '—'}</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {!runQuery.data && (
            <p className="p-2 text-xs text-[var(--muted-foreground)]">
              No run context — opened outside a test run.
            </p>
          )}
          {runQuery.data?.cases.map((c) => (
            <Link
              key={c.id}
              to={`/test-run-cases/${c.id}?runId=${runId}`}
              className={cn(
                'flex flex-col gap-1 rounded-md px-2.5 py-2 text-sm hover:bg-[var(--muted)]',
                c.id === runCaseId && 'bg-[var(--muted)] font-medium',
              )}
            >
              <span className="truncate">{c.title}</span>
              <span className="flex items-center justify-between gap-2">
                <Badge tone={RUN_CASE_STATUS_TONE[c.status]} className="text-[10px]">
                  {c.status.replace(/_/g, ' ')}
                </Badge>
                <span className="text-[10px] text-[var(--muted-foreground)]">
                  {c.passed_count}/{c.step_count}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </aside>

      {/* Main panel: step execution */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--background)]">
        <div className="shrink-0 border-b border-[var(--border)] p-4">
          <h1 className="text-lg font-semibold">{context?.test_case_title ?? 'Execution Console'}</h1>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--muted)]">
            <div className="h-full bg-[var(--primary)] transition-all" style={{ width: `${progressPercent}%` }} />
          </div>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            {answeredCount}/{steps.length} steps complete
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex flex-col gap-3">
            {steps.map((step) => (
              <StepCard
                key={step.id}
                step={step}
                isCurrent={currentStep?.id === step.id}
                hasDefect={
                  reportedVersionStepIds.has(step.test_case_version_step_id) ||
                  reportedExecutionStepIds.has(step.id)
                }
                onVerdict={(verdict) => verdictMutation.mutate({ stepId: step.id, verdict })}
                isSubmitting={verdictMutation.isPending}
                disabled={!!runLocked}
              />
            ))}
          </div>
        </div>

        {currentStep && !runLocked && (
          <div className="shrink-0 border-t border-[var(--border)] p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 truncate text-sm text-[var(--muted-foreground)]">
                Step {currentStep.step_number}: {currentStep.action}
              </p>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  onClick={() => submitVerdict('pass')}
                  disabled={verdictMutation.isPending}
                  className="bg-emerald-600 hover:opacity-90"
                >
                  Pass <kbd className="ml-1 opacity-60">P</kbd>
                </Button>
                <Button size="sm" variant="destructive" onClick={() => submitVerdict('fail')} disabled={verdictMutation.isPending}>
                  Fail <kbd className="ml-1 opacity-60">F</kbd>
                </Button>
                <Button size="sm" variant="outline" onClick={() => submitVerdict('ignore')} disabled={verdictMutation.isPending}>
                  Ignore <kbd className="ml-1 opacity-60">I</kbd>
                </Button>
              </div>
            </div>
          </div>
        )}
        {runLocked && (
          <div className="shrink-0 border-t border-[var(--border)] p-3 text-center text-xs text-[var(--muted-foreground)]">
            {context?.run_paused ? 'Run paused — resume it to continue executing.' : 'Run finished.'}
          </div>
        )}
      </div>

      {/* Right panel: execution info + defect details */}
      <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto">
        <Card>
          <CardHeader>
            <CardTitle>Execution Info</CardTitle>
          </CardHeader>
          <CardContent>
            {context ? (
              <dl className="flex flex-col gap-2 text-xs">
                <InfoRow label="Run" value={context.run_name} />
                <InfoRow label="Project" value={context.project_name} />
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-[var(--muted-foreground)]">Priority</dt>
                  <dd>
                    <Badge tone={PRIORITY_TONE[context.priority] ?? 'neutral'}>{context.priority}</Badge>
                  </dd>
                </div>
                <InfoRow label="Version" value={`v${context.version_number}`} />
                <InfoRow label="Assignee" value={context.assignee_name ?? 'Unassigned'} />
                {context.run_paused && (
                  <div className="pt-1">
                    <Badge tone="warning">Run Paused</Badge>
                  </div>
                )}
                {context.run_finished && (
                  <div className="pt-1">
                    <Badge tone="neutral">Run Finished</Badge>
                  </div>
                )}
              </dl>
            ) : (
              <p className="text-xs text-[var(--muted-foreground)]">Loading…</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Defects</CardTitle>
          </CardHeader>
          <CardContent>
            {caseDefects.length === 0 ? (
              <p className="text-xs text-[var(--muted-foreground)]">No defects reported for this test case yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {caseDefects.map((d) => (
                  <li key={d.id}>
                    <Link
                      to={`/defects/${d.id}`}
                      className="flex flex-col gap-1 rounded-md border border-[var(--border)] px-2.5 py-2 text-xs hover:bg-[var(--muted)]"
                    >
                      <span className="truncate font-medium">{d.title}</span>
                      <span className="flex items-center gap-1.5">
                        <Badge tone={d.severity === 'Critical' || d.severity === 'High' ? 'critical' : 'neutral'}>
                          {d.severity}
                        </Badge>
                        <Badge tone="neutral">{d.status}</Badge>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </aside>

      <DefectQuickCreateDialog
        open={failedStepContext !== null}
        onClose={handleDefectDialogClose}
        context={failedStepContext}
      />
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-[var(--muted-foreground)]">{label}</dt>
      <dd className="truncate text-right font-medium text-[var(--foreground)]">{value}</dd>
    </div>
  )
}

function computeElapsedSeconds(openedAt: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(openedAt).getTime()) / 1000))
}

function LiveElapsed({ openedAt }: { openedAt: string }) {
  const [seconds, setSeconds] = useState(() => computeElapsedSeconds(openedAt))

  useEffect(() => {
    const interval = setInterval(() => setSeconds(computeElapsedSeconds(openedAt)), 1000)
    return () => clearInterval(interval)
  }, [openedAt])

  return <span className="text-xs text-[var(--muted-foreground)]">{seconds}s elapsed</span>
}

function StepCard({
  step,
  isCurrent,
  hasDefect,
  onVerdict,
  isSubmitting,
  disabled,
}: {
  step: ExecutionStep
  isCurrent: boolean
  hasDefect: boolean
  onVerdict: (verdict: Verdict) => void
  isSubmitting: boolean
  disabled: boolean
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${isCurrent ? 'border-[var(--primary)]' : 'border-[var(--border)]'}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium">
            {step.step_number}. {step.action}
          </p>
          <p className="text-sm text-[var(--muted-foreground)]">Expected: {step.expected}</p>
          {hasDefect && (
            <Badge tone="critical" className="mt-1">
              🐞 Defect reported
            </Badge>
          )}
          {isCurrent && step.opened_at && !step.verdict && <LiveElapsed openedAt={step.opened_at} />}
        </div>
        {step.verdict && (
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Badge tone={VERDICT_TONE[step.verdict]}>{step.verdict}</Badge>
            {step.duration_ms !== null && (
              <span className="text-xs text-[var(--muted-foreground)]">{step.duration_ms}ms</span>
            )}
          </div>
        )}
      </div>

      {/* BRD Journey 4: after a fix, a previously-verdicted step (most
       * often a Fail) can be re-run and re-verdicted within the same test
       * run -- the backend already supports this (ADR-024 recomputes the
       * case rollup from scratch from current verdicts), so the console
       * must offer it, not just the one-shot "current step" flow above.
       * The sticky bottom bar handles the current step's actions; this
       * inline control is only for re-verdicting an already-answered step. */}
      {!isCurrent && step.verdict && !disabled && <ReverdictControl onVerdict={onVerdict} isSubmitting={isSubmitting} />}

      <StepAttachments stepId={step.id} />
      <StepComments stepId={step.id} />
    </div>
  )
}

// Phase 7 (GAP-75): lets a tester attach evidence (a screenshot, a log
// file) directly to the step they're executing, not just to the defect
// filed afterward -- collapsed by default so it doesn't crowd the console's
// already-dense step list.
function StepAttachments({ stepId }: { stepId: string }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="mt-2 border-t border-[var(--border)] pt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-[var(--muted-foreground)] underline-offset-2 hover:underline"
      >
        {open ? 'Hide attachments' : 'Attachments'}
      </button>
      {open && (
        <div className="mt-2">
          <AttachmentsPanel ownerType="execution_step" ownerId={stepId} />
        </div>
      )}
    </div>
  )
}

// Phase 8 (GAP-74): same collapsed-by-default placement as StepAttachments,
// reusing the same polymorphic owner_type pattern.
function StepComments({ stepId }: { stepId: string }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="mt-2 border-t border-[var(--border)] pt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-[var(--muted-foreground)] underline-offset-2 hover:underline"
      >
        {open ? 'Hide comments' : 'Comments'}
      </button>
      {open && (
        <div className="mt-2">
          <CommentsPanel ownerType="execution_step" ownerId={stepId} />
        </div>
      )}
    </div>
  )
}

function ReverdictControl({
  onVerdict,
  isSubmitting,
}: {
  onVerdict: (verdict: Verdict) => void
  isSubmitting: boolean
}) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 text-xs text-[var(--muted-foreground)] underline-offset-2 hover:underline"
      >
        Re-run step
      </button>
    )
  }

  return (
    <div className="mt-3 flex gap-2">
      <Button
        size="sm"
        onClick={() => {
          onVerdict('pass')
          setOpen(false)
        }}
        disabled={isSubmitting}
        className="bg-emerald-600 hover:opacity-90"
      >
        Pass
      </Button>
      <Button
        size="sm"
        variant="destructive"
        onClick={() => {
          onVerdict('fail')
          setOpen(false)
        }}
        disabled={isSubmitting}
      >
        Fail
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          onVerdict('ignore')
          setOpen(false)
        }}
        disabled={isSubmitting}
      >
        Ignore
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={isSubmitting}>
        Cancel
      </Button>
    </div>
  )
}
