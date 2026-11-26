import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { MeResponse } from '@/api/auth'
import { DEFAULT_WORKSPACE_CONFIG } from '@/lib/workspaceConfig'

import { MobileTabBar } from './MobileNav'

const me: MeResponse = { user_id: 'u', tenant_id: 't', email: 'u@example.com', name: 'U', role: 'tester', permissions: [] }
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: me }) }))
vi.mock('@/api/defects', () => ({ getDefectStatusCounts: () => Promise.resolve({}) }))
vi.mock('@/api/notifications', () => ({ getUnreadCount: () => Promise.resolve({ count: 0 }) }))

let config = DEFAULT_WORKSPACE_CONFIG
vi.mock('@/lib/workspaceConfig', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/workspaceConfig')>()),
  useWorkspaceConfig: () => ({ config, isLoading: false, isError: false }),
}))

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MobileTabBar moreOpen={false} onMore={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('phone tab bar and the workspace defaults', () => {
  it('shows the four tabs and More by default', () => {
    config = DEFAULT_WORKSPACE_CONFIG
    setup()
    for (const name of ['Dashboard', 'Test Cases', 'Runs', 'Defects']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: /More/ })).toBeInTheDocument()
  })

  it('drops a tab whose sidebar entry is hidden and keeps the rest', () => {
    config = { ...DEFAULT_WORKSPACE_CONFIG, sidebar: { order: [], hidden: ['defects', 'test-runs'] } }
    setup()
    expect(screen.queryByRole('link', { name: 'Defects' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Runs' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Test Cases' })).toBeInTheDocument()
    expect(screen.getByTestId('tab-indicator').getAttribute('style')).toContain('0.5rem')
  })
})
