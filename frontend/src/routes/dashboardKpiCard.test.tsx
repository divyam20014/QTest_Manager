import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { countTrend } from '@/routes/dashboardKpi'
import { KpiCard } from '@/routes/dashboardKpiCard'

describe('KpiCard', () => {
  it('is one link to the target whose name carries label, value and trend', () => {
    render(
      <MemoryRouter>
        <KpiCard label="Open defects" value="7" trend={countTrend(7, 10, 30, false)} href="/defects" />
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: 'Open defects: 7. down 30% vs 30d ago' })
    expect(link).toHaveAttribute('href', '/defects')
    expect(screen.getByTestId('kpi-card').className).toContain('qth-card-interactive')
    // Trend is text with an arrow, not colour alone.
    expect(screen.getByTestId('kpi-card').textContent).toContain('▼ 30% vs 30d ago')
  })
  it('shows a neutral "No trend yet" without a baseline', () => {
    render(
      <MemoryRouter>
        <KpiCard label="Test cases" value="3" trend={countTrend(3, undefined, 30, true)} href="/test-repository" />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Test cases: 3. No trend yet' })).toBeInTheDocument()
  })
})
