import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthProvider } from '@/lib/auth'
import { Login } from './Login'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'

function renderLogin() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <Login />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Login', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.endsWith('/auth/me')) {
          return {
            ok: false,
            json: async () => ({ data: null, error: { code: 'unauthorized', message: 'Not authenticated' } }),
          } as Response
        }
        if (url.endsWith('/auth/login')) {
          expect(JSON.parse(init?.body as string)).toMatchObject({ tenant_id: TENANT_ID })
          return { ok: true, json: async () => ({ data: { mfa_required: true, debug_code: '123456' }, error: null }) } as Response
        }
        throw new Error(`Unexpected fetch to ${url}`)
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('submits credentials and advances to the MFA step', async () => {
    const user = userEvent.setup()
    renderLogin()

    await waitFor(() => expect(screen.getByLabelText('Tenant ID')).toBeInTheDocument())

    await user.type(screen.getByLabelText('Tenant ID'), TENANT_ID)
    await user.type(screen.getByLabelText('Email'), 'admin@horizon.com')
    await user.type(screen.getByLabelText('Password'), 'AdminPassw0rd!')
    // Exact match: a valid-looking tenant id also makes the separate
    // "Sign in with SSO" button render (Tier 4 / ADR-054), which a loose
    // /sign in/i regex would ambiguously match too.
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText(/enter your verification code/i)).toBeInTheDocument()
    expect(await screen.findByText('123456')).toBeInTheDocument()
  })
})
