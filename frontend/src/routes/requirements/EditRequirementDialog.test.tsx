import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'
import type { Requirement } from '@/api/requirements'
import { ToastProvider } from '@/lib/toast'

import { EditRequirementDialog } from './EditRequirementDialog'

const updateRequirement = vi.fn()
const getRequirement = vi.fn()
vi.mock('@/api/requirements', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/requirements')>()),
  updateRequirement: (...a: unknown[]) => updateRequirement(...a),
  getRequirement: (...a: unknown[]) => getRequirement(...a),
}))
vi.mock('@/api/fieldCustomization', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/fieldCustomization')>()),
  listFieldOptions: () => Promise.resolve([]),
}))
vi.mock('@/api/projects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/projects')>()),
  listProjectMembers: () => Promise.resolve([]),
}))

const saved: Requirement = {
  id: 'r1',
  project_id: 'p1',
  display_id: 'REQ_000001',
  title: 'Claims are validated',
  description: 'Within two days',
  version_number: 1,
  requirement_type: 'Functional',
  priority: 'Medium',
  status: 'approved',
  owner_id: null,
  owner_name: null,
  row_version: 3,
  acceptance_criteria: [],
  review_count: 0,
  created_by: 'u',
  created_at: '2026-01-01T00:00:00Z',
  linked_test_case_count: 0,
  task_id: 't1',
  task_display_id: 'TASK_000001',
  task_title: 'Claims',
}

function setup() {
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <MemoryRouter>
          <EditRequirementDialog open onClose={onClose} requirement={saved} onSaved={() => {}} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
  return onClose
}

beforeEach(() => {
  updateRequirement.mockReset().mockResolvedValue({ ...saved, version_number: 2 })
  getRequirement.mockReset()
})

describe('EditRequirementDialog', () => {
  it('sends only the changes with the version it opened, and warns that approval will be lost', async () => {
    const onClose = setup()
    expect(screen.getByRole('button', { name: 'Save requirement' })).toBeDisabled()
    const description = screen.getByLabelText('Description')
    await userEvent.clear(description)
    await userEvent.type(description, 'Within one day')
    expect(screen.getByRole('note')).toHaveTextContent('returns it to Draft')

    await userEvent.click(screen.getByRole('button', { name: 'Save requirement' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(updateRequirement).toHaveBeenCalledWith('r1', { description: 'Within one day', expected_version: 3 })
  })

  it('keeps the entries when someone else saved first, then saves on the latest version', async () => {
    updateRequirement.mockRejectedValueOnce(new ApiError('Changed by someone else', 'stale_write', 409))
    getRequirement.mockResolvedValue({ ...saved, priority: 'High', row_version: 4, linked_test_cases: [] })
    const onClose = setup()
    const title = screen.getByLabelText(/Title/)
    await userEvent.clear(title)
    await userEvent.type(title, 'My own wording')

    await userEvent.click(screen.getByRole('button', { name: 'Save requirement' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Your entries were not saved')
    expect(screen.getByLabelText(/Title/)).toHaveValue('My own wording')
    expect(onClose).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Save requirement' }))
    // Their priority is not sent back: only what this person changed.
    await waitFor(() =>
      expect(updateRequirement).toHaveBeenLastCalledWith('r1', { title: 'My own wording', expected_version: 4 }),
    )
  })
})
