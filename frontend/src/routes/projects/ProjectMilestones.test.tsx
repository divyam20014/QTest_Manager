import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MeResponse } from '@/api/auth'
import type { Milestone } from '@/api/planning'
import { ToastProvider } from '@/lib/toast'

import { MilestonesCard } from './ProjectMilestones'

let me: MeResponse
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  useAuth: () => ({ user: me }),
}))

const listMilestones = vi.fn()
const createMilestone = vi.fn()
const updateMilestone = vi.fn()
vi.mock('@/api/planning', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/planning')>()),
  listMilestones: (...a: unknown[]) => listMilestones(...a),
  createMilestone: (...a: unknown[]) => createMilestone(...a),
  updateMilestone: (...a: unknown[]) => updateMilestone(...a),
}))

let archivedAt: string | null
vi.mock('@/api/projects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/projects')>()),
  getProject: () => Promise.resolve({ id: 'p1', name: 'Apex', archived_at: archivedAt }),
}))

const BETA: Milestone = {
  id: 'm1',
  project_id: 'p1',
  name: 'Beta',
  description: null,
  due_date: '2000-01-01',
  completed_at: null,
  task_count: 3,
  done_count: 1,
  estimate_hours: '12.50',
  done_estimate_hours: '4.00',
}

function user(permissions: string[]): MeResponse {
  return { user_id: 'u', tenant_id: 't', email: 'u@example.com', name: 'U', role: 'manager', permissions }
}

function setup() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <MemoryRouter>
          <MilestonesCard projectId="p1" />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  me = user(['planning.manage'])
  archivedAt = null
  listMilestones.mockReset().mockResolvedValue([BETA])
  createMilestone.mockReset().mockResolvedValue(BETA)
  updateMilestone.mockReset().mockResolvedValue(BETA)
})

describe('MilestonesCard', () => {
  it('shows each milestone with its progress and a link to its tasks', async () => {
    setup()
    expect(await screen.findByText('Beta')).toBeInTheDocument()
    expect(screen.getByText('Past due')).toBeInTheDocument()
    expect(screen.getByText('1 of 3 tasks done · 4 h of 12.5 h estimated')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View tasks' })).toHaveAttribute('href', '/projects/p1/tasks?view=flat&milestone=m1')
  })

  it('creates a milestone', async () => {
    setup()
    await userEvent.type(await screen.findByLabelText('New milestone'), '  GA ')
    await userEvent.click(screen.getByRole('button', { name: 'Add milestone' }))
    await waitFor(() => expect(createMilestone).toHaveBeenCalledWith('p1', { name: 'GA', due_date: null }))
  })

  it('asks before completing a milestone with unfinished tasks', async () => {
    setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Complete milestone Beta' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('2 of its tasks are not done')
    expect(updateMilestone).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Complete milestone' }))
    await waitFor(() => expect(updateMilestone).toHaveBeenCalledWith('m1', { completed: true }))
  })

  it.each([
    ['without the planning permission', () => (me = user(['task.manage']))],
    ['in an archived project', () => (archivedAt = '2026-01-01T00:00:00Z')],
  ])('is read only %s', async (_name, arrange) => {
    arrange()
    setup()
    expect(await screen.findByText('Beta')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button')).not.toBeInTheDocument())
    expect(screen.queryByLabelText('New milestone')).not.toBeInTheDocument()
  })
})
