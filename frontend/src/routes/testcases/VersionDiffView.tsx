import { Minus, Pencil, Plus } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import type { StepDiff, VersionCompare } from '@/api/testCases'
import { countStepChanges, diffWords, summarizeCompare } from '@/lib/versionDiff'

// ADR-096: per-field and per-step version compare. Change is never shown by
// colour alone: every step carries an icon and a text label, and every
// highlighted word is an <ins>/<del> (underline / strikethrough) with hidden
// "added:" / "removed:" text for screen readers.

function WordDiff({ before, after }: { before?: string | null; after?: string | null }) {
  const segments = diffWords(before, after)
  if (segments.length === 0) return <span className="text-[var(--muted-foreground)]">(empty)</span>
  return (
    <span className="break-words">
      {segments.map((seg, i) => {
        if (seg.op === 'same') return <span key={i}>{seg.text}</span>
        if (seg.op === 'add') {
          return (
            <ins
              key={i}
              className="rounded-sm bg-[color-mix(in_srgb,var(--status-good)_22%,transparent)] px-0.5 underline decoration-[var(--status-good)] decoration-2 underline-offset-2"
            >
              <span className="sr-only">added: </span>
              {seg.text}
            </ins>
          )
        }
        return (
          <del
            key={i}
            className="rounded-sm bg-[color-mix(in_srgb,var(--status-serious)_22%,transparent)] px-0.5 line-through decoration-[var(--status-serious)] decoration-2"
          >
            <span className="sr-only">removed: </span>
            {seg.text}
          </del>
        )
      })}
    </span>
  )
}

const STEP_LABEL: Record<StepDiff['change'], { text: string; icon: ReactNode; aria: string } | null> = {
  added: { text: 'Added', icon: <Plus className="size-3.5" aria-hidden="true" />, aria: 'Step added' },
  removed: { text: 'Removed', icon: <Minus className="size-3.5" aria-hidden="true" />, aria: 'Step removed' },
  modified: { text: 'Changed', icon: <Pencil className="size-3.5" aria-hidden="true" />, aria: 'Step changed' },
  unchanged: null,
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[var(--muted-foreground)]">{label}</span>
      <div>{children}</div>
    </div>
  )
}

function StepCard({ step }: { step: StepDiff }) {
  const label = STEP_LABEL[step.change]
  const actionChanged = step.old_action !== step.new_action
  const expectedChanged = step.old_expected !== step.new_expected
  return (
    <li
      data-testid="version-diff-step"
      data-change={step.change}
      className="flex flex-col gap-1.5 rounded-md border border-[var(--border)] p-2"
    >
      <div className="flex items-center gap-2 font-medium">
        <span>Step {step.step_number}</span>
        {label ? (
          <span
            aria-label={label.aria}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--muted)] px-2 py-0.5 text-xs"
          >
            {label.icon}
            {label.text}
          </span>
        ) : (
          <span className="text-xs font-normal text-[var(--muted-foreground)]">Unchanged</span>
        )}
      </div>
      <FieldRow label="Action">
        {step.change === 'unchanged' || !actionChanged ? (
          (step.new_action ?? step.old_action)
        ) : (
          <WordDiff before={step.old_action} after={step.new_action} />
        )}
      </FieldRow>
      <FieldRow label="Expected result">
        {step.change === 'unchanged' || !expectedChanged ? (
          (step.new_expected ?? step.old_expected)
        ) : (
          <WordDiff before={step.old_expected} after={step.new_expected} />
        )}
      </FieldRow>
    </li>
  )
}

export function VersionDiffView({ compare }: { compare: VersionCompare }) {
  const [showUnchanged, setShowUnchanged] = useState(false)
  const counts = countStepChanges(compare.steps)
  const visible = compare.steps.filter((s) => showUnchanged || s.change !== 'unchanged')

  return (
    <div className="mt-3 flex flex-col gap-3 text-xs" data-testid="version-diff">
      <p role="status" className="text-sm font-medium" data-testid="version-diff-summary">
        {summarizeCompare(compare)}
      </p>

      {compare.title_changed && (
        <FieldRow label="Title (changed)">
          <WordDiff before={compare.old_title} after={compare.new_title} />
        </FieldRow>
      )}
      {compare.description_changed && (
        <FieldRow label="Description (changed)">
          <WordDiff before={compare.old_description} after={compare.new_description} />
        </FieldRow>
      )}

      {visible.length > 0 && (
        <ul className="flex flex-col gap-2">
          {visible.map((s) => (
            <StepCard key={`${s.step_number}-${s.change}`} step={s} />
          ))}
        </ul>
      )}

      {counts.unchanged > 0 && (
        <button
          type="button"
          onClick={() => setShowUnchanged((v) => !v)}
          aria-expanded={showUnchanged}
          className="self-start rounded-md border border-[var(--border)] px-3 py-1.5 text-xs hover:bg-[var(--muted)] max-md:min-h-11"
        >
          {showUnchanged ? 'Hide' : 'Show'} {counts.unchanged} unchanged {counts.unchanged === 1 ? 'step' : 'steps'}
        </button>
      )}
    </div>
  )
}
