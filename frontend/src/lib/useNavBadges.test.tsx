import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { BadgeCounts } from './navRegistry'
import { useBadgeAnnouncement } from './useNavBadges'

function run(initial: BadgeCounts, ready = true) {
  return renderHook(({ counts, ready: r }: { counts: BadgeCounts; ready: boolean }) => useBadgeAnnouncement(counts, r), {
    initialProps: { counts: initial, ready },
  })
}

describe('badge announcements', () => {
  it('is silent on the first load and while data is still loading', () => {
    const { result, rerender } = run({ defects: 0, myWork: 0 }, false)
    expect(result.current).toBe('')
    rerender({ counts: { defects: 3, myWork: 1 }, ready: true })
    expect(result.current).toBe('')
  })

  it('announces what changed after the first load, politely and only for the changed counts', () => {
    const { result, rerender } = run({ defects: 3, myWork: 1 })
    expect(result.current).toBe('')
    rerender({ counts: { defects: 4, myWork: 1 }, ready: true })
    expect(result.current).toBe('Defects: 4 open')
    rerender({ counts: { defects: 4, myWork: 0 }, ready: true })
    expect(result.current).toBe('My Work: 0 pending')
    rerender({ counts: { defects: 2, myWork: 2 }, ready: true })
    expect(result.current).toBe('Defects: 2 open. My Work: 2 pending')
  })

  it('keeps the last message when nothing changed', () => {
    const { result, rerender } = run({ defects: 1, myWork: 0 })
    rerender({ counts: { defects: 2, myWork: 0 }, ready: true })
    rerender({ counts: { defects: 2, myWork: 0 }, ready: true })
    expect(result.current).toBe('Defects: 2 open')
  })
})
