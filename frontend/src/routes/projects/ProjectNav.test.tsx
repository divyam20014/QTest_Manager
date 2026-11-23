import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import type { ResolvedTab } from '@/lib/projectNav'

import { ProjectNav } from './ProjectNav'

const TABS: ResolvedTab[] = [
  { key: 'overview', label: 'Overview', to: '/projects/p1' },
  { key: 'test-cases', label: 'Test Cases', to: '/projects/p1/test-cases' },
  { key: 'defects', label: 'Defects', to: '/defects?projectId=p1' },
]

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname + l.search}</p>
}

function setup(activeKey: ResolvedTab['key'] | null, counts = {}) {
  return render(
    <MemoryRouter initialEntries={['/projects/p1']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <ProjectNav tabs={TABS} activeKey={activeKey} counts={counts} />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ProjectNav', () => {
  it('is a labelled navigation of links with aria-current on the active tab only', () => {
    setup('test-cases')
    const nav = screen.getByRole('navigation', { name: 'Project sections' })
    const links = screen.getAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual(['Overview', 'Test Cases', 'Defects'])
    expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Test Cases' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByTestId('project-tabs-more')).toBeNull()
  })

  it('keeps counts out of the accessible name', () => {
    setup('overview', { 'test-cases': { value: 12 }, defects: { value: 3 } })
    expect(screen.getByRole('link', { name: 'Test Cases' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Defects' })).toBeInTheDocument()
    expect(screen.getAllByText('12')[0]).toHaveAttribute('aria-hidden', 'true')
  })

  it('navigates when a tab is chosen', async () => {
    setup('overview')
    await userEvent.click(screen.getByRole('link', { name: 'Defects' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/defects?projectId=p1')
  })

  it('marks no tab current on a page outside the tabs', () => {
    setup(null)
    expect(screen.getByRole('navigation', { name: 'Project sections' }).querySelector('[aria-current]')).toBeNull()
  })
})
