import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProjectLayout } from '@/api/projectDashboard'
import { DEFAULT_LAYOUT } from '@/lib/projectDashboard'
import { ToastProvider } from '@/lib/toast'

import { CustomisePanel } from './CustomisePanel'

const save = vi.fn()
const reset = vi.fn()
const saveDefault = vi.fn()
const clearDefault = vi.fn()
vi.mock('@/api/projectDashboard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/projectDashboard')>()),
  saveProjectLayout: (...a: unknown[]) => save(...a),
  resetProjectLayout: (...a: unknown[]) => reset(...a),
  saveProjectDefaultLayout: (...a: unknown[]) => saveDefault(...a),
  clearProjectDefaultLayout: (...a: unknown[]) => clearDefault(...a),
}))
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { user_id: 'u1' } }) }))

function layout(over: Partial<ProjectLayout> = {}): ProjectLayout {
  return {
    project_id: 'p1',
    layout_source: 'builtin',
    widgets: DEFAULT_LAYOUT,
    default_widgets: DEFAULT_LAYOUT,
    has_project_default: false,
    can_set_default: false,
    catalogue: DEFAULT_LAYOUT.map((w) => ({ widget_type: w.widget_type, default_size: w.size })),
    ...over,
  }
}

function setup(l: ProjectLayout) {
  const onClose = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <CustomisePanel projectId="p1" layout={l} onClose={onClose} />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { onClose, client }
}

const order = () =>
  within(screen.getByRole('list', { name: 'Dashboard widgets' }))
    .getAllByRole('listitem')
    .map((li) => li.getAttribute('data-testid'))

beforeEach(() => {
  for (const m of [save, reset, saveDefault, clearDefault]) {
    m.mockReset()
    m.mockResolvedValue(layout())
  }
})

describe('CustomisePanel', () => {
  it('starts unchanged: nothing to save, nothing to reset, ends cannot move further', () => {
    setup(layout())
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reset to default' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Key numbers up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Recently reported defects down' })).toBeDisabled()
    expect(screen.queryByTestId('customise-default')).toBeNull()
    expect(order()).toHaveLength(14)
  })

  it('moves a widget, keeps focus on the pressed button, announces it and saves the visible order', async () => {
    const user = userEvent.setup()
    setup(layout())
    await user.click(screen.getByRole('button', { name: 'Move Test execution trend up' }))
    expect(order().slice(0, 3)).toEqual([
      'customise-row-kpi_strip',
      'customise-row-execution_trend',
      'customise-row-test_status',
    ])
    expect(screen.getByRole('button', { name: 'Move Test execution trend up' })).toHaveFocus()
    expect(screen.getByText('Test execution trend moved up to position 2 of 14')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: /Tester performance/ }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    const [id, widgets] = save.mock.calls[0]
    expect(id).toBe('p1')
    expect(widgets).toHaveLength(13)
    expect(widgets[1].widget_type).toBe('execution_trend')
    expect(widgets.some((w: { widget_type: string }) => w.widget_type === 'tester_performance')).toBe(false)
  })

  it('resets only a personal layout', async () => {
    const user = userEvent.setup()
    setup(layout({ layout_source: 'user' }))
    await user.click(screen.getByRole('button', { name: 'Reset to default' }))
    await waitFor(() => expect(reset).toHaveBeenCalledWith('p1'))
  })

  it('offers the project default only to people who may set it', async () => {
    const user = userEvent.setup()
    setup(layout({ can_set_default: true, has_project_default: true }))
    await user.click(screen.getByRole('checkbox', { name: /Recent activity/ }))
    await user.click(screen.getByRole('button', { name: 'Save as project default' }))
    await waitFor(() => expect(saveDefault).toHaveBeenCalledTimes(1))
    expect(saveDefault.mock.calls[0][1]).toHaveLength(13)
  })

  it('removes a project default', async () => {
    const user = userEvent.setup()
    setup(layout({ can_set_default: true, has_project_default: true }))
    await user.click(screen.getByRole('button', { name: 'Remove project default' }))
    await waitFor(() => expect(clearDefault).toHaveBeenCalledWith('p1'))
  })
})
