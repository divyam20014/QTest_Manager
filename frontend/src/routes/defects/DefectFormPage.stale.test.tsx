// ADR-136: two people edit one defect. The second save must not undo the first.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'
import type { Defect } from '@/api/defects'
import { ToastProvider } from '@/lib/toast'

import { DefectEditPage } from './DefectFormPage'

const getDefect = vi.fn()
const updateDefect = vi.fn()
vi.mock('@/api/defects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/defects')>()),
  getDefect: (...args: unknown[]) => getDefect(...args),
  updateDefect: (...args: unknown[]) => updateDefect(...args),
  getDefectColumns: () => Promise.resolve(undefined),
}))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  useAuth: () => ({
    user: { user_id: 'u1', role: 'admin', permissions: ['defect.edit', 'defect.create'] },
  }),
}))

function defect(over: Partial<Defect> = {}): Defect {
  return {
    id: 'd1',
    row_version: 1,
    project_id: 'p1',
    display_id: 'BUG_000001',
    title: 'Premium is wrong',
    description: 'Original description',
    severity: 'High',
    priority: 'High',
    status: 'Open',
    resolution: null,
    expected_result: 'Right premium',
    actual_result: 'Wrong premium',
    environment: 'QA',
    repro_steps: [{ step_number: 1, action: 'Open the quote' }],
    linked_test_cases: [],
    labels: [],
    ...over,
  } as unknown as Defect
}

function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      { path: '/defects/:defectId/edit', element: <DefectEditPage /> },
      { path: '*', element: <p>Elsewhere</p> },
    ],
    { initialEntries: ['/defects/d1/edit'] },
  )
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  getDefect.mockReset()
  updateDefect.mockReset()
  // Every other request the form makes can fail: it only fills optional drop-downs.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
})

describe('saving a defect someone else changed', () => {
  it("keeps the user's entry, brings in the other change and saves only the user's field next", async () => {
    const user = userEvent.setup()
    const theirs = defect({ row_version: 2, title: 'Their title', description: 'Their description' })
    getDefect.mockResolvedValueOnce(defect()).mockResolvedValue(theirs)
    updateDefect
      .mockRejectedValueOnce(new ApiError('Changed by someone else.', 'stale_write', 409))
      .mockResolvedValue(theirs)
    open()

    const title = await screen.findByDisplayValue('Premium is wrong')
    await user.clear(title)
    await user.type(title, 'My title')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    const notice = await screen.findByText(/Your entries were not saved/)
    expect(notice.parentElement).toHaveTextContent('You both changed: Title.')
    expect(updateDefect).toHaveBeenLastCalledWith('d1', { title: 'My title', expected_version: 1 })
    expect(screen.getByDisplayValue('My title')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Their description')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    // The description is theirs and untouched here, so it is not sent back.
    await waitFor(() =>
      expect(updateDefect).toHaveBeenLastCalledWith('d1', { title: 'My title', expected_version: 2 }),
    )
    // Typing into the whole form takes longer than the 5 s default on a loaded machine.
  }, 30_000)
})
