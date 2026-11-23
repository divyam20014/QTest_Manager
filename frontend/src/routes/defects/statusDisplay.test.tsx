import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DEFECT_STATUSES } from '@/lib/defectWorkflow'
import { DefectStatusBadge } from './DefectStatusBadge'
import { STATUS_DISPLAY, STATUS_TONE, statusDisplay } from './statusDisplay'

describe('defect status tones and pills', () => {
  it('every one of the eleven statuses has a tone and an icon', () => {
    expect(DEFECT_STATUSES).toHaveLength(11)
    for (const status of DEFECT_STATUSES) {
      expect(STATUS_DISPLAY[status], status).toBeDefined()
      expect(STATUS_TONE[status], status).toBe(STATUS_DISPLAY[status].tone)
    }
  })

  it('a reopened defect reads as critical, a finished one as neutral, a verified one as positive', () => {
    expect(STATUS_TONE.Reopened).toBe('critical')
    expect(STATUS_TONE.Closed).toBe('neutral')
    expect(STATUS_TONE.Rejected).toBe('neutral')
    expect(STATUS_TONE.Deferred).toBe('neutral')
    expect(STATUS_TONE.Verified).toBe('positive')
  })

  it('statuses that share a tone still differ by icon, so colour is never the only signal', () => {
    const seen = new Map<string, string>()
    for (const status of DEFECT_STATUSES) {
      const icon = STATUS_DISPLAY[status].Icon
      const name = (icon as unknown as { displayName?: string }).displayName ?? String(status)
      const key = `${STATUS_DISPLAY[status].tone}:${name}`
      expect(seen.has(key), `${status} duplicates the tone and icon of ${seen.get(key)}`).toBe(false)
      seen.set(key, status)
    }
  })

  it('an unknown status code falls back to a neutral pill', () => {
    expect(statusDisplay('Escalated').tone).toBe('neutral')
  })

  it('the pill shows the label with a decorative icon', () => {
    const { container } = render(<DefectStatusBadge status="Retest" label="Ready to retest" />)
    expect(screen.getByText('Ready to retest')).toBeInTheDocument()
    const icon = container.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
  })

  it('defaults the label to the status code', () => {
    render(<DefectStatusBadge status="In Progress" />)
    expect(screen.getByText('In Progress')).toBeInTheDocument()
  })
})
