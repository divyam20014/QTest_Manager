import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TaskDetail } from '@/api/tasks'
import { ToastProvider } from '@/lib/toast'

import { TaskDependencies } from './TaskDependencies'

const listTasks = vi.fn()
const addTaskDependency = vi.fn()
const removeTaskDependency = vi.fn()
vi.mock('@/api/tasks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/tasks')>()),
  listTasks: (...a: unknown[]) => listTasks(...a),
  addTaskDependency: (...a: unknown[]) => addTaskDependency(...a),
  removeTaskDependency: (...a: unknown[]) => removeTaskDependency(...a),
}))

const status = { id: 's1', code: 'todo', label: 'To Do', category: 'todo' as const, color: '#64748b' }
const ref = (id: string, title: string) => ({ task_id: id, display_id: `TASK_${id}`, title, status })

function task(over: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id: '2',
    project_id: 'p1',
    status,
    title: 'Build',
    depends_on: [ref('1', 'Design')],
    blocks: [ref('3', 'Release')],
    open_dependency_count: 1,
    ...over,
  } as TaskDetail
}

function setup(over: Partial<TaskDetail> = {}, canManage = true) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <MemoryRouter>
          <TaskDependencies task={task(over)} canManage={canManage} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  listTasks.mockReset().mockResolvedValue({
    items: [
      { id: '1', title: 'Design', display_id: 'TASK_1', status },
      { id: '2', title: 'Build', display_id: 'TASK_2', status },
      { id: '4', title: 'Data model', display_id: 'TASK_4', status },
    ],
    total: 3,
  })
  addTaskDependency.mockReset().mockResolvedValue({})
  removeTaskDependency.mockReset().mockResolvedValue({})
})

describe('TaskDependencies', () => {
  it('warns about unfinished earlier tasks and shows both directions', () => {
    setup()
    expect(screen.getByRole('note')).toHaveTextContent('not done yet. You can still work on this one.')
    expect(within(screen.getByRole('list', { name: 'Must finish first' })).getByRole('link', { name: 'Design' })).toHaveAttribute(
      'href',
      '/projects/p1/tasks/1',
    )
    expect(within(screen.getByRole('list', { name: 'Waiting for this task' })).getByText('Release')).toBeInTheDocument()
  })

  it('gives no warning once the task is done', () => {
    setup({ status: { ...status, category: 'done' } })
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('finds a task to wait for, leaving out itself and ones already linked', async () => {
    setup()
    await userEvent.type(screen.getByLabelText('Add a task that must finish first'), 'd')
    expect(listTasks).not.toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText('Add a task that must finish first'), 'a')

    const matches = await screen.findByRole('list', { name: 'Matching tasks' })
    expect(within(matches).getAllByRole('listitem')).toHaveLength(1)
    expect(listTasks).toHaveBeenLastCalledWith('p1', { q: 'da', page_size: 10 })
    await userEvent.click(within(matches).getByRole('button', { name: 'Add Data model as a dependency' }))

    await waitFor(() => expect(addTaskDependency).toHaveBeenCalledWith('2', '4'))
  })

  it('removes a dependency', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Remove the dependency on Design' }))
    await waitFor(() => expect(removeTaskDependency).toHaveBeenCalledWith('2', '1'))
  })

  it('is read only without permission to manage tasks, and hidden when there is nothing to read', () => {
    setup({}, false)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Add a task that must finish first')).not.toBeInTheDocument()
  })

  it('shows nothing to a reader of a task without dependencies', () => {
    setup({ depends_on: [], blocks: [], open_dependency_count: 0 }, false)
    expect(screen.queryByText('Dependencies')).not.toBeInTheDocument()
  })
})
