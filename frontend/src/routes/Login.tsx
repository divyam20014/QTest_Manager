import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'

import { login, verifyMfa } from '@/api/auth'
import { API_BASE_URL, ApiError } from '@/api/client'
import { getSsoStatus } from '@/api/sso'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/auth'

const credentialsSchema = z.object({
  tenant_id: z.string().uuid('Enter a valid tenant id (UUID)'),
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
})
type CredentialsForm = z.infer<typeof credentialsSchema>

const codeSchema = z.object({ code: z.string().length(6, 'Enter the 6-digit code') })
type CodeForm = z.infer<typeof codeSchema>

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function Login() {
  const [step, setStep] = useState<'credentials' | 'mfa'>('credentials')
  const [debugCode, setDebugCode] = useState<string | null>(null)
  const navigate = useNavigate()
  const { refresh } = useAuth()

  const credentialsForm = useForm<CredentialsForm>({ resolver: zodResolver(credentialsSchema) })
  const codeForm = useForm<CodeForm>({ resolver: zodResolver(codeSchema) })
  const tenantIdValue = credentialsForm.watch('tenant_id')

  const ssoStatusMutation = useMutation({
    mutationFn: (tenantId: string) => getSsoStatus(tenantId),
    onSuccess: (status, tenantId) => {
      if (status.enabled) {
        // Tier 4 / ADR-054: a real browser redirect, not an API fetch --
        // the OIDC authorization-code flow needs the user's own browser
        // to visit the identity provider.
        window.location.href = `${API_BASE_URL}/auth/sso/${tenantId}/login`
      }
    },
  })

  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: (data) => {
      setDebugCode(data.debug_code ?? null)
      setStep('mfa')
    },
  })

  const verifyMutation = useMutation({
    mutationFn: (code: string) => verifyMfa(code),
    onSuccess: async () => {
      await refresh()
      navigate('/', { replace: true })
    },
  })

  const credentialsError =
    loginMutation.error instanceof ApiError ? loginMutation.error.message : null
  const codeError = verifyMutation.error instanceof ApiError ? verifyMutation.error.message : null

  return (
    <div className="flex min-h-svh flex-col items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-base text-[var(--foreground)]">QTestHub</CardTitle>
          <p className="text-sm text-[var(--muted-foreground)]">
            {step === 'credentials' ? 'Sign in to your organization' : 'Enter your verification code'}
          </p>
        </CardHeader>
        <CardContent>
          {step === 'credentials' ? (
            <form
              className="flex flex-col gap-4"
              onSubmit={credentialsForm.handleSubmit((values) => loginMutation.mutate(values))}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tenant_id">Tenant ID</Label>
                <Input id="tenant_id" {...credentialsForm.register('tenant_id')} />
                {credentialsForm.formState.errors.tenant_id && (
                  <p className="text-xs text-[var(--destructive)]">
                    {credentialsForm.formState.errors.tenant_id.message}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" {...credentialsForm.register('email')} />
                {credentialsForm.formState.errors.email && (
                  <p className="text-xs text-[var(--destructive)]">
                    {credentialsForm.formState.errors.email.message}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" {...credentialsForm.register('password')} />
              </div>
              {credentialsError && <p className="text-xs text-[var(--destructive)]">{credentialsError}</p>}
              <Button type="submit" disabled={loginMutation.isPending}>
                {loginMutation.isPending ? 'Signing in…' : 'Sign in'}
              </Button>
              {UUID_PATTERN.test(tenantIdValue ?? '') && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={ssoStatusMutation.isPending}
                  onClick={() => ssoStatusMutation.mutate(tenantIdValue)}
                >
                  Sign in with SSO
                </Button>
              )}
              {ssoStatusMutation.isSuccess && !ssoStatusMutation.data.enabled && (
                <p className="text-xs text-[var(--muted-foreground)]">
                  SSO is not configured for this organization.
                </p>
              )}
            </form>
          ) : (
            <form
              className="flex flex-col gap-4"
              onSubmit={codeForm.handleSubmit((values) => verifyMutation.mutate(values.code))}
            >
              {debugCode && (
                <p className="rounded bg-[var(--muted)] p-2 text-xs text-[var(--muted-foreground)]">
                  Dev mode code: <span className="font-mono">{debugCode}</span>
                </p>
              )}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="code">Verification code</Label>
                <Input id="code" inputMode="numeric" maxLength={6} {...codeForm.register('code')} />
                {codeForm.formState.errors.code && (
                  <p className="text-xs text-[var(--destructive)]">{codeForm.formState.errors.code.message}</p>
                )}
              </div>
              {codeError && <p className="text-xs text-[var(--destructive)]">{codeError}</p>}
              <Button type="submit" disabled={verifyMutation.isPending}>
                {verifyMutation.isPending ? 'Verifying…' : 'Verify'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setStep('credentials')}>
                Back
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
      <p className="mt-4 text-center text-xs text-[var(--muted-foreground)]">
        <a href="/platform-admin" className="hover:text-[var(--foreground)]">
          Platform Administrator sign-in
        </a>
      </p>
    </div>
  )
}
