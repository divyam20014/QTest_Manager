import { describe, expect, it } from 'vitest'

import { formatRuleInstant, fromLocalInputValue, toLocalInputValue } from '@/lib/accessRuleTime'

describe('access rule time helpers', () => {
  it('formats an instant with a timezone label and the UTC time', () => {
    const text = formatRuleInstant('2026-12-01T09:30:00Z')
    expect(text).toMatch(/2026/)
    expect(text).toMatch(/UTC|GMT|[A-Z]{2,5}/)
  })

  it('returns the input for an unparseable instant', () => {
    expect(formatRuleInstant('nope')).toBe('nope')
  })

  it('round-trips a datetime-local value through a UTC instant', () => {
    const local = '2026-12-01T09:30'
    const iso = fromLocalInputValue(local)
    expect(iso).not.toBeNull()
    expect(toLocalInputValue(iso)).toBe(local)
    expect(fromLocalInputValue('')).toBeNull()
    expect(toLocalInputValue(null)).toBe('')
  })
})
