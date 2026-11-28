import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RequirementsView } from './RequirementsView'

const listRequirements = vi.fn()
vi.mock('@/api/requirements', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/requirements')>()),
  listRequirements: (...a: unknown[]) => listRequirements(...a),
}))
vi.mock('@/api/fieldCustomization', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/fieldCustomization')>()),
  listFieldOptions: () => Promise.resolve([]),
}))
vi.mock('@/api/projects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/projects')>()),
  listProjectMembers: () => Promise.resolve([]),
}))

const ROW = {
  id: 'r1',
  display_id: 'REQ_000007',
  title: 'Claims are validated',
  status: 'approved',
  requirement_type: 'Functional',
  priority: 'High',
  owner_name: 'Asha',
  task_id: 't1',
  task_display_id: 'TASK_000001',
  linked_test_case_count: 2,
  review_count: 1,
}

let location = ''
function Spy() {
  location = useLocation().search
  return null
}

function setup(path = '/projects/p1/tasks?view=requirements', canImport = false) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <RequirementsView projectId="p1" canImport={canImport} />
        <Spy />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  listRequirements.mockReset().mockResolvedValue({ items: [ROW], total: 60 })
})

describe('RequirementsView', () => {
  it('lists requirements with their status, owner, task and tests to review', async () => {
    setup()
    const row = (await screen.findByRole('link', { name: 'Claims are validated' })).closest('tr')!
    for (const text of ['REQ_000007', 'Approved', 'Functional', 'High', 'Asha', 'TASK_000001', '1 to review']) {
      expect(within(row).getByText(text)).toBeInTheDocument()
    }
    expect(screen.getByRole('status')).toHaveTextContent('60 requirements')
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
  })

  it('asks the server for the filtered page named in the address', async () => {
    setup('/projects/p1/tasks?view=requirements&rstatus=approved&rtests=review&rpage=2')
    await waitFor(() =>
      expect(listRequirements).toHaveBeenLastCalledWith(
        'p1',
        expect.objectContaining({ status: 'approved', needs_review: true, page: 2, page_size: 25 }),
      ),
    )
  })

  it('searches from the first page', async () => {
    setup('/projects/p1/tasks?view=requirements&rpage=2')
    await userEvent.type(screen.getByLabelText('Search requirements'), 'claim')
    await waitFor(() => expect(listRequirements).toHaveBeenLastCalledWith('p1', expect.objectContaining({ q: 'claim', page: 1 })))
  })

  it('clears the filters without leaving the view', async () => {
    listRequirements.mockResolvedValue({ items: [], total: 0 })
    setup('/projects/p1/tasks?view=requirements&rtests=uncovered')
    await userEvent.click(await screen.findByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(location).toBe('?view=requirements'))
  })

  it('offers the import only to people who may manage requirements', async () => {
    setup()
    await screen.findByRole('link', { name: 'Claims are validated' })
    expect(screen.queryByRole('button', { name: 'Import requirements' })).not.toBeInTheDocument()
  })

  it('opens the requirement import', async () => {
    setup('/projects/p1/tasks?view=requirements', true)
    await userEvent.click(await screen.findByRole('button', { name: 'Import requirements' }))
    expect(await screen.findByRole('dialog', { name: 'Import requirements' })).toBeInTheDocument()
  })
})
