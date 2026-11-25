import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MeResponse } from '@/api/auth'
import type { Task } from '@/api/tasks'
import { ToastProvider } from '@/lib/toast'

import { TasksList } from './TasksList'

let me: MeResponse
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  useAuth: () => ({ user: me }),
  useCurrentUserId: () => me.user_id,
}))

const getProjectTaskTree = vi.fn()
const listTasks = vi.fn()
vi.mock('@/api/tasks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/tasks')>()),
  getProjectTaskTree: (...a: unknown[]) => getProjectTaskTree(...a),
  listTasks: (...a: unknown[]) => listTasks(...a),
  listTaskStatuses: () =>
    Promise.resolve([
      { id: 's1', code: 'todo', label: 'To Do', category: 'todo', color: '#64748b', sort_order: 0, is_default: true, task_count: 0 },
    ]),
  getTask: () => Promise.reject(new Error('not used')),
}))
vi.mock('@/api/projects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/projects')>()),
  getProject: () => Promise.resolve({ id: 'p1', name: 'Apex' }),
  listProjectMembers: () => Promise.resolve([]),
}))

function task(id: string, title: string, parent: string | null, depth: number, over: Partial<Task> = {}): Task {
  return {
    id,
    project_id: 'p1',
    parent_task_id: parent,
    depth,
    display_id: `TASK_00000${id}`,
    title,
    description: null,
    status: { id: 's1', code: 'todo', label: 'To Do', category: 'todo', color: '#64748b' },
    priority: 'Medium',
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

const TREE = [
  task('1', 'Checkout flow', null, 0, { sub_task_count: 2, sub_tasks_done: 1 }),
  task('2', 'Payment form', '1', 1, { is_overdue: true, due_date: '2026-01-02' }),
  task('3', 'Receipt email', '1', 1),
  task('4', 'Search', null, 0),
]

function user(permissions: string[]): MeResponse {
  return { user_id: 'u', tenant_id: 't', email: 'u@example.com', name: 'U', role: 'manager', permissions }
}

function setup(path = '/projects/p1/tasks') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/projects/:projectId/tasks" element={<TasksList />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

const titles = () =>
  within(screen.getByRole('table', { name: 'Tasks' }))
    .getAllByRole('row')
    .slice(1)
    .map((r) => r.textContent ?? '')

beforeEach(() => {
  me = user(['task.manage', 'task.transition'])
  getProjectTaskTree.mockReset()
  listTasks.mockReset()
  getProjectTaskTree.mockResolvedValue({ items: TREE, total: TREE.length })
  listTasks.mockResolvedValue({ items: [TREE[3]], total: 1 })
})

describe('TasksList', () => {
  it('shows the hierarchy with sub-tasks under their parent, progress and an overdue flag', async () => {
    setup()
    expect(await screen.findByText('Receipt email')).toBeInTheDocument()
    const rows = titles()
    expect(rows[0]).toContain('Checkout flow')
    expect(rows[0]).toContain('1 of 2')
    expect(rows[1]).toContain('Payment form')
    expect(rows[1]).toContain('Overdue')
    expect(rows[2]).toContain('Receipt email')
    expect(rows[3]).toContain('Search')
    expect(listTasks).not.toHaveBeenCalled()
  })

  it('collapses and expands the sub-tasks of a task', async () => {
    const user = userEvent.setup()
    setup()
    await screen.findByText('Payment form')
    await user.click(screen.getByRole('button', { name: 'Collapse sub-tasks of Checkout flow' }))
    expect(screen.queryByText('Payment form')).toBeNull()
    expect(titles().some((row) => row.includes('Search'))).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Expand sub-tasks of Checkout flow' }))
    expect(screen.getByText('Payment form')).toBeInTheDocument()
  })

  it('switches to a flat server-filtered list when searching', async () => {
    const user = userEvent.setup()
    setup()
    await screen.findByText('Payment form')
    await user.type(screen.getByLabelText('Search'), 'search')
    await waitFor(() => expect(listTasks).toHaveBeenCalled())
    expect(listTasks.mock.calls.at(-1)?.[1]).toMatchObject({ q: 'search', page: 1 })
    await waitFor(() => expect(screen.queryByText('Payment form')).toBeNull())
    expect(titles().some((row) => row.includes('Search'))).toBe(true)
  })

  it('offers New Task only with task.manage', async () => {
    setup()
    await screen.findByText('Payment form')
    expect(screen.getByRole('button', { name: 'New Task' })).toBeInTheDocument()
  })

  it('hides New Task from someone without task.manage', async () => {
    me = user(['task.transition'])
    setup()
    await screen.findByText('Payment form')
    expect(screen.queryByRole('button', { name: 'New Task' })).toBeNull()
  })

  it('shows the empty state when the project has no tasks', async () => {
    getProjectTaskTree.mockResolvedValue({ items: [], total: 0 })
    setup()
    expect(await screen.findByText('No tasks yet')).toBeInTheDocument()
  })

  it('shows a board of the tasks by status', async () => {
    listTasks.mockResolvedValue({ items: [TREE[0], TREE[3]], total: 2 })
    setup('/projects/p1/tasks?view=board')
    expect(await screen.findByText('Checkout flow')).toBeInTheDocument()
    expect(screen.getByText('To Do')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Search/ })).toHaveAttribute('href', '/projects/p1/tasks/4')
    // The board asks the server for one column's tasks by status, not for the whole tree.
    expect(getProjectTaskTree).not.toHaveBeenCalled()
    expect(listTasks.mock.calls[0][1]).toMatchObject({ status_id: 's1' })
    // The hierarchy-only controls are gone.
    expect(screen.queryByLabelText('Status')).toBeNull()
  })

  it('says so when the hierarchy holds only the first tasks of a larger project', async () => {
    getProjectTaskTree.mockResolvedValue({ items: TREE, total: 5000 })
    setup()
    const note = await screen.findByRole('note')
    expect(note).toHaveTextContent('Showing the first 4 of 5000 tasks')
  })

  it('shows no such note when the whole project is listed', async () => {
    setup()
    await screen.findByText('Payment form')
    expect(screen.queryByRole('note')).toBeNull()
  })
})
