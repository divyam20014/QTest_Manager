import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DateRangePicker } from '@/components/ui/date-range-picker'

describe('DateRangePicker', () => {
  it('offers the four presets as keyboard-reachable buttons', () => {
    render(<DateRangePicker idPrefix="r" fromValue="" toValue="" onChange={() => {}} />)
    for (const name of ['Last 7 days', 'Last 30 days', 'This month', 'Custom']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false')
    }
  })

  it('a preset emits a range; Custom focuses the From input', () => {
    const onChange = vi.fn()
    render(<DateRangePicker idPrefix="r" fromValue="" toValue="" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }))
    const iso = expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)
    expect(onChange).toHaveBeenCalledWith(iso, iso)
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }))
    expect(screen.getByLabelText('From')).toHaveFocus()
  })

  it('Custom is pressed for a non-preset range', () => {
    render(<DateRangePicker idPrefix="r" fromValue="2020-01-01" toValue="2020-01-05" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Custom' })).toHaveAttribute('aria-pressed', 'true')
  })
})
