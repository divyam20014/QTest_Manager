import { useEffect, useId, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Ban, Bug, CheckCircle2, ChevronDown, CircleDot, Gauge, PauseCircle, XCircle } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { getDefectDraft, listDefects, type Defect } from '@/api/defects'
import {
  blockRunCase,
  getRunCaseContext,
  getTestRun,
  listRunCaseSteps,
  openStep,
  recordVerdict,
  unblockRunCase,
  type ExecutionStep,
  type TestRun,
  type TestRunCase,
  type Verdict,
} from '@/api/execution'
import { AttachmentsPanel } from '@/components/AttachmentsCard'
import { CommentsPanel } from '@/components/CommentsCard'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ErrorState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/lib/auth'
import { useCockpitMode } from '@/lib/cockpitMode'
import { describeClock, formatClock, formatDurationMs } from '@/lib/duration'
import { humanizeKey } from '@/lib/labels'
import { levelTone, RUN_CASE_STATUS_TONE, VERDICT_TONE } from '@/lib/statusTones'
import { useToast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { BlockCaseDialog } from './BlockCaseDialog'
import { DefectQuickCreateDialog, type FailedStepContext } from './DefectQuickCreateDialog'
import { DefectQuickViewDialog } from './DefectQuickViewDialog'
import { DefectStatusBadge } from '@/routes/defects/DefectStatusBadge'

export function ExecutionConsole() {
  const { runCaseId } = useParams<{ runCaseId: string }>()
  const [searchParams] = useSearchParams()
  const runId = searchParams.get('runId')
  const queryClient = useQueryClient()
  const [failedStepContext, setFailedStepContext] = useState<FailedStepContext | null>(null)
  // Phone only: the run's case list is collapsed by default so the steps come first.
  const [casesOpen, setCasesOpen] = useState(false)
  // BRD FR-EXEC-04: the defect whose quick view is open (by id, so the dialog
  // always shows the freshest copy from the run's defect list).
  const [quickViewDefectId, setQuickViewDefectId] = useState<string | null>(null)
  // ADR-070 "Block Case": the reason dialog.
  const [blockOpen, setBlockOpen] = useState(false)
  const [cockpit, setCockpit] = useCockpitMode()
  const { show: showToast } = useToast()
  const { user } = useAuth()

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
  const runDefects: Defect[] = runDefectsQuery.data ?? []
  // The defects to show on one step: those reported from it (matched on the
  // version-step id) plus those *linked* to it afterwards ("link to existing
  // defect" flow -- those links reference the raw execution_steps.id).
  function defectsForStep(step: ExecutionStep): Defect[] {
    return runDefects.filter(
      (d) =>
        d.test_case_version_step_id === step.test_case_version_step_id ||
        d.links.some((l) => l.linkable_type === 'execution_step' && l.linkable_id === step.id),
    )
  }
  const quickViewDefect = runDefects.find((d) => d.id === quickViewDefectId) ?? null
  // The defects of this run case: raised from it, or linked to it afterwards (ADR-118). The draft endpoint
  // lists both; the run's own list covers a defect raised here before the draft loads.
  const runCaseDefectsQuery = useQuery({
    queryKey: ['defects', 'run-case', runCaseId],
    queryFn: () => getDefectDraft(runCaseId!).then((d) => d.existing_defects),
    enabled: !!runCaseId,
    retry: false,
  })
  const caseDefects: { id: string; display_id: string | null; title: string; severity: string; status: string }[] = [
    ...(runCaseDefectsQuery.data ?? []),
    ...runDefects.filter((d) => d.test_run_case_id === runCaseId && !(runCaseDefectsQuery.data ?? []).some((x) => x.id === d.id)),
  ]

  const steps = stepsQuery.data ?? []
  const currentStep = steps.find((s) => s.verdict === null) ?? null
  // Actual result typed for the step being executed (ADR-116): required to Fail, optional for Pass.
  // Kept with the step id so moving to the next step starts with an empty box.
  const [actualDraft, setActualDraft] = useState<{ stepId: string | null; text: string; error: string | null }>({
    stepId: null,
    text: '',
    error: null,
  })
  const actualResult = actualDraft.stepId === (currentStep?.id ?? null) ? actualDraft.text : ''
  const actualError = actualDraft.stepId === (currentStep?.id ?? null) ? actualDraft.error : null
  const actualRef = useRef<HTMLTextAreaElement>(null)
  const runLocked = contextQuery.data?.run_finished || contextQuery.data?.run_paused
  // A blocked case takes no verdicts until it is unblocked.
  const blocked = contextQuery.data?.status === 'blocked'

  const contextLoaded = contextQuery.data !== undefined
  const openMutation = useMutation({ mutationFn: (stepId: string) => openStep(stepId) })

  // Start the server-side timer for the current step as soon as it becomes
  // current (FR-EXEC-002's "stop-clock" timer), not only when a verdict is
  // finally submitted.
  useEffect(() => {
    // Wait for the case context before opening a step: a blocked case refuses
    // step opens (409), which would otherwise log a console error on load.
    if (
      currentStep &&
      currentStep.opened_at === null &&
      !openMutation.isPending &&
      !runLocked &&
      contextLoaded &&
      !blocked
    ) {
      openMutation.mutate(currentStep.id, {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['execution-steps', runCaseId] }),
      })
    }
    // Deliberately scoped to currentStep?.id only: we want this to fire
    // once when the "current" step changes, not on every mutation-state
    // tick while opening is pending.
  }, [currentStep?.id, runLocked, blocked, contextLoaded])

  // Everything a verdict / block / unblock can change: the step list, this
  // case's context (status, and run_finished when the last verdict
  // auto-finishes the run), the run's case list and the runs lists.
  function refreshAfterChange() {
    queryClient.invalidateQueries({ queryKey: ['execution-steps', runCaseId] })
    queryClient.invalidateQueries({ queryKey: ['execution-context', runCaseId] })
    queryClient.invalidateQueries({ queryKey: ['test-runs'] })
    queryClient.invalidateQueries({ queryKey: ['execution-console', 'run', runId] })
  }

  const blockMutation = useMutation({
    mutationFn: (reason: string) => blockRunCase(runCaseId!, reason),
    onSuccess: () => {
      setBlockOpen(false)
      refreshAfterChange()
      showToast('success', 'Test case blocked.')
    },
    onError: (error: Error) => showToast('error', error.message || 'Could not block this test case.'),
  })

  const unblockMutation = useMutation({
    mutationFn: () => unblockRunCase(runCaseId!),
    onSuccess: () => {
      refreshAfterChange()
      showToast('success', 'Test case unblocked.')
    },
    onError: (error: Error) => showToast('error', error.message || 'Could not unblock this test case.'),
  })

  // Auto-finish (ADR-070): when the final verdict/block ends the run, say so.
  const runFinished = !!context?.run_finished
  const wasFinished = useRef<boolean | null>(null)
  useEffect(() => {
    if (!context) return
    if (wasFinished.current === false && runFinished) {
      showToast('success', 'Every test case in this run has a result, so the run finished automatically.')
    }
    wasFinished.current = runFinished
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runFinished, context?.run_id])

  const verdictMutation = useMutation({
    mutationFn: ({ stepId, verdict, actualResult }: { stepId: string; verdict: Verdict; actualResult?: string }) =>
      recordVerdict(stepId, verdict, actualResult),
    onSuccess: (updatedStep) => {
      refreshAfterChange()
      setActualDraft({ stepId: null, text: '', error: null })
      if (updatedStep.verdict === 'fail' && context) {
        setFailedStepContext({
          runCaseId: runCaseId!,
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
      // Deliberately no success toast here: the step's verdict badge
      // renders immediately as visible confirmation, and this fires on
      // every P/F/I keypress -- a toast per step would be noisy, not
      // helpful, during a long execution run.
    },
    onError: (error) =>
      showToast(
        'error',
        // A refusal carries its reason (e.g. "This test case is not assigned to
        // you"); "try again" would be wrong advice for it.
        error instanceof ApiError && error.status === 403
          ? error.message
          : 'Could not record that verdict -- the step was not updated. Try again.',
      ),
  })

  function handleDefectDialogClose() {
    setFailedStepContext(null)
    queryClient.invalidateQueries({ queryKey: ['defects', 'by-run', runId] })
    queryClient.invalidateQueries({ queryKey: ['defects', 'run-case', runCaseId] })
  }

  const submitVerdict = (verdict: Verdict) => {
    if (!currentStep || verdictMutation.isPending) return
    // Failing a step needs the actual result (inline, required); Pass keeps it optional; Ignore sends none.
    if (verdict === 'fail' && !actualResult.trim()) {
      setActualDraft({ stepId: currentStep.id, text: actualResult, error: 'Describe what actually happened to fail this step.' })
      actualRef.current?.focus()
      return
    }
    verdictMutation.mutate({
      stepId: currentStep.id,
      verdict,
      actualResult: verdict === 'ignore' ? undefined : actualResult,
    })
  }

  // Keyboard shortcuts: P/F/I act on the current step. Disabled while the
  // defect dialog is open (it has its own text inputs) or the run is
  // locked (finished/paused).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (failedStepContext !== null || quickViewDefectId !== null || blockOpen || blocked || runLocked || !currentStep) return
      // Never treat typing as a verdict: the right panel has a comment box, and
      // a tester typing "pass" there used to record Pass, then Ignore...
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      ) {
        return
      }
      const key = e.key.toLowerCase()
      if (key === 'p') submitVerdict('pass')
      else if (key === 'f') submitVerdict('fail')
      else if (key === 'i') submitVerdict('ignore')
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep?.id, failedStepContext, quickViewDefectId, blockOpen, blocked, runLocked, verdictMutation.isPending, actualResult])

  if (stepsQuery.isLoading) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <Skeleton className="h-6 w-64" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    )
  }
  if (stepsQuery.isError) {
    return <ErrorState error={stepsQuery.error} onRetry={() => stepsQuery.refetch()} />
  }

  // The next case in this run that still needs work (after this one, else the
  // first earlier one), so a tester running many cases never goes back to the list.
  const runCases = runQuery.data?.cases ?? []
  const currentCaseIndex = runCases.findIndex((c) => c.id === runCaseId)
  const needsWork = (c: (typeof runCases)[number]) => c.status === 'pending' || c.status === 'in_progress'
  const remainingCases = [
    ...runCases.slice(currentCaseIndex + 1),
    ...runCases.slice(0, Math.max(0, currentCaseIndex)),
  ].filter((c) => c.id !== runCaseId && needsWork(c))
  // The tester's own queue comes first: cases assigned to them or to nobody.
  // Cases assigned to someone else are only offered once that queue is empty.
  const isMine = (c: (typeof runCases)[number]) => c.assigned_to === null || c.assigned_to === user?.user_id
  const myRemaining = remainingCases.filter(isMine)
  const othersRemaining = remainingCases.filter((c) => !isMine(c))
  const nextCase = myRemaining[0] ?? othersRemaining[0] ?? null
  const caseComplete = steps.length > 0 && !currentStep
  // BRD FR-EXEC-03 "mission complete": this case is done and nothing is left
  // in the tester's own queue.
  const showSummary = (caseComplete || blocked) && !!runQuery.data && myRemaining.length === 0

  const answeredCount = steps.filter((s) => s.verdict !== null).length
  const progressPercent = steps.length ? Math.round((answeredCount / steps.length) * 100) : 0

  return (
    <div className={cn('flex flex-col gap-4 xl:h-[calc(100vh-7.5rem)] xl:flex-row', cockpit && 'cockpit gap-2')}>
      {/* Left panel: test case navigation within this run. On a phone it is a
          collapsed "cases in this run" header so the steps come first. */}
      <aside aria-label="Test cases in this run" className={cn('flex shrink-0 flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--background)] xl:w-64', cockpit && 'cockpit-panel')}>
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] p-3 max-xl:border-b-0 max-xl:py-1">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Test Run</p>
            <p className="truncate text-sm font-medium">{runQuery.data?.name ?? context?.run_name ?? '—'}</p>
          </div>
          {runQuery.data && (
            <button
              type="button"
              onClick={() => setCasesOpen((o) => !o)}
              aria-expanded={casesOpen}
              aria-controls="run-cases-list"
              className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md px-2 text-sm text-[var(--muted-foreground)] xl:hidden"
            >
              {runQuery.data.cases.length} cases
              <ChevronDown className={cn('size-4 transition-transform motion-reduce:transition-none', casesOpen && 'rotate-180')} aria-hidden="true" />
            </button>
          )}
        </div>
        <div
          id="run-cases-list"
          className={cn('flex-1 overflow-y-auto p-2 max-xl:max-h-72 max-xl:border-t max-xl:border-[var(--border)]', !casesOpen && 'max-xl:hidden')}
        >
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
                'flex flex-col gap-1 rounded-md px-2.5 py-2 text-sm hover:bg-[var(--muted)] max-md:min-h-11 max-md:justify-center',
                c.id === runCaseId && 'bg-[var(--muted)] font-medium',
              )}
            >
              <span className="truncate">{c.title}</span>
              <span className="flex items-center justify-between gap-2">
                <Badge tone={RUN_CASE_STATUS_TONE[c.status]} className="text-[11px]">
                  {humanizeKey(c.status)}
                </Badge>
                <span className="text-[11px] text-[var(--muted-foreground)]">
                  {c.passed_count}/{c.step_count}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </aside>

      {/* Main panel: step execution */}
      <div className={cn('flex min-w-0 flex-1 flex-col rounded-lg border border-[var(--border)] bg-[var(--background)] xl:overflow-hidden', cockpit && 'cockpit-panel')}>
        <div className={cn('shrink-0 border-b border-[var(--border)] p-4', cockpit && 'cockpit-header cockpit-dense')}>
          <div className="flex items-start justify-between gap-2">
            <h1 className="min-w-0 break-words text-lg font-semibold">{context?.test_case_title ?? 'Execution Console'}</h1>
            <button
              type="button"
              aria-pressed={cockpit}
              onClick={() => setCockpit(!cockpit)}
              className={cn(
                'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]',
                cockpit ? 'bg-[var(--primary)] text-[var(--primary-foreground)]' : 'text-[var(--foreground)] hover:bg-[var(--muted)]',
              )}
            >
              <Gauge className="size-4" aria-hidden="true" />
              Cockpit mode
            </button>
          </div>
          <div className={cn('mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--muted)]', cockpit && 'cockpit-track')}>
            <div className="h-full bg-[var(--primary)] transition-all" style={{ width: `${progressPercent}%` }} />
          </div>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            {answeredCount}/{steps.length} steps complete
          </p>
          {cockpit && (
            <div className="cockpit-statusbar mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              {blocked ? (
                <span className="inline-flex items-center gap-1.5 text-[var(--status-critical)]">
                  <Ban className="size-4" aria-hidden="true" />
                  Blocked
                </span>
              ) : context?.run_paused ? (
                <span className="inline-flex items-center gap-1.5 text-[var(--status-warning)]">
                  <PauseCircle className="size-4" aria-hidden="true" />
                  Run paused
                </span>
              ) : null}
              {currentStep && currentStep.opened_at && blocked && (
                <span className="text-[var(--muted-foreground)]">Timer paused while blocked</span>
              )}
              {currentStep && currentStep.opened_at && !blocked && !runLocked && (
                <LiveElapsed openedAt={currentStep.opened_at} cockpit />
              )}
              {currentStep && (
                <span className="text-[var(--muted-foreground)]">
                  Step {currentStep.step_number} of {steps.length}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 p-4 xl:overflow-y-auto">
          {blocked && (
            <div
              role="status"
              className="mb-3 flex flex-col gap-3 rounded-lg border border-[var(--status-critical)] bg-[var(--muted)] p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-start gap-2">
                <Ban className="mt-0.5 size-4 shrink-0 text-[var(--status-critical)]" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">This test case is blocked</p>
                  <p className="break-words text-sm text-[var(--muted-foreground)]">
                    {context?.blocked_reason ?? 'No reason recorded.'}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2 max-md:[&>*]:h-12 max-md:[&>*]:flex-1">
                {nextCase && runId && (
                  <Link
                    to={`/test-run-cases/${nextCase.id}?runId=${runId}`}
                    className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'max-md:text-base')}
                  >
                    Next case
                  </Link>
                )}
                {!runLocked && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => unblockMutation.mutate()}
                    disabled={unblockMutation.isPending}
                    className="max-md:text-base"
                  >
                    {unblockMutation.isPending ? 'Unblocking…' : 'Unblock'}
                  </Button>
                )}
              </div>
            </div>
          )}
          <div className="flex flex-col gap-3">
            {steps.map((step) => (
              <StepCard
                key={step.id}
                step={step}
                isCurrent={currentStep?.id === step.id}
                defects={defectsForStep(step)}
                onOpenDefect={(d) => setQuickViewDefectId(d.id)}
                onVerdict={(verdict, actual) => verdictMutation.mutate({ stepId: step.id, verdict, actualResult: actual })}
                isSubmitting={verdictMutation.isPending}
                disabled={!!runLocked || blocked}
                timerPaused={blocked}
                hideTimer={cockpit}
              />
            ))}
          </div>
          {showSummary && runQuery.data && (
            <RunSummary
              run={runQuery.data}
              runId={runId!}
              projectId={context?.project_id ?? runQuery.data.project_id}
              defectCount={runDefects.length}
              othersRemaining={othersRemaining.length}
            />
          )}
        </div>

        {steps.length > 0 && !currentStep && !runLocked && !(showSummary && !nextCase) && (
          <div
            role="status"
            className="shrink-0 border-t border-[var(--border)] bg-[var(--background)] p-3 max-xl:sticky max-xl:bottom-0 max-md:bottom-[calc(4.75rem+env(safe-area-inset-bottom))] max-xl:z-30"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 max-md:flex-col max-md:items-stretch">
              <p className="text-sm text-[var(--muted-foreground)]">
                {steps.length === 1 ? 'The step is' : `All ${steps.length} steps are`} recorded for this test case.
              </p>
              {nextCase ? (
                <Link
                  to={`/test-run-cases/${nextCase.id}?runId=${runId}`}
                  className={cn(
                    buttonVariants({ size: 'sm', variant: showSummary ? 'outline' : 'default' }),
                    'max-md:h-12 max-md:text-base',
                  )}
                >
                  Next case: {nextCase.title.length > 40 ? `${nextCase.title.slice(0, 40)}…` : nextCase.title}
                </Link>
              ) : (
                // With the summary on screen its own "Back to the run" is the action.
                runId && !showSummary && (
                  <Link
                    to={`/test-runs/${runId}`}
                    className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'max-md:h-12 max-md:text-base')}
                  >
                    Back to the run
                  </Link>
                )
              )}
            </div>
          </div>
        )}
        {currentStep && !runLocked && !blocked && (
          // Phone: the verdict bar is pinned just above the bottom tab bar so
          // Pass / Fail / Ignore are always one thumb-tap away while the steps
          // scroll beneath it. Desktop keeps the old in-panel footer.
          <div
            role="group"
            aria-label="Record a verdict for the current step"
            className={cn('shrink-0 border-t border-[var(--border)] bg-[var(--background)] p-3 max-xl:sticky max-xl:bottom-0 max-md:bottom-[calc(4.75rem+env(safe-area-inset-bottom))] max-xl:z-30 max-xl:rounded-b-lg max-xl:shadow-[0_-6px_16px_-8px_rgb(0_0_0/0.25)]', cockpit && 'cockpit-verdicts')}
          >
            <div className="mb-2 flex flex-col gap-1">
              <label htmlFor="actual-result" className="text-xs font-medium">
                Actual result{' '}
                <span className="font-normal text-[var(--muted-foreground)]">(required to fail a step, optional for Pass)</span>
              </label>
              <Textarea
                id="actual-result"
                ref={actualRef}
                rows={2}
                className="min-h-14 max-md:min-h-14"
                value={actualResult}
                aria-invalid={actualError ? true : undefined}
                aria-describedby={actualError ? 'actual-result-error' : undefined}
                onChange={(e) => setActualDraft({ stepId: currentStep.id, text: e.target.value, error: null })}
              />
              {actualError && (
                <p id="actual-result-error" role="alert" className="text-xs text-[var(--destructive)]">
                  {actualError}
                </p>
              )}
            </div>
            <div className="flex items-center justify-between gap-3 max-md:flex-col max-md:items-stretch max-md:gap-2">
              <p className="min-w-0 truncate text-sm text-[var(--muted-foreground)] max-md:line-clamp-2 max-md:whitespace-normal">
                Step {currentStep.step_number}: {currentStep.action}
              </p>
              <div className="flex shrink-0 gap-2 max-md:[&>button]:h-12 max-md:[&>button]:flex-1 max-md:[&>button]:text-base">
                <Button
                  size="sm"
                  variant="success"
                  onClick={() => submitVerdict('pass')}
                  disabled={verdictMutation.isPending}
                >
                  Pass <kbd className="ml-1 opacity-60 max-md:hidden">P</kbd>
                </Button>
                <Button size="sm" variant="destructive" onClick={() => submitVerdict('fail')} disabled={verdictMutation.isPending}>
                  Fail <kbd className="ml-1 opacity-60 max-md:hidden">F</kbd>
                </Button>
                <Button size="sm" variant="outline" onClick={() => submitVerdict('ignore')} disabled={verdictMutation.isPending}>
                  Ignore <kbd className="ml-1 opacity-60 max-md:hidden">I</kbd>
                </Button>
                <Button size="sm" variant="outline" onClick={() => setBlockOpen(true)} disabled={verdictMutation.isPending}>
                  <Ban className="size-4" aria-hidden="true" />
                  Block
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
      <aside aria-label="Execution details" className="flex shrink-0 flex-col gap-3 xl:w-72 xl:overflow-y-auto">
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
                    <Badge tone={levelTone(context.priority)}>{context.priority}</Badge>
                  </dd>
                </div>
                <InfoRow label="Version" value={`v${context.version_number}`} />
                <InfoRow label="Assignee" value={context.assignee_name ?? 'Unassigned'} />
                {context.data_row_id && (
                  <div className="rounded-md border border-[var(--border)] bg-[var(--muted)] p-2">
                    <p className="mb-1 font-medium text-[var(--foreground)]">
                      Data row: {context.data_row_name}
                    </p>
                    <ul className="flex flex-col gap-0.5">
                      {Object.entries(context.data_row_values ?? {}).map(([key, value]) => (
                        <li key={key} className="flex justify-between gap-2">
                          <span className="text-[var(--muted-foreground)]">{key}</span>
                          <span className="font-mono">{String(value)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
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
              <div role="status" className="flex flex-col gap-2"><span className="sr-only">Loading</span><Skeleton className="h-4 w-48" /><Skeleton className="h-4 w-32" /></div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Defects</CardTitle>
          </CardHeader>
          <CardContent>
            {caseDefects.length === 0 ? (
              <p className="text-xs text-[var(--muted-foreground)]">No defects reported or linked for this test case yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {caseDefects.map((d) => (
                  <li key={d.id}>
                    <Link
                      to={`/defects/${d.id}`}
                      className="flex flex-col gap-1 rounded-md border border-[var(--border)] px-2.5 py-2 text-xs hover:bg-[var(--muted)]"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="font-mono">{d.display_id ?? ''}</span>
                        <span className="truncate font-medium">{d.title}</span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Badge tone={d.severity === 'Critical' || d.severity === 'High' ? 'critical' : 'neutral'}>
                          {d.severity}
                        </Badge>
                        <DefectStatusBadge status={d.status} />
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
      <DefectQuickViewDialog defect={quickViewDefect} onClose={() => setQuickViewDefectId(null)} />
      <BlockCaseDialog
        open={blockOpen}
        caseTitle={context?.test_case_title ?? 'This test case'}
        pending={blockMutation.isPending}
        onClose={() => setBlockOpen(false)}
        onSubmit={(reason) => blockMutation.mutate(reason)}
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

function LiveElapsed({ openedAt, cockpit = false }: { openedAt: string; cockpit?: boolean }) {
  const [seconds, setSeconds] = useState(() => computeElapsedSeconds(openedAt))

  useEffect(() => {
    const interval = setInterval(() => setSeconds(computeElapsedSeconds(openedAt)), 1000)
    return () => clearInterval(interval)
  }, [openedAt])

  // `role="timer"` is not announced on every tick (implicit aria-live="off");
  // a screen-reader user reads the current value on demand, in words.
  return (
    <span
      role="timer"
      aria-label={`Time on this step: ${describeClock(seconds)}`}
      className={cn('inline-flex items-center gap-1 tabular-nums', cockpit ? 'text-[var(--foreground)]' : 'mt-1 text-xs text-[var(--muted-foreground)] max-md:text-sm')}
    >
      <span aria-hidden="true">{formatClock(seconds)} elapsed</span>
    </span>
  )
}

function StepCard({
  step,
  isCurrent,
  defects,
  onOpenDefect,
  onVerdict,
  isSubmitting,
  disabled,
  timerPaused,
  hideTimer,
}: {
  step: ExecutionStep
  isCurrent: boolean
  defects: Defect[]
  onOpenDefect: (defect: Defect) => void
  onVerdict: (verdict: Verdict, actualResult?: string) => void
  isSubmitting: boolean
  disabled: boolean
  // ADR-075: the step timer does not run while the case is blocked.
  timerPaused: boolean
  hideTimer?: boolean
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${isCurrent ? 'border-[var(--primary)]' : 'border-[var(--border)]'}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="break-words text-sm font-medium max-md:text-base">
            {step.step_number}. {step.action}
          </p>
          <p className="break-words text-sm text-[var(--muted-foreground)] max-md:text-base">Expected: {step.expected}</p>
          {defects.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge tone="critical">🐞 Defect reported</Badge>
              {defects.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => onOpenDefect(d)}
                  aria-haspopup="dialog"
                  aria-label={`View defect: ${d.title}`}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--status-serious)] px-2.5 py-0.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)] motion-reduce:transition-none max-md:min-h-11 max-md:px-3 max-md:text-sm"
                >
                  <Bug className="size-3.5 shrink-0 text-[var(--status-serious)]" aria-hidden="true" />
                  <span className="truncate">{d.title}</span>
                </button>
              ))}
            </div>
          )}
          {isCurrent && step.opened_at && !step.verdict && !hideTimer && (
            <div>
              {timerPaused ? (
                <span className="mt-1 inline-flex text-xs text-[var(--muted-foreground)] max-md:text-sm">
                  Timer paused while blocked
                </span>
              ) : (
                <LiveElapsed openedAt={step.opened_at} />
              )}
            </div>
          )}
        </div>
        {step.verdict && (
          <div className="flex shrink-0 flex-col items-end gap-1">
            <StatusBadge tone={VERDICT_TONE[step.verdict]}>{step.verdict}</StatusBadge>
            {step.duration_ms !== null && (
              <span
                className="text-xs tabular-nums text-[var(--muted-foreground)]"
                title={`${step.duration_ms.toLocaleString()} ms`}
              >
                {formatDurationMs(step.duration_ms)}
              </span>
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
        className="inline-flex text-xs text-[var(--muted-foreground)] underline-offset-2 hover:underline max-md:min-h-11 max-md:items-center max-md:text-sm"
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
        className="inline-flex text-xs text-[var(--muted-foreground)] underline-offset-2 hover:underline max-md:min-h-11 max-md:items-center max-md:text-sm"
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
  onVerdict: (verdict: Verdict, actualResult?: string) => void
  isSubmitting: boolean
}) {
  const [open, setOpen] = useState(false)
  const [actual, setActual] = useState('')
  const [error, setError] = useState<string | null>(null)
  const id = useId()

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex text-xs text-[var(--muted-foreground)] underline-offset-2 hover:underline max-md:min-h-11 max-md:items-center max-md:text-sm"
      >
        Re-run step
      </button>
    )
  }

  function submit(verdict: Verdict) {
    if (verdict === 'fail' && !actual.trim()) {
      setError('Describe what actually happened to fail this step.')
      return
    }
    onVerdict(verdict, verdict === 'ignore' ? undefined : actual)
    setOpen(false)
    setActual('')
    setError(null)
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-xs font-medium">
          Actual result <span className="font-normal text-[var(--muted-foreground)]">(required to fail, optional for Pass)</span>
        </label>
        <Textarea
          id={id}
          rows={2}
          className="min-h-14"
          value={actual}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => {
            setActual(e.target.value)
            setError(null)
          }}
        />
        {error && (
          <p id={`${id}-error`} role="alert" className="text-xs text-[var(--destructive)]">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="success" onClick={() => submit('pass')} disabled={isSubmitting}>
          Pass
        </Button>
        <Button size="sm" variant="destructive" onClick={() => submit('fail')} disabled={isSubmitting}>
          Fail
        </Button>
        <Button size="sm" variant="outline" onClick={() => submit('ignore')} disabled={isSubmitting}>
          Ignore
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={isSubmitting}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

const SUMMARY_ICON: Partial<Record<BadgeTone, typeof CircleDot>> = {
  positive: CheckCircle2,
  critical: XCircle,
  warning: AlertTriangle,
  neutral: CircleDot,
}
const SUMMARY_COLOR: Partial<Record<BadgeTone, string>> = {
  positive: 'var(--status-good)',
  critical: 'var(--status-serious)',
  warning: 'var(--status-warning)',
}

// BRD FR-EXEC-03: the end-of-queue summary. Every figure is read from the
// run the console already has loaded -- nothing is estimated.
function RunSummary({
  run,
  runId,
  projectId,
  defectCount,
  othersRemaining,
}: {
  run: TestRun
  runId: string
  projectId: string
  defectCount: number
  othersRemaining: number
}) {
  const ref = useRef<HTMLElement>(null)
  // The summary appears below the last step; bring it into view once.
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ref.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' })
  }, [])

  const count = (status: TestRunCase['status']) => run.cases.filter((c) => c.status === status).length
  const stillOpen = count('pending') + count('in_progress')
  // Time actually spent executing: per case, from its first step being opened
  // to its last verdict. Cases still in progress are not counted.
  const executedMs = run.cases.reduce((sum, c) => {
    if (!c.started_at || !c.completed_at) return sum
    return sum + Math.max(0, new Date(c.completed_at).getTime() - new Date(c.started_at).getTime())
  }, 0)
  const allTiles: { label: string; value: number; tone: BadgeTone }[] = [
    { label: 'Passed', value: count('passed'), tone: 'positive' },
    { label: 'Failed', value: count('failed'), tone: 'critical' },
    { label: 'Ignored', value: count('ignored'), tone: 'neutral' },
    { label: 'Blocked', value: count('blocked'), tone: 'critical' },
    { label: 'Open', value: stillOpen, tone: 'warning' },
  ]
  // Only show the Blocked tile when the run actually has blocked cases.
  const tiles = allTiles.filter((t) => t.label !== 'Blocked' || t.value > 0)

  return (
    <section
      ref={ref}
      aria-labelledby="run-summary-title"
      className="qth-raised-md mt-4 flex flex-col gap-4 rounded-xl border border-[var(--border)] bg-[var(--tactile-surface-raised)] p-4"
    >
      <div>
        <h2 id="run-summary-title" className="text-base font-semibold">
          {stillOpen === 0 ? 'All test cases in this run have a result' : 'Your test cases in this run are done'}
        </h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          {run.name} · {run.cases.length} test case{run.cases.length === 1 ? '' : 's'}
          {othersRemaining > 0 &&
            ` · ${othersRemaining} assigned to other testers ${othersRemaining === 1 ? 'is' : 'are'} still open`}
        </p>
      </div>

      {/* Two across: the console's middle column is narrow even on a wide screen. */}
      <dl className="grid grid-cols-2 gap-2">
        {tiles.map((t) => {
          const Icon = SUMMARY_ICON[t.tone] ?? CircleDot
          return (
            <div
              key={t.label}
              className="qth-pressed-sm flex min-w-0 items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 py-2.5"
            >
              <dt className="flex min-w-0 items-center gap-1.5 text-sm text-[var(--muted-foreground)]">
                <Icon
                  className="size-4 shrink-0"
                  style={{ color: t.value > 0 ? SUMMARY_COLOR[t.tone] : undefined }}
                  aria-hidden="true"
                />
                <span className="truncate">{t.label}</span>
              </dt>
              <dd className="text-xl font-semibold tabular-nums">{t.value}</dd>
            </div>
          )
        })}
      </dl>

      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div className="flex gap-2">
          <dt className="text-[var(--muted-foreground)]">Execution time</dt>
          <dd className="font-medium tabular-nums" title={`${executedMs.toLocaleString()} ms`}>
            {formatDurationMs(executedMs)}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-[var(--muted-foreground)]">Defects raised</dt>
          <dd className="font-medium tabular-nums">{defectCount}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-[var(--muted-foreground)]">Run status</dt>
          <dd className="font-medium">{run.finished_at ? 'Finished' : run.paused_at ? 'Paused' : 'Active'}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-2 max-md:flex-col">
        <Link to={`/test-runs/${runId}`} className={cn(buttonVariants(), 'max-md:h-12 max-md:text-base')}>
          Back to the run
        </Link>
        <Link
          to={`/reporting?project=${projectId}`}
          className={cn(buttonVariants({ variant: 'outline' }), 'max-md:h-12 max-md:text-base')}
        >
          View report
        </Link>
      </div>
    </section>
  )
}
