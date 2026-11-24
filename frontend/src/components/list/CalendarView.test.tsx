import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let mobile = false
vi.mock('@/lib/useMediaQuery', () => ({ useIsMobile: () => mobile }))

import { CalendarView, type CalendarEvent } from './CalendarView'

const events: CalendarEvent[] = [
  { id: 'a', date: '2026-11-10', kind: 'due', label: '2 due: Smoke', detail: 'Alpha', href: '/test-runs/r1', tone: 'critical' },
  { id: 'b', date: '2026-11-10', kind: 'run', label: 'Started: Smoke', href: '/test-runs/r1', tone: 'positive' },
  { id: 'c', date: '2026-11-10', kind: 'release', label: 'R1', href: '/projects/p/releases', tone: 'info' },
  { id: 'd', date: '2026-11-20', kind: 'release', label: 'R2', href: '/projects/p/releases', tone: 'info' },
]

function renderCalendar(onMonthChange = vi.fn(), over: Partial<React.ComponentProps<typeof CalendarView>> = {}) {
  render(
    <MemoryRouter>
      <CalendarView label="Test run calendar" month="2026-11" onMonthChange={onMonthChange} today="2026-11-10" events={events} loading={false} {...over} />
    </MemoryRouter>,
  )
  return onMonthChange
}

beforeEach(() => {
  mobile = false
})

describe('CalendarView', () => {
  it('shows a month grid, today selected, and the agenda of the selected day with links to the records', () => {
    renderCalendar()
    expect(screen.getByTestId('calendar-month')).toHaveTextContent('November 2026')
    expect(screen.getByRole('grid')).toBeInTheDocument()
    const agenda = screen.getByRole('region', { name: /Agenda for/ })
    expect(within(agenda).getByRole('link', { name: /Cases due: 2 due: Smoke/ })).toHaveAttribute('href', '/test-runs/r1')
    expect(within(agenda).getByRole('link', { name: /Release: R1/ })).toHaveAttribute('href', '/projects/p/releases')
    expect(screen.getByText('+1 more')).toBeInTheDocument()
  })

  it('moves by day and week with the arrow keys and across the month edge', () => {
    const onMonthChange = renderCalendar()
    const today = screen.getByRole('button', { name: /Tuesday, 10 November 2026, today/ })
    today.focus()
    fireEvent.keyDown(today, { key: 'ArrowRight' })
    expect(screen.getByRole('button', { name: /Wednesday, 11 November 2026/ })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('button', { name: /Wednesday, 11 November 2026/ }), { key: 'ArrowDown' })
    expect(screen.getByRole('button', { name: /Wednesday, 18 November 2026/ })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('button', { name: /Wednesday, 18 November 2026/ }), { key: 'PageDown' })
    expect(onMonthChange).toHaveBeenCalledWith('2026-12')
  })

  it('navigates months with the buttons', () => {
    const onMonthChange = renderCalendar()
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(onMonthChange).toHaveBeenCalledWith('2026-12')
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(onMonthChange).toHaveBeenCalledWith('2026-10')
  })

  it('shows an agenda list instead of the grid on a phone', () => {
    mobile = true
    renderCalendar()
    expect(screen.queryByRole('grid')).toBeNull()
    expect(screen.getByRole('region', { name: /10 November 2026/ })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /20 November 2026/ })).toBeInTheDocument()
  })

  it('says so when the month is empty, and offers retry on an error', () => {
    mobile = true
    renderCalendar(vi.fn(), { events: [] })
    expect(screen.getByText('Nothing is scheduled in November 2026.')).toBeInTheDocument()
    const retry = vi.fn()
    renderCalendar(vi.fn(), { error: true, onRetry: retry })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalled()
  })
})
