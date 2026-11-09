import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useSearchParams } from 'react-router-dom'

import { listDefects } from '@/api/defects'
import { listRunCaseSteps, openStep, recordVerdict, type ExecutionStep, type Verdict } from '@/api/execution'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DefectQuickCreateDialog } from './DefectQuickCreateDialog'

const VERDICT_TONE = { pass: 'positive', fail: 'critical', ignore: 'neutral' } as const

export function ExecutionConsole() {
  const { runCaseId } = useParams<{ runCaseId: string }>()
  const [searchParams] = useSearchParams()
  const runId = searchParams.get('runId')
  const queryClient = useQueryClient()
  const [defectStepId, setDefectStepId] = useState<string | null>(null)

  const stepsQuery = useQuery({
    queryKey: ['execution-steps', runCaseId],
    queryFn: () => listRunCaseSteps(runCaseId!),
    enabled: !!runCaseId,
  })

  // GAP-20: one batched call per run to find out which steps already have
  // a defect reported, instead of a per-step lookup.
  const runDefectsQuery = useQuery({
    queryKey: ['defects', 'by-run', runId],
    queryFn: () => listDefects({ test_run_id: runId! }),
    enabled: !!runId,
  })
  const reportedStepIds = new Set((runDefectsQuery.data ?? []).map((d) => d.test_case_version_step_id))

  const steps = stepsQuery.data ?? []
  const currentStep = steps.find((s) => s.verdict === null) ?? null

  const openMutation = useMutation({ mutationFn: (stepId: string) => openStep(stepId) })

  // Start the server-side timer for the current step as soon as it becomes
  // current (FR-EXEC-002's "stop-clock" timer), not only when a verdict is
  // finally submitted.
  useEffect(() => {
    if (currentStep && currentStep.opened_at === null && !openMutation.isPending) {
      openMutation.mutate(currentStep.id, {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['execution-steps', runCaseId] }),
      })
    }
    // Deliberately scoped to currentStep?.id only: we want this to fire
    // once when the "current" step changes, not on every mutation-state
    // tick while opening is pending.
  }, [currentStep?.id])

  const verdictMutation = useMutation({
    mutationFn: ({ stepId, verdict }: { stepId: string; verdict: Verdict }) => recordVerdict(stepId, verdict),
    onSuccess: (updatedStep) => {
      queryClient.invalidateQueries({ queryKey: ['execution-steps', runCaseId] })
      queryClient.invalidateQueries({ queryKey: ['test-runs'] })
      if (updatedStep.verdict === 'fail') {
        setDefectStepId(updatedStep.id)
      }
    },
  })

  function handleDefectDialogClose() {
    setDefectStepId(null)
    queryClient.invalidateQueries({ queryKey: ['defects', 'by-run', runId] })
  }

  if (stepsQuery.isLoading) return <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>

  const answeredCount = steps.filter((s) => s.verdict !== null).length
  const progressPercent = steps.length ? Math.round((answeredCount / steps.length) * 100) : 0

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Execution Console</h1>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--muted)]">
          <div className="h-full bg-[var(--primary)] transition-all" style={{ width: `${progressPercent}%` }} />
        </div>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          {answeredCount}/{steps.length} steps complete
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {steps.map((step) => (
          <StepCard
            key={step.id}
            step={step}
            isCurrent={currentStep?.id === step.id}
            hasDefect={reportedStepIds.has(step.test_case_version_step_id)}
            onVerdict={(verdict) => verdictMutation.mutate({ stepId: step.id, verdict })}
            isSubmitting={verdictMutation.isPending}
          />
        ))}
      </div>

      <DefectQuickCreateDialog open={defectStepId !== null} onClose={handleDefectDialogClose} executionStepId={defectStepId} />
    </div>
  )
}

function StepCard({
  step,
  isCurrent,
  hasDefect,
  onVerdict,
  isSubmitting,
}: {
  step: ExecutionStep
  isCurrent: boolean
  hasDefect: boolean
  onVerdict: (verdict: Verdict) => void
  isSubmitting: boolean
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

      {isCurrent && (
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={() => onVerdict('pass')} disabled={isSubmitting} className="bg-emerald-600 hover:opacity-90">
            Pass
          </Button>
          <Button size="sm" variant="destructive" onClick={() => onVerdict('fail')} disabled={isSubmitting}>
            Fail
          </Button>
          <Button size="sm" variant="outline" onClick={() => onVerdict('ignore')} disabled={isSubmitting}>
            Ignore
          </Button>
        </div>
      )}

      {/* BRD Journey 4: after a fix, a previously-verdicted step (most
       * often a Fail) can be re-run and re-verdicted within the same test
       * run -- the backend already supports this (ADR-024 recomputes the
       * case rollup from scratch from current verdicts), so the console
       * must offer it, not just the one-shot "current step" flow above. */}
      {!isCurrent && step.verdict && <ReverdictControl onVerdict={onVerdict} isSubmitting={isSubmitting} />}
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
