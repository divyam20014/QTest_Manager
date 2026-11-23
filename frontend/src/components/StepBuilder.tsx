import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2, XCircle } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'

import { IconButton } from '@/components/ui/icon-button'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  MAX_STEPS,
  STEP_FIELD_SETS,
  addStep,
  moveStep,
  pasteLines,
  removeStep,
  restoreStep,
  stepNumber,
  updateStep,
  validateSteps,
  type BuilderStep,
  type StepErrors,
  type StepFieldSetName,
} from '@/lib/stepBuilder'
import { useToast } from '@/lib/toast'
import { cn } from '@/lib/utils'

/**
 * Dynamic Step Builder (test case steps now, defect reproduction steps later --
 * `fields` picks the field set). Each row has an automatic step number, an Action,
 * an optional Test Data and an Expected Result; rows can be added, edited in
 * place, removed (with an Undo toast), and reordered by dragging the handle OR with
 * the Move up / Move down buttons (the keyboard / touch alternative to dragging,
 * WCAG 2.5.7). Numbers are the row position, so every change renumbers. Pasting
 * several lines into an Action creates a step per line. At most MAX_STEPS rows.
 *
 * Controlled: the parent owns `steps`. Errors show for a field after it was left
 * (blur) or once `showErrors` is set (a submit attempt); `serverErrors` are the
 * API's per-row messages and show immediately.
 */
