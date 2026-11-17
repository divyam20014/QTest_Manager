import { describe, expect, it } from 'vitest'

import { describeClock, formatClock, formatDurationMs } from './duration'

describe('duration formatting', () => {
  it('formats a stop-clock as MM:SS, growing to H:MM:SS', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(5)).toBe('00:05')
    expect(formatClock(125)).toBe('02:05')
    expect(formatClock(3599)).toBe('59:59')
    expect(formatClock(3600)).toBe('1:00:00')
    expect(formatClock(-3)).toBe('00:00')
  })

  it('keeps millisecond precision below one second', () => {
    expect(formatDurationMs(250)).toBe('250 ms')
    expect(formatDurationMs(12_345)).toBe('00:12')
  })

  it('describes the clock in words for screen readers', () => {
    expect(describeClock(1)).toBe('1 second')
    expect(describeClock(125)).toBe('2 minutes 5 seconds')
    expect(describeClock(3661)).toBe('1 hour 1 minute 1 second')
  })
})
