import { X } from 'lucide-react'
import { useId, useState, type ClipboardEvent, type KeyboardEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { addTags, splitTags, tagProblem, type TagLimits } from '@/lib/tags'

/**
 * Free-text multi-tag input (defect labels): type a tag and press Enter, comma or "Add"; paste a
 * list to add several at once. Tags are trimmed, lower-cased and de-duplicated; the limits (count
 * and length) are shown as a counter and enforced with an inline message. Each chip has a remove
 * button with its own accessible name. Controlled: the parent owns `value`.
 */
export function TagInput({
  id,
  label,
  value,
  onChange,
  limits,
  error,
  helper,
  disabled,
  placeholder = 'Add a label',
  noun = 'label',
}: {
  id: string
  label: string
  value: string[]
  onChange: (tags: string[]) => void
  limits: TagLimits
  error?: string
  helper?: string
  disabled?: boolean
  placeholder?: string
  /** Singular noun for button names, e.g. "label". */
  noun?: string
}) {
  const [text, setText] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const listId = useId()
  const atMax = value.length >= limits.max
  const shownError = error ?? problem ?? undefined
  const describedBy = [helper ? `${id}-helper` : null, shownError ? `${id}-error` : null, `${id}-count`].filter(Boolean).join(' ')

  function commit(raw: string) {
    const candidates = splitTags(raw)
    if (candidates.length === 0) {
      setProblem(tagProblem(raw, value, limits))
      return
    }
    const result = addTags(value, candidates, limits)
    if (result.tags !== value) onChange(result.tags)
    setProblem(result.problem)
    // Keep what could not be added (so the user can fix it); clear the box when everything went in.
    if (!result.problem) setText('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (text.trim()) commit(text)
    } else if (e.key === 'Backspace' && !text && value.length > 0) {
      onChange(value.slice(0, -1))
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text')
    if (splitTags(pasted).length < 2) return
    e.preventDefault()
    commit(pasted)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <span id={`${id}-count`} className="text-xs tabular-nums text-[var(--muted-foreground)]">
          {value.length} of {limits.max}, up to {limits.maxLength} characters each
        </span>
      </div>
      {value.length > 0 && (
        <ul id={listId} aria-label={`${label} added`} className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <li
              key={tag}
              className="inline-flex max-w-full items-center gap-1 rounded-full bg-[var(--muted)] py-0.5 pl-2.5 pr-1 text-xs"
            >
              <span className="min-w-0 break-all">{tag}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(value.filter((t) => t !== tag))}
                aria-label={`Remove ${noun} ${tag}`}
                className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[var(--muted-foreground)] hover:bg-[var(--border)] hover:text-[var(--foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ring)] max-md:size-8"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          id={id}
          value={text}
          disabled={disabled || atMax}
          placeholder={atMax ? `Maximum of ${limits.max} reached` : placeholder}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={describedBy || undefined}
          onChange={(e) => {
            setText(e.target.value)
            if (problem) setProblem(null)
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        <Button type="button" variant="outline" disabled={disabled || atMax || !text.trim()} onClick={() => commit(text)}>
          Add
        </Button>
      </div>
      {helper && (
        <p id={`${id}-helper`} className="text-xs text-[var(--muted-foreground)]">
          {helper}
        </p>
      )}
      {shownError && (
        <p id={`${id}-error`} role="alert" className="text-xs text-[var(--destructive)]">
          {shownError}
        </p>
      )}
    </div>
  )
}
