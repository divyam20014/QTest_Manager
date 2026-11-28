import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MeResponse } from '@/api/auth'
import { ToastProvider } from '@/lib/toast'

import { RequirementDetail } from './RequirementDetail'

let me: MeResponse
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  useAuth: () => ({ user: me }),
  useCurrentUserId: () => me.user_id,
}))

const getRequirement = vi.fn()
const confirmRequirementLink = vi.fn()
vi.mock('@/api/requirements', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/requirements')>()),
  getRequirement: (...a: unknown[]) => getRequirement(...a),
  confirmRequirementLink: (...a: unknown[]) => confirmRequirementLink(...a),
  getRequirementHistory: () => Promise.resolve([]),
}))
// The cards around the requirement are covered by their own tests.
vi.mock('@/components/CustomFieldsCard', () => ({ CustomFieldsCard: () => null }))
vi.mock('@/components/AttachmentsCard', () => ({ AttachmentsCard: () => null }))
vi.mock('@/components/RecordPin', () => ({ RecordPin: () => null }))
vi.mock('@/components/TaskPicker', () => ({ TaskPicker: () => null }))

const link = (id: string, title: string, covers: number | null, needsReview: boolean) => ({
  test_case_id: id,
  test_case_title: title,
  test_case_status: 'Draft',
  covers_version_number: covers,
  needs_review: needsReview,
  linked_by: 'u',
  linked_at: '2026-01-01T00:00:00Z',
})

const REQUIREMENT = {
  id: 'r1',
  project_id: 'p1',
  display_id: 'REQ_000001',
  title: 'Claims are validated',
  description: '',
  version_number: 3,
  requirement_type: 'Functional',
  priority: 'Medium',
  status: 'draft',
  owner_id: null,
  owner_name: null,
  row_version: 4,
  acceptance_criteria: ['Answered in one day'],
  review_count: 1,
  task_id: 't1',
  task_display_id: 'TASK_000001',
  task_title: 'Claims',
  linked_test_case_count: 3,
  linked_test_cases: [link('c1', 'Old wording', 2, true), link('c2', 'Current', 3, false), link('c3', 'From before', null, false)],
}

function setup(permissions = ['requirement.manage']) {
  me = { user_id: 'u', tenant_id: 't', email: 'u@example.com', name: 'U', role: 'tester', permissions }
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/projects/p1/requirements/r1']}>
          <Routes>
            <Route path="/projects/:projectId/requirements/:requirementId" element={<RequirementDetail />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  getRequirement.mockReset().mockResolvedValue(REQUIREMENT)
  confirmRequirementLink.mockReset().mockResolvedValue(REQUIREMENT)
})

describe('RequirementDetail', () => {
  it('shows the criteria and which wording each test case covers', async () => {
    setup()
    expect(await screen.findByRole('list', { name: 'Acceptance criteria' })).toHaveTextContent('Answered in one day')
    for (const text of ['Covers v2', 'Covers v3', 'Version not recorded', 'Needs review']) {
      expect(screen.getByText(text)).toBeInTheDocument()
    }
    expect(screen.getByRole('note')).toHaveTextContent('Check it against version 3')
    // Nothing to confirm for a link that already covers the current wording.
    expect(screen.queryByRole('button', { name: 'Current still covers version 3' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'From before still covers version 3' })).toBeInTheDocument()
  })

  it('confirms against the version on screen', async () => {
    setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Old wording still covers version 3' }))
    await waitFor(() => expect(confirmRequirementLink).toHaveBeenCalledWith('r1', 'c1', 3))
  })

  it('offers no changes without permission to manage requirements', async () => {
    setup(['report.view'])
    expect(await screen.findByText('Needs review')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /still covers version/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })
})
