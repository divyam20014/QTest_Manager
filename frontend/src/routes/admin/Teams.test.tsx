// ADR-141: the team form, and the message after adding a team to a project.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { describeTeamAdd, type Team } from '@/api/teams'
import { ToastProvider } from '@/lib/toast'

import { TeamForm } from './Teams'

const updateTeam = vi.fn()
vi.mock('@/api/teams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/teams')>()),
  updateTeam: (...args: unknown[]) => updateTeam(...args),
}))
vi.mock('@/api/users', () => ({
  listUsers: () =>
    Promise.resolve([
      { id: 'u1', name: 'Ana', is_active: true },
      { id: 'u2', name: 'Ben', is_active: true },
      { id: 'u3', name: 'Cal', is_active: false },
      { id: 'u4', name: 'Dee', is_active: false },
    ]),
}))

const team: Team = {
  id: 't1',
  name: 'Payments',
  lead_user_id: null,
  lead_name: null,
  members: [
    { user_id: 'u1', name: 'Ana', is_active: true },
    { user_id: 'u3', name: 'Cal', is_active: false },
  ],
}

describe('TeamForm', () => {
  it('shows inactive members so they can be removed, and saves the chosen list', async () => {
    const user = userEvent.setup()
    updateTeam.mockResolvedValue(team)
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <TeamForm team={team} onDone={() => {}} />
        </ToastProvider>
      </QueryClientProvider>,
    )

    const cal = await screen.findByRole('checkbox', { name: /Cal/ })
    expect(cal).toBeChecked()
    // Someone inactive who is not in the team is not offered.
    expect(screen.queryByRole('checkbox', { name: /Dee/ })).toBeNull()
    await user.click(cal)
    await user.click(screen.getByRole('checkbox', { name: 'Ben' }))
    await user.click(screen.getByRole('button', { name: 'Save team' }))

    await waitFor(() =>
      expect(updateTeam).toHaveBeenCalledWith('t1', { name: 'Payments', lead_user_id: null, member_ids: ['u1', 'u2'] }),
    )
  }, 30_000)
})

describe('describeTeamAdd', () => {
  it('says what happened, leaving out what did not', () => {
    expect(describeTeamAdd({ added: 1, already_members: 0, skipped_inactive: 0 })).toBe('1 member added')
    expect(describeTeamAdd({ added: 0, already_members: 2, skipped_inactive: 1 })).toBe(
      '0 members added, 2 already on the project, 1 inactive skipped',
    )
  })
})
