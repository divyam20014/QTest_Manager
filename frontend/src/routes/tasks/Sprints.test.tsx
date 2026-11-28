import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Sprint, SprintDetail, SprintState, SprintTask } from '@/api/planning'
import { ToastProvider } from '@/lib/toast'

import { Sprints } from './Sprints'

const listSprints = vi.fn()
const getSprint = vi.fn()
const startSprint = vi.fn()
const closeSprint = vi.fn()
const createSprint = vi.fn()
const setTaskSprint = vi.fn()
vi.mock('@/api/planning', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/planning')>()),
  listSprints: (...a: unknown[]) => listSprints(...a),
  getSprint: (...a: unknown[]) => getSprint(...a),
  startSprint: (...a: unknown[]) => startSprint(...a),
  closeSprint: (...a: unknown[]) => closeSprint(...a),
  createSprint: (...a: unknown[]) => createSprint(...a),
  setTaskSprint: (...a: unknown[]) => setTaskSprint(...a),
}))

function sprint(id: string, name: string, state: SprintState): Sprint {
  return {
    id,
    project_id: 'p1',
    name,
    goal: null,
    start_date: '2026-12-01',
    end_date: '2026-12-14',
    state,
    started_at: null,
    closed_at: null,
    task_count: 2,
    done_count: 1,
    estimate_hours: '5.00',
    done_estimate_hours: '3.00',
  }
}

function row(id: string, title: string, done: boolean): SprintTask {
  return {
    task_id: id,
    display_id: `TASK_${id}`,
    title,
    status: { id: 's1', code: 'todo', label: 'To Do', category: 'todo', color: '#64748b' },
    assignee_name: null,
    deleted: false,
    added_after_start: false,
    removed_at: null,
    done,
    estimate_hours: '2.00',
  }
}

const total = (count: number, hours = '0.00') => ({ count, hours })

function detail(of: Sprint, unfinished: number): SprintDetail {
  return {
    ...of,
    totals: { planned: total(2, '5.00'), added: total(0), removed: total(0), completed: total(2 - unfinished), unfinished: total(unfinished) },
    tasks: [row('1', 'Shipped', true), row('2', 'Half done', unfinished === 0)],
  }
}

const ACTIVE = sprint('a', 'Sprint 1', 'active')
const NEXT = sprint('b', 'Sprint 2', 'planned')

function setup({ canPlan = true, selectedId = '' } = {}) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <MemoryRouter>
          <Sprints projectId="p1" canPlan={canPlan} selectedId={selectedId} onSelect={() => {}} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  listSprints.mockReset().mockResolvedValue([ACTIVE, NEXT])
  getSprint.mockReset().mockImplementation((id: string) => Promise.resolve(detail(id === 'a' ? ACTIVE : NEXT, 1)))
  startSprint.mockReset().mockResolvedValue(detail(NEXT, 1))
  closeSprint.mockReset().mockResolvedValue(detail(ACTIVE, 1))
  createSprint.mockReset().mockResolvedValue(NEXT)
  setTaskSprint.mockReset().mockResolvedValue({})
})

async function openCloseDialog() {
  const button = await screen.findByRole('button', { name: 'Close sprint' })
  await waitFor(() => expect(button).toBeEnabled())
  await userEvent.click(button)
  return screen.findByRole('dialog')
}

async function chooseDestination(dialog: HTMLElement, option: string) {
  await userEvent.click(within(dialog).getByRole('combobox', { name: /Move unfinished tasks to/ }))
  await userEvent.click(await screen.findByRole('option', { name: option }))
}

describe('Sprints', () => {
  it('shows the active sprint with its totals and tasks', async () => {
    setup()
    expect(await screen.findByText('Half done')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Sprint 1' })).toBeInTheDocument()
    expect(screen.getByLabelText('Sprint totals')).toHaveTextContent('Planned2 tasks · 5 h')
    expect(screen.getByRole('link', { name: 'Open board' })).toHaveAttribute('href', '/projects/p1/tasks?view=board&sprint=a')
  })

  it('makes whoever closes a sprint choose where unfinished tasks go', async () => {
    setup()
    const dialog = await openCloseDialog()
    const confirm = within(dialog).getByRole('button', { name: 'Close sprint' })
    expect(dialog).toHaveTextContent('1 task is done and 1 is not')
    expect(confirm).toBeDisabled()

    await chooseDestination(dialog, 'Sprint 2')
    await userEvent.click(confirm)

    await waitFor(() => expect(closeSprint).toHaveBeenCalledWith('a', 'b'))
  })

  it('sends them to the backlog when that is the choice', async () => {
    setup()
    const dialog = await openCloseDialog()
    await chooseDestination(dialog, 'The backlog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close sprint' }))
    await waitFor(() => expect(closeSprint).toHaveBeenCalledWith('a', null))
  })

  it('asks for no choice when everything is done', async () => {
    getSprint.mockResolvedValue(detail(ACTIVE, 0))
    setup()
    const dialog = await openCloseDialog()
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close sprint' }))
    await waitFor(() => expect(closeSprint).toHaveBeenCalledWith('a', null))
  })

  it('does not offer to start a sprint while another is active', async () => {
    setup({ selectedId: 'b' })
    expect(await screen.findByRole('button', { name: 'Start sprint' })).toBeDisabled()
    expect(screen.getByText('Close “Sprint 1” before starting this one.')).toBeInTheDocument()
  })

  it('starts a planned sprint', async () => {
    listSprints.mockResolvedValue([NEXT])
    setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Start sprint' }))
    await waitFor(() => expect(startSprint).toHaveBeenCalledWith('b'))
  })

  it('takes a task out of the sprint', async () => {
    setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Half done from the sprint' }))
    await waitFor(() => expect(setTaskSprint).toHaveBeenCalledWith('2', null))
  })

  it('creates a sprint, refusing an end before the start', async () => {
    listSprints.mockResolvedValue([])
    setup()
    await userEvent.click(await screen.findByRole('button', { name: 'New sprint' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText(/Name/), 'Sprint 3')
    await userEvent.type(within(dialog).getByLabelText(/Starts/), '2026-12-10')
    await userEvent.type(within(dialog).getByLabelText(/Ends/), '2026-12-01')
    const create = within(dialog).getByRole('button', { name: 'Create sprint' })
    expect(create).toBeDisabled()

    await userEvent.clear(within(dialog).getByLabelText(/Ends/))
    await userEvent.type(within(dialog).getByLabelText(/Ends/), '2026-12-20')
    await userEvent.click(create)

    await waitFor(() =>
      expect(createSprint).toHaveBeenCalledWith('p1', { name: 'Sprint 3', goal: null, start_date: '2026-12-10', end_date: '2026-12-20' }),
    )
  })

  it('is read only without the planning permission', async () => {
    setup({ canPlan: false })
    expect(await screen.findByText('Half done')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
