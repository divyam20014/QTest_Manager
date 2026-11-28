import { ArrowUp, X } from 'lucide-react'
import { useRef } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { MAX_CRITERIA } from '@/lib/requirements'

/** ADR-149: an ordered list of ways to tell the requirement is met. */
export function CriteriaEditor({ value, onChange, error }: { value: string[]; onChange: (next: string[]) => void; error?: string }) {
  const list = useRef<HTMLOListElement>(null)
  const focusRow = (index: number) =>
    requestAnimationFrame(() => list.current?.querySelectorAll('textarea')[index]?.focus())

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-xs font-medium text-[var(--muted-foreground)]">Acceptance criteria</legend>
      {value.length > 0 && (
        <ol ref={list} className="flex flex-col gap-2">
          {value.map((text, index) => (
            // Rows have no identity beyond their place; every input is controlled.
            <li key={index} className="flex items-start gap-1">
              <span className="w-6 shrink-0 pt-2 text-right tabular-nums text-[var(--muted-foreground)]">{index + 1}.</span>
              <Textarea
                aria-label={`Acceptance criterion ${index + 1}`}
                rows={2}
                maxLength={2000}
                className="min-w-0 flex-1"
                value={text}
                onChange={(e) => onChange(value.map((v, i) => (i === index ? e.target.value : v)))}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="px-2 max-md:min-h-11 max-md:min-w-11"
                aria-label={`Move criterion ${index + 1} up`}
                disabled={index === 0}
                onClick={() => {
                  const next = [...value]
                  ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                  onChange(next)
                }}
              >
                <ArrowUp className="size-4" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="px-2 max-md:min-h-11 max-md:min-w-11"
                aria-label={`Remove criterion ${index + 1}`}
                onClick={() => onChange(value.filter((_, i) => i !== index))}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ol>
      )}
      {error && (
        <p role="alert" className="text-xs text-[var(--status-serious)]">
          {error}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        disabled={value.length >= MAX_CRITERIA}
        onClick={() => {
          onChange([...value, ''])
          focusRow(value.length)
        }}
      >
        Add criterion
      </Button>
    </fieldset>
  )
}
