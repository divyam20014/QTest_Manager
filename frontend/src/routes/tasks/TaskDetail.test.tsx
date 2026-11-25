import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MeResponse } from '@/api/auth'
import type { Task, TaskDetail as TaskDetailData, TaskRollup } from '@/api/tasks'
import { ToastProvider } from '@/lib/toast'

import { TaskDetail } from './TaskDetail'

let me: MeResponse
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  useAuth: () => ({ user: me }),
  useCurrentUserId: () => me.user_id,
}))

const getTask = vi.fn()
const getTaskRollup = vi.fn()
const listTaskTestCases = vi.fn()
const listTaskRuns = vi.fn()
vi.mock('@/api/tasks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/tasks')>()),
  getTask: (...a: unknown[]) => getTask(...a),
  getTaskRollup: (...a: unknown[]) => getTaskRollup(...a),
  listTaskTestCases: (...a: unknown[]) => listTaskTestCases(...a),
  listTaskRuns: (...a: unknown[]) => listTaskRuns(...a),
  getTaskHistory: () => Promise.resolve([]),
  listTaskStatuses: () => Promise.resolve([]),
  getProjectTaskTree: () => Promise.resolve({ items: [], total: 0 }),
}))
vi.mock('@/api/requirements', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/requirements')>()),
  listRequirements: () => Promise.resolve({ items: [], total: 0 }),
}))
vi.mock('@/api/defects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/defects')>()),
  listDefectsPage: () => Promise.resolve({ items: [], total: 0 }),
}))
vi.mock('@/api/testCases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/testCases')>()),
  listTestCases: () => Promise.resolve({ items: [], total: 0 }),
}))
vi.mock('@/components/CommentsCard', () => ({ CommentsPanel: () => <div>comments panel</div> }))
vi.mock('@/components/AttachmentsCard', () => ({ AttachmentsCard: () => <div>attachments card</div> }))

const STATUS = { id: 's1', code: 'todo', label: 'To Do', category: 'todo', color: '#64748b' } as const

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't2',
    project_id: 'p1',
    parent_task_id: 't1',
    depth: 1,
    display_id: 'TASK_000002',
    title: 'Payment form',
    description: 'Build the card form',
    status: STATUS,
    priority: 'High',
    assignee_id: null,
    assignee_name: null,
    release_id: null,
    start_date: null,
    due_date: null,
    completed_at: null,
    is_overdue: false,
    created_by: 'u',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    sub_task_count: 0,
    sub_tasks_done: 0,
    requirement_count: 0,
    defect_count: 0,
    test_case_count: 0,
    ...over,
  }
}

function detail(over: Partial<TaskDetailData> = {}): TaskDetailData {
  return {
    ...task(),
    ancestors: [{ id: 't1', display_id: 'TASK_000001', title: 'Checkout flow', depth: 0 }],
    sub_tasks: [],
    test_cases: [],
    ...over,
  }
}

const ROLLUP: TaskRollup = {
  task_id: 't2',
  include_sub_tasks: true,
  sub_tasks_total: 4,
  sub_tasks_todo: 1,
  sub_tasks_in_progress: 1,
  sub_tasks_done: 2,
  sub_tasks_overdue: 1,
  progress_percent: 50,
  requirements_total: 4,
  requirements_covered: 3,
  test_cases_total: 5,
  test_cases_passed: 3,
  test_cases_failed: 1,
  test_cases_blocked: 0,
  test_cases_not_run: 1,
  pass_rate: 75,
  test_runs_total: 2,
  defects_total: 3,
  defects_open: 2,
  defects_critical_open: 1,
}

function user(permissions: string[]): MeResponse {
  return { user_id: 'u1', tenant_id: 't', email: 'u@example.com', name: 'U', role: 'manager', permissions }
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/projects/p1/tasks/t2']}>
          <Routes>
            <Route path="/projects/:projectId/tasks/:taskId" element={<TaskDetail />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  me = user(['task.manage', 'task.transition'])
  getTask.mockReset()
  getTaskRollup.mockReset()
  listTaskTestCases.mockReset()
  listTaskRuns.mockReset()
  getTask.mockResolvedValue(detail({ sub_task_count: 4, sub_tasks_done: 2 }))
  getTaskRollup.mockResolvedValue(ROLLUP)
  listTaskTestCases.mockResolvedValue([])
  listTaskRuns.mockResolvedValue([])
})