export function StepBuilder({
  steps,
  onChange,
  fields = 'testcase',
  showErrors = false,
  serverErrors,
  disabled,
  label = 'Steps',
  max = MAX_STEPS,
  idPrefix = 'step',
}: {
  steps: BuilderStep[]
  onChange: (steps: BuilderStep[]) => void
  fields?: StepFieldSetName
  showErrors?: boolean
  serverErrors?: Record<number, StepErrors>
  disabled?: boolean
  label?: string
  max?: number
  idPrefix?: string
}) {
  const set = STEP_FIELD_SETS[fields]
  const { show } = useToast()
  const liveId = useId()
  const stepsRef = useRef(steps)
  useEffect(() => {
    stepsRef.current = steps
  })
  const [touched, setTouched] = useState<Record<string, true>>({})
  const [announce, setAnnounce] = useState('')
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [overKey, setOverKey] = useState<string | null>(null)
  const focusRef = useRef<{ key: string; target: 'action' | 'up' | 'down' | 'handle' } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const errors = validateSteps(steps, set)

  // Moves focus after a row was added / moved (the DOM node may have been re-inserted).
  useEffect(() => {
    const want = focusRef.current
    if (!want) return
    focusRef.current = null
    const row = rootRef.current?.querySelector<HTMLElement>(`[data-step-key="${want.key}"]`)
    if (!row) return
    const selector = want.target === 'action' ? '[data-field="action"]' : `[data-move="${want.target}"]`
    const el = row.querySelector<HTMLElement>(selector)
    if (el && !(el as HTMLButtonElement).disabled) el.focus()
    else row.querySelector<HTMLElement>('[data-field="action"]')?.focus()
  }, [steps])

  function markTouched(key: string, field: 'action' | 'expected') {
    setTouched((t) => (t[`${key}:${field}`] ? t : { ...t, [`${key}:${field}`]: true }))
  }

  function shown(index: number, key: string, field: 'action' | 'expected'): string | undefined {
    const server = serverErrors?.[index]?.[field]
    if (server) return server
    if (!showErrors && !touched[`${key}:${field}`]) return undefined
    return errors[index]?.[field]
  }

  function move(from: number, to: number, focus?: 'up' | 'down' | 'handle') {
    const next = moveStep(steps, from, to)
    if (next === steps) return
    onChange(next)
    const landed = Math.min(Math.max(to, 0), steps.length - 1)
    if (focus) focusRef.current = { key: steps[from].key, target: focus }
    setAnnounce(`Step moved to position ${stepNumber(landed)} of ${steps.length}`)
  }

  function remove(index: number) {
    const result = removeStep(steps, index, set.minSteps)
    if (!result.removed) return
    const removed = result.removed
    onChange(result.steps)
    setAnnounce(`Step ${stepNumber(index)} removed`)
    show('info', `Step ${stepNumber(index)} removed`, {
      action: {
        label: 'Undo',
        onClick: () => onChange(restoreStep(stepsRef.current, removed, result.index, max)),
      },
    })
  }

  function add(afterIndex?: number) {
    const next = addStep(steps, afterIndex, max)
    if (next === steps) return
    const at = afterIndex === undefined ? next.length - 1 : afterIndex + 1
    focusRef.current = { key: next[at].key, target: 'action' }
    onChange(next)
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>, index: number) {
    const text = e.clipboardData.getData('text')
    const next = pasteLines(steps, index, text, max)
    if (!next) return
    e.preventDefault()
    onChange(next)
    setAnnounce(`${next.length - steps.length + (steps[index].action.trim() ? 0 : 1)} steps pasted`)
  }

  function onHandleKey(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(index, index - 1, 'handle')
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      move(index, index + 1, 'handle')
    }
  }

  function onDragStart(e: DragEvent<HTMLButtonElement>, step: BuilderStep) {
    setDragKey(step.key)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', step.key)
    const row = (e.currentTarget as HTMLElement).closest('[data-step-key]')
    if (row) e.dataTransfer.setDragImage(row, 16, 16)
  }

  function onDrop(e: DragEvent<HTMLLIElement>, toIndex: number) {
    e.preventDefault()
    const from = steps.findIndex((s) => s.key === dragKey)
    setDragKey(null)
    setOverKey(null)
    if (from >= 0) move(from, toIndex)
  }

  const atMax = steps.length >= max
  const canRemove = steps.length > set.minSteps

  return (
    <div ref={rootRef} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label required={set.stepsRequired}>{label}</Label>
        <span className="text-xs text-[var(--muted-foreground)]" aria-live="off">
          {steps.length} of {max} steps
        </span>
      </div>
      <p id={`${liveId}-hint`} className="text-xs text-[var(--muted-foreground)]">
        Drag a handle, or use the Move up / Move down buttons, to reorder. Paste several lines into
        {' '}{set.actionLabel} to create one step per line.
      </p>
      <span id={liveId} role="status" aria-live="polite" className="sr-only">
        {announce}
      </span>
      <ol className="flex flex-col gap-2" aria-label={label} aria-describedby={`${liveId}-hint`}>
        {steps.map((step, index) => {
          const n = stepNumber(index)
          const actionError = shown(index, step.key, 'action')
          const expectedError = shown(index, step.key, 'expected')
          const base = `${idPrefix}-${step.key}`
          return (
            <li
              key={step.key}
              data-step-key={step.key}
              onDragOver={(e) => {
                if (!dragKey) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (overKey !== step.key) setOverKey(step.key)
              }}
              onDrop={(e) => onDrop(e, index)}
              className={cn(
                'flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3',
                dragKey === step.key && 'opacity-50',
                overKey === step.key && dragKey !== step.key && 'border-[var(--primary)] ring-1 ring-[var(--primary)]',
              )}
            >
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  draggable={!disabled}
                  disabled={disabled}
                  data-move="handle"
                  aria-label={`Reorder step ${n}. Drag, or press Arrow Up or Arrow Down to move.`}
                  onKeyDown={(e) => onHandleKey(e, index)}
                  onDragStart={(e) => onDragStart(e, step)}
                  onDragEnd={() => {
                    setDragKey(null)
                    setOverKey(null)
                  }}
                  className="inline-flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] active:cursor-grabbing disabled:opacity-50 max-md:size-11"
                >
                  <GripVertical className="size-4" aria-hidden="true" />
                </button>
                <span className="text-sm font-semibold tabular-nums">Step {n}</span>
                {step.failed && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--status-serious-bg)] px-2 py-0.5 text-xs font-medium text-[var(--status-serious)]">
                    <XCircle className="size-3" aria-hidden="true" />
                    Failed here
                  </span>
                )}
                <div className="ml-auto flex items-center gap-0.5">
                  <IconButton
                    size="sm"
                    data-move="up"
                    aria-label={`Move step ${n} up`}
                    disabled={disabled || index === 0}
                    onClick={() => move(index, index - 1, 'up')}
                  >
                    <ArrowUp aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    size="sm"
                    data-move="down"
                    aria-label={`Move step ${n} down`}
                    disabled={disabled || index === steps.length - 1}
                    onClick={() => move(index, index + 1, 'down')}
                  >
                    <ArrowDown aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    size="sm"
                    aria-label={`Remove step ${n}`}
                    disabled={disabled || !canRemove}
                    onClick={() => remove(index)}
                    className="hover:text-[var(--destructive)]"
                  >
                    <Trash2 aria-hidden="true" />
                  </IconButton>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor={`${base}-action`} required className="text-xs">
                  {set.actionLabel}
                </Label>
                <Textarea
                  id={`${base}-action`}
                  data-field="action"
                  rows={2}
                  className="min-h-14"
                  disabled={disabled}
                  placeholder={set.actionPlaceholder}
                  value={step.action}
                  aria-invalid={actionError ? true : undefined}
                  aria-describedby={actionError ? `${base}-action-error` : undefined}
                  onChange={(e) => onChange(updateStep(steps, index, { action: e.target.value }))}
                  onBlur={() => markTouched(step.key, 'action')}
                  onPaste={(e) => onPaste(e, index)}
                />
                {actionError && (
                  <p id={`${base}-action-error`} role="alert" className="text-xs text-[var(--destructive)]">
                    Step {n}: {actionError}
                  </p>
                )}
              </div>

              <div className={cn('grid grid-cols-1 gap-2', set.testData && set.expected && 'md:grid-cols-2')}>
                {set.testData && (
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`${base}-data`} className="text-xs">
                      Test data <span className="font-normal text-[var(--muted-foreground)]">(optional)</span>
                    </Label>
                    <Input
                      id={`${base}-data`}
                      disabled={disabled}
                      value={step.test_data}
                      onChange={(e) => onChange(updateStep(steps, index, { test_data: e.target.value }))}
                    />
                  </div>
                )}
                {set.expected && (
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`${base}-expected`} required={set.expectedRequired} className="text-xs">
                      Expected result
                    </Label>
                    <Textarea
                      id={`${base}-expected`}
                      data-field="expected"
                      rows={2}
                      className="min-h-14"
                      disabled={disabled}
                      value={step.expected}
                      aria-invalid={expectedError ? true : undefined}
                      aria-describedby={expectedError ? `${base}-expected-error` : undefined}
                      onChange={(e) => onChange(updateStep(steps, index, { expected: e.target.value }))}
                      onBlur={() => markTouched(step.key, 'expected')}
                    />
                    {expectedError && (
                      <p id={`${base}-expected-error`} role="alert" className="text-xs text-[var(--destructive)]">
                        Step {n}: {expectedError}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={disabled || atMax} onClick={() => add()}>
          <Plus className="size-4" aria-hidden="true" /> Add step
        </Button>
        {atMax && <span className="text-xs text-[var(--muted-foreground)]">Maximum of {max} steps reached.</span>}
      </div>
    </div>
  )
}
