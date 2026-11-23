import { useState } from 'react'

import { Input } from '@/components/ui/input'

/**
 * A free-text filter that applies on Enter or when the field is left, not per keystroke (the
 * environment of a test case, the fix version or labels of a defect). Re-key it on `value` so an
 * outside change (a chip removed, a view applied) replaces what is typed.
 */
export function CommitTextFilter({
  id,
  label,
  value,
  onCommit,
  placeholder,
}: {
  id: string
  label: string
  value: string
  onCommit: (value: string) => void
  placeholder?: string
}) {
  const [text, setText] = useState(value)
  return (
    <Input
      id={id}
      aria-label={label}
      placeholder={placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onCommit(text.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onCommit(text.trim())
        }
      }}
    />
  )
}
