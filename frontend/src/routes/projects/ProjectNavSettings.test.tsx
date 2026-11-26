import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Project } from '@/api/projects'
import { ToastProvider } from '@/lib/toast'

import { ProjectNavSettings } from './ProjectNavSettings'

const updateProject = vi.fn()
vi.mock('@/api/projects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/projects')>()),
  updateProject: (...args: unknown[]) => updateProject(...args),
}))

function project(nav_config: Project['nav_config'] = null): Project {
  return { id: 'p1', name: 'Apex', version: 3, nav_config } as Project
}

function setup(p: Project) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ProjectNavSettings project={p} />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

const order = () =>
  within(screen.getByRole('list', { name: 'Project tab order' }))
    .getAllByRole('listitem')
    .map((li) => li.getAttribute('data-testid'))

beforeEach(() => {
  updateProject.mockReset()
  updateProject.mockResolvedValue({})
})

describe('ProjectNavSettings', () => {
  it('starts at the defaults with nothing to save or reset', () => {
    setup(project())
    expect(order()[0]).toBe('nav-row-overview')
    expect(order()).toHaveLength(8)
    expect(screen.getByRole('button', { name: 'Save tabs' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Overview up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Team down' })).toBeDisabled()
  })

  it('offers no way to hide core tabs', () => {
    setup(project())
    for (const label of ['Overview', 'Test Cases', 'Test Runs', 'Defects', 'Reports']) {
      expect(screen.queryByRole('checkbox', { name: `Show ${label} tab` })).toBeNull()
    }
    for (const label of ['Tasks', 'Planning', 'Team']) {
      expect(screen.getByRole('checkbox', { name: `Show ${label} tab` })).toBeChecked()
    }
  })

  it('moves a tab with its buttons, keeps focus on the pressed button and saves order and hidden tabs', async () => {
    const user = userEvent.setup()
    setup(project())
    await user.click(screen.getByRole('button', { name: 'Move Defects up' }))
    expect(order().slice(3, 5)).toEqual(['nav-row-defects', 'nav-row-test-runs'])
    expect(screen.getByRole('button', { name: 'Move Defects up' })).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('Defects moved to position 4 of 8')
    await user.click(screen.getByRole('checkbox', { name: 'Show Planning tab' }))
    await user.click(screen.getByRole('button', { name: 'Save tabs' }))
    await waitFor(() => expect(updateProject).toHaveBeenCalledTimes(1))
    const [id, body] = updateProject.mock.calls[0]
    expect(id).toBe('p1')
    expect(body.expected_version).toBe(3)
    expect(body.nav_config.hidden).toEqual(['planning'])
    expect(body.nav_config.order.slice(0, 6)).toEqual([
      'overview',
      'tasks',
      'test-cases',
      'defects',
      'test-runs',
      'reports',
    ])
  })

  it('works from the keyboard', async () => {
    const user = userEvent.setup()
    setup(project())
    screen.getByRole('button', { name: 'Move Reports up' }).focus()
    await user.keyboard('{Enter}')
    expect(order().slice(4, 6)).toEqual(['nav-row-reports', 'nav-row-defects'])
    expect(screen.getByRole('button', { name: 'Move Reports up' })).toHaveFocus()
  })

  it('shows a saved config and resets to the defaults by storing null after confirming', async () => {
    const user = userEvent.setup()
    setup(project({ order: ['defects'], hidden: ['team'] }))
    expect(order()[0]).toBe('nav-row-defects')
    expect(screen.getByRole('checkbox', { name: 'Show Team tab' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Save tabs' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Reset to defaults' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reset to defaults' }))
    await waitFor(() => expect(updateProject).toHaveBeenCalledWith('p1', { nav_config: null, expected_version: 3 }))
  })
})
