import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'
import type { WorkspaceConfig } from '@/api/workspace'
import { ToastProvider } from '@/lib/toast'

import { WorkspaceSettings } from './WorkspaceSettings'

const getWorkspaceConfig = vi.fn()
const putWorkspaceConfig = vi.fn()
vi.mock('@/api/workspace', () => ({
  getWorkspaceConfig: () => getWorkspaceConfig(),
  putWorkspaceConfig: (...args: unknown[]) => putWorkspaceConfig(...args),
}))

const DEFAULTS: WorkspaceConfig = {
  sidebar: { order: [], hidden: [] },
  project_tabs: { order: [], hidden: [] },
  view_modes: {},
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <WorkspaceSettings />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

const rows = (name: string) =>
  within(screen.getByRole('list', { name }))
    .getAllByRole('listitem')
    .map((li) => li.getAttribute('data-testid'))

beforeEach(() => {
  getWorkspaceConfig.mockReset()
  putWorkspaceConfig.mockReset()
  getWorkspaceConfig.mockResolvedValue(DEFAULTS)
  putWorkspaceConfig.mockImplementation((c: WorkspaceConfig) => Promise.resolve(c))
})

describe('WorkspaceSettings', () => {
  it('shows a loading state, then the defaults with nothing to save or reset', async () => {
    setup()
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(await screen.findByRole('heading', { name: 'Workspace' })).toBeInTheDocument()
    expect(await screen.findByRole('list', { name: 'Sidebar entry order' })).toBeInTheDocument()
    expect(rows('Sidebar entry order')[0]).toBe('nav-row-home')
    expect(rows('Sidebar entry order')).toHaveLength(8)
    expect(rows('Project tab order')).toHaveLength(11)
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeDisabled()
  })

  it('shows an error state with a retry when the defaults cannot be loaded', async () => {
    getWorkspaceConfig.mockRejectedValueOnce(new Error('boom'))
    const user = userEvent.setup()
    setup()
    expect(await screen.findByText(/Could not load the workspace defaults/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /retry|try again/i }))
    expect(await screen.findByRole('list', { name: 'Sidebar entry order' })).toBeInTheDocument()
  })

  it('offers no way to hide core sidebar entries or core project tabs', async () => {
    setup()
    await screen.findByRole('list', { name: 'Sidebar entry order' })
    for (const label of ['Dashboard', 'Projects', 'My Work', 'Admin']) {
      expect(screen.queryByRole('checkbox', { name: `Show ${label}` })).toBeNull()
    }
    for (const label of ['Overview', 'Requirements', 'Test Cases', 'Test Runs', 'Reports', 'Settings']) {
      expect(screen.queryByRole('checkbox', { name: `Show ${label}` })).toBeNull()
    }
    // The Defects sidebar entry may be hidden; the Defects project tab is core, so only one row has a checkbox.
    expect(screen.getAllByRole('checkbox', { name: 'Show Defects' })).toHaveLength(1)
    for (const label of ['Test Management', 'Test Execution', 'Reports & Analytics', 'Planning', 'Releases']) {
      expect(screen.getByRole('checkbox', { name: `Show ${label}` })).toBeChecked()
    }
    // The list view cannot be switched off: it has no control at all.
    expect(screen.getAllByText('List (always on)')).toHaveLength(3)
    expect(screen.queryByRole('checkbox', { name: /^List view/ })).toBeNull()
  })

  it('saves sidebar order and hidden entries, project tabs and list views in one PUT', async () => {
    const user = userEvent.setup()
    setup()
    await screen.findByRole('list', { name: 'Sidebar entry order' })
    // Defects is both a sidebar entry and a (core) project tab: pick the sidebar's.
    const sidebar = () => within(screen.getByRole('list', { name: 'Sidebar entry order' }))
    await user.click(sidebar().getByRole('button', { name: 'Move Defects up' }))
    expect(rows('Sidebar entry order').slice(4, 6)).toEqual(['nav-row-defects', 'nav-row-test-execution'])
    expect(sidebar().getByRole('button', { name: 'Move Defects up' })).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('Defects moved to position 5 of 8')
    await user.click(screen.getByRole('checkbox', { name: 'Show Reports & Analytics' }))
    await user.click(screen.getByRole('checkbox', { name: 'Show Releases' }))
    await user.click(screen.getByRole('checkbox', { name: 'Calendar view for Test runs' }))
    await user.click(screen.getByRole('checkbox', { name: 'Board view for Defects' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(putWorkspaceConfig).toHaveBeenCalledTimes(1))
    const body = putWorkspaceConfig.mock.calls[0][0] as WorkspaceConfig
    expect(body.sidebar.hidden).toEqual(['reports'])
    expect(body.sidebar.order.slice(0, 6)).toEqual(['home', 'projects', 'my-work', 'test-management', 'defects', 'test-execution'])
    expect(body.project_tabs).toEqual({ order: [], hidden: ['releases'] })
    expect(body.view_modes).toEqual({ defects: ['list'], test_runs: ['list', 'board'] })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled())
  })

  it('works from the keyboard', async () => {
    const user = userEvent.setup()
    setup()
    await screen.findByRole('list', { name: 'Sidebar entry order' })
    screen.getByRole('button', { name: 'Move Reports & Analytics up' }).focus()
    await user.keyboard('{Enter}')
    expect(rows('Sidebar entry order').slice(5, 7)).toEqual(['nav-row-reports', 'nav-row-defects'])
    expect(screen.getByRole('button', { name: 'Move Reports & Analytics up' })).toHaveFocus()
  })

  it('shows a saved config and resets to the defaults after confirming', async () => {
    getWorkspaceConfig.mockResolvedValue({
      sidebar: { order: ['defects'], hidden: ['reports'] },
      project_tabs: { order: [], hidden: ['team'] },
      view_modes: { test_runs: ['list'] },
    })
    const user = userEvent.setup()
    setup()
    await screen.findByRole('list', { name: 'Sidebar entry order' })
    expect(rows('Sidebar entry order')[0]).toBe('nav-row-defects')
    expect(screen.getByRole('checkbox', { name: 'Show Reports & Analytics' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Show Team' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Calendar view for Test runs' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Reset to defaults' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reset to defaults' }))
    await waitFor(() => expect(putWorkspaceConfig).toHaveBeenCalledWith(DEFAULTS))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeDisabled())
  })

  it('shows the server message when saving is refused', async () => {
    putWorkspaceConfig.mockRejectedValueOnce(new ApiError('These sidebar entries cannot be hidden: home', 'validation_error', 422))
    const user = userEvent.setup()
    setup()
    await screen.findByRole('list', { name: 'Sidebar entry order' })
    await user.click(screen.getByRole('checkbox', { name: 'Show Defects' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText(/cannot be hidden/)).toBeInTheDocument()
  })
})
