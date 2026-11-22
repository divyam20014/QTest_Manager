import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { MeResponse } from '@/api/auth'
import { ReportTabs } from './ReportTabs'

let permissions: string[] = []
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { permissions } as MeResponse }) }))

function tabNames() {
  render(
    <MemoryRouter initialEntries={['/reporting']}>
      <ReportTabs />
    </MemoryRouter>,
  )
  return screen.getAllByRole('link').map((l) => l.textContent)
}

describe('ReportTabs', () => {
  it('shows Overview and Report builder without the compliance permission', () => {
    permissions = []
    expect(tabNames()).toEqual(['Overview', 'Report builder'])
  })

  it('adds Compliance for roles that can export it', () => {
    permissions = ['report.compliance_export']
    expect(tabNames()).toEqual(['Overview', 'Compliance', 'Report builder'])
  })
})