describe('TaskDetail', () => {
  it('shows the task, its path and the roll-up numbers', async () => {
    setup()
    expect(await screen.findByRole('heading', { name: 'Payment form' })).toBeInTheDocument()
    expect(screen.getByText('TASK_000002')).toBeInTheDocument()
    const path = screen.getByRole('navigation', { name: 'Task path' })
    expect(within(path).getByRole('link', { name: 'TASK_000001 · Checkout flow' })).toHaveAttribute(
      'href',
      '/projects/p1/tasks/t1',
    )
    const numbers = await screen.findByRole('list', { name: /Task numbers/ })
    expect(within(numbers).getByText('50%')).toBeInTheDocument() // progress
    expect(within(numbers).getAllByText('75%', { selector: 'p' })).toHaveLength(2) // coverage and pass rate
    expect(within(numbers).getByText('3 of 4 have a test case')).toBeInTheDocument()
    expect(within(numbers).getByText(/3 passed · 1 failed/)).toBeInTheDocument()
    expect(within(numbers).getByText(/1 critical/)).toBeInTheDocument()
    // A failing case and an open critical defect: the health badge says so.
    expect(screen.getByText('At risk')).toBeInTheDocument()
  })

  it('asks for the numbers without sub-tasks when the box is cleared', async () => {
    const user = userEvent.setup()
    setup()
    await screen.findByRole('list', { name: /Task numbers/ })
    expect(getTaskRollup).toHaveBeenLastCalledWith('t2', true)
    await user.click(screen.getByRole('checkbox', { name: 'Include sub-tasks in these numbers' }))
    await vi.waitFor(() => expect(getTaskRollup).toHaveBeenLastCalledWith('t2', false))
  })

  it('has a tab for each thing that belongs to the task, with counts', async () => {
    setup()
    await screen.findByRole('list', { name: /Task numbers/ })
    const tabs = within(screen.getByRole('tablist'))
    for (const name of [/Overview/, /Requirements/, /Test Cases/, /Defects/, /Test Runs/, /Discussion/, /Activity/]) {
      expect(tabs.getByRole('tab', { name })).toBeInTheDocument()
    }
    expect(tabs.getByRole('tab', { name: /Requirements/ })).toHaveTextContent('4')
    expect(tabs.getByRole('tab', { name: /Test Cases/ })).toHaveTextContent('5')
  })

  it('lists the effective test cases with their source and latest result', async () => {
    const user = userEvent.setup()
    listTaskTestCases.mockResolvedValue([
      {
        test_case_id: 'c1',
        display_id: 'TC_000001',
        title: 'Pay by card',
        status: 'approved',
        linked_directly: true,
        via_requirement: true,
        last_result: 'failed',
        task_id: 't2',
        task_display_id: 'TASK_000002',
      },
    ])
    setup()
    await screen.findByRole('list', { name: /Task numbers/ })
    await user.click(screen.getByRole('tab', { name: /Test Cases/ }))
    const table = await screen.findByRole('table', { name: 'Test cases of this task' })
    const row = within(table).getAllByRole('row')[1]
    expect(row).toHaveTextContent('Pay by card')
    expect(row).toHaveTextContent('Linked')
    expect(row).toHaveTextContent('Via requirement')
    expect(row).toHaveTextContent('Failed')
    expect(within(row).getByRole('button', { name: 'Unlink Pay by card' })).toBeInTheDocument()
  })

  it('offers editing and sub-tasks only with task.manage', async () => {
    me = user(['task.transition'])
    setup()
    await screen.findByRole('heading', { name: 'Payment form' })
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add sub-task' })).toBeNull()
  })

  it('says so when the task does not exist', async () => {
    getTask.mockResolvedValue(detail({ project_id: 'other' }))
    setup()
    expect(await screen.findByText('Task not found')).toBeInTheDocument()
  })
})
