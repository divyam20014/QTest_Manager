import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TaskSummary } from '@/api/tasks'

import { PROJECT_WIDGETS } from './widgets'

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  useAuth: () => ({
    user: { user_id: 'u', tenant_id: 't', email: 'u@example.com', name: 'U', role: 'manager', permissions: [] },
  }),
  useCurrentUserId: () => 'u',
}))

const getProjectTaskSummary = vi.fn()
vi.mock('@/api/tasks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/tasks')>()),
  getProjectTaskSummary: (...a: unknown[]) => getProjectTaskSummary(...a),
}))

const SUMMARY: TaskSummary = {
  project_id: 'p1',
  total: 8,
  top_level: 5,
  sub_tasks: 3,
  todo: 3,
  in_progress: 2,
  done: 3,
  progress_percent: 38,
  overdue: 2,
  due_next_7_days: 1,
  unassigned_open: 4,
  completed_last_7_days: 2,
  by_status: [
    { status_id: 's1', code: 'todo', label: 'To Do', category: 'todo', color: '#64748b', count: 3 },
    { status_id: 's2', code: 'in_progress', label: 'In Progress', category: 'in_progress', color: '#2563eb', count: 2 },
    { status_id: 's3', code: 'done', label: 'Done', category: 'done', color: '#16a34a', count: 3 },
  ],
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{PROJECT_WIDGETS.task_progress({ projectId: 'p1' })}</MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  getProjectTaskSummary.mockReset()
  getProjectTaskSummary.mockResolvedValue(SUMMARY)
})

describe('Task progress widget', () => {
  it('shows how many tasks are done, a bar per status and the attention numbers', async () => {
    setup()
    const widget = await screen.findByTestId('widget-task_progress')
    expect(await within(widget).findByText(/of 8 done/)).toBeInTheDocument()
    expect(within(widget).getByRole('progressbar', { name: 'Tasks done' })).toHaveAttribute('aria-valuenow', '38')
    const bars = within(widget).getByRole('list', { name: 'Tasks by status' })
    expect(within(bars).getByRole('link', { name: 'In Progress' })).toHaveAttribute('href', '/projects/p1/tasks?status=s2')
    expect(within(widget).getByText('Overdue').parentElement).toHaveTextContent('2')
    expect(within(widget).getByText('Unassigned').parentElement).toHaveTextContent('4')
    expect(within(widget).getByText(/5 top-level tasks and 3 sub-tasks; 2 finished in the last 7 days/)).toBeInTheDocument()
  })

  it('says so when the project has no tasks', async () => {
    getProjectTaskSummary.mockResolvedValue({ ...SUMMARY, total: 0, by_status: [] })
    setup()
    expect(await screen.findByText('No tasks yet.')).toBeInTheDocument()
  })
})
