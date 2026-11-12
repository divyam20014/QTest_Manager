import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthProvider } from '@/lib/auth'
import { Login } from './Login'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID_B = '22222222-2222-4222-8222-222222222222'

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

function stubFetch(
  handlers: Partial<Record<'identify' | 'login' | 'ssoStatus', (init?: RequestInit) => Response | Promise<Response>>>,
) {
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
      if (url.endsWith('/auth/identify') && handlers.identify) {
        return handlers.identify(init)
      }
      if (url.endsWith('/auth/login') && handlers.login) {
        return handlers.login(init)
      }
      if (url.includes('/auth/sso/') && url.endsWith('/status') && handlers.ssoStatus) {
        return handlers.ssoStatus(init)
      }
      throw new Error(`Unexpected fetch to ${url}`)
    }),
  )
}

describe('Login', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('resolves a single-tenant email, then submits credentials and advances to MFA', async () => {
    const user = userEvent.setup()
    stubFetch({
      identify: async () =>
        ({
          ok: true,
          json: async () => ({
            data: { matches: [{ tenant_id: TENANT_ID, tenant_name: 'Horizon Mutual' }] },
            error: null,
          }),
        }) as Response,
      login: async (init) => {
        expect(JSON.parse(init?.body as string)).toMatchObject({
          tenant_id: TENANT_ID,
          email: 'admin@horizon.com',
        })
        return {
          ok: true,
          json: async () => ({ data: { mfa_required: true, debug_code: '123456' }, error: null }),
        } as Response
      },
    })
    renderLogin()

    await waitFor(() => expect(screen.getByLabelText('Email')).toBeInTheDocument())
    await user.type(screen.getByLabelText('Email'), 'admin@horizon.com')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText(/signing in to/i)).toBeInTheDocument()
    expect(screen.getByText('Horizon Mutual')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Password'), 'AdminPassw0rd!')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText(/enter your verification code/i)).toBeInTheDocument()
    expect(await screen.findByText('123456')).toBeInTheDocument()
  })

  it('shows an organization picker when the email matches more than one tenant', async () => {
    const user = userEvent.setup()
    stubFetch({
      identify: async () =>
        ({
          ok: true,
          json: async () => ({
            data: {
              matches: [
                { tenant_id: TENANT_ID, tenant_name: 'Tenant A' },
                { tenant_id: TENANT_ID_B, tenant_name: 'Tenant B' },
              ],
            },
            error: null,
          }),
        }) as Response,
    })
    renderLogin()

    await waitFor(() => expect(screen.getByLabelText('Email')).toBeInTheDocument())
    await user.type(screen.getByLabelText('Email'), 'shared@example.com')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText(/choose which one to sign in to/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tenant A' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tenant B' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Tenant B' }))
    expect(await screen.findByLabelText('Password')).toBeInTheDocument()
  })

  it('shows a generic error when the email matches no tenant, never a distinct message', async () => {
    const user = userEvent.setup()
    stubFetch({
      identify: async () =>
        ({ ok: true, json: async () => ({ data: { matches: [] }, error: null }) }) as Response,
    })
    renderLogin()

    await waitFor(() => expect(screen.getByLabelText('Email')).toBeInTheDocument())
    await user.type(screen.getByLabelText('Email'), 'nobody@example.com')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument()
    // Stays on the email step -- there is no tenant to log into.
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
  })

  it('skips the identify call on a remembered tenant for the same email', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      'qth_remembered_tenants',
      JSON.stringify({ 'admin@horizon.com': { tenantId: TENANT_ID, tenantName: 'Horizon Mutual' } }),
    )
    const identifySpy = vi.fn()
    stubFetch({ identify: identifySpy })
    renderLogin()

    await waitFor(() => expect(screen.getByLabelText('Email')).toBeInTheDocument())
    await user.type(screen.getByLabelText('Email'), 'admin@horizon.com')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByLabelText('Password')).toBeInTheDocument()
    expect(identifySpy).not.toHaveBeenCalled()
  })

  it('"switch organization" clears the remembered tenant and re-resolves', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      'qth_remembered_tenants',
      JSON.stringify({ 'admin@horizon.com': { tenantId: TENANT_ID, tenantName: 'Stale Org' } }),
    )
    stubFetch({
      identify: async () =>
        ({
          ok: true,
          json: async () => ({
            data: { matches: [{ tenant_id: TENANT_ID_B, tenant_name: 'Correct Org' }] },
            error: null,
          }),
        }) as Response,
    })
    renderLogin()

    await waitFor(() => expect(screen.getByLabelText('Email')).toBeInTheDocument())
    await user.type(screen.getByLabelText('Email'), 'admin@horizon.com')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('Stale Org')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /switch organization/i }))

    expect(await screen.findByText('Correct Org')).toBeInTheDocument()
  })
})
