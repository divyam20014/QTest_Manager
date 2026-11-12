import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'

import { identify, login, verifyMfa } from '@/api/auth'
import { API_BASE_URL, ApiError } from '@/api/client'
import { getSsoStatus } from '@/api/sso'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/auth'

// ADR-067: tenant-less login. "remember last tenant" is keyed per-email
// (lowercased) in a single JSON blob rather than one localStorage key per
// email -- different emails can belong to different tenants on a shared
// device, but scanning/managing many discrete keys buys nothing a single
// parsed object doesn't already give.
const REMEMBERED_TENANTS_KEY = 'qth_remembered_tenants'

interface RememberedTenant {
  tenantId: string
  tenantName: string
}

function readRememberedTenant(email: string): RememberedTenant | null {
  try {
    const raw = localStorage.getItem(REMEMBERED_TENANTS_KEY)
    if (!raw) return null
    const all = JSON.parse(raw) as Record<string, RememberedTenant>
    return all[email.toLowerCase()] ?? null
  } catch {
    return null
  }
}

function rememberTenant(email: string, tenant: RememberedTenant): void {
  try {
    const raw = localStorage.getItem(REMEMBERED_TENANTS_KEY)
    const all = raw ? (JSON.parse(raw) as Record<string, RememberedTenant>) : {}
    all[email.toLowerCase()] = tenant
    localStorage.setItem(REMEMBERED_TENANTS_KEY, JSON.stringify(all))
  } catch {
    // localStorage unavailable (private window, blocked site data, etc.) --
    // this is a pure UX convenience, never required for login to work.
  }
}

function forgetRememberedTenant(email: string): void {
  try {
    const raw = localStorage.getItem(REMEMBERED_TENANTS_KEY)
    if (!raw) return
    const all = JSON.parse(raw) as Record<string, RememberedTenant>
    delete all[email.toLowerCase()]
    localStorage.setItem(REMEMBERED_TENANTS_KEY, JSON.stringify(all))
  } catch {
    // Same as above -- best-effort only.
  }
}

const emailSchema = z.object({ email: z.string().email() })
type EmailForm = z.infer<typeof emailSchema>

const passwordSchema = z.object({ password: z.string().min(1, 'Password is required') })
type PasswordForm = z.infer<typeof passwordSchema>

const codeSchema = z.object({ code: z.string().length(6, 'Enter the 6-digit code') })
type CodeForm = z.infer<typeof codeSchema>

// Generic on purpose (ADR-067/ADR-017): must never read differently than a
// wrong-password response, so the UI layer can't be used to enumerate
// registered emails any more than the network layer already can't.
const GENERIC_IDENTIFY_ERROR = 'Invalid email or password'

type Step = 'email' | 'org-picker' | 'password' | 'mfa'

export function Login() {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [tenantMatches, setTenantMatches] = useState<{ tenant_id: string; tenant_name: string }[]>([])
  const [resolvedTenant, setResolvedTenant] = useState<RememberedTenant | null>(null)
  const [identifyError, setIdentifyError] = useState<string | null>(null)
  const [debugCode, setDebugCode] = useState<string | null>(null)
  const navigate = useNavigate()
  const { refresh } = useAuth()

  const emailForm = useForm<EmailForm>({ resolver: zodResolver(emailSchema) })
  const passwordForm = useForm<PasswordForm>({ resolver: zodResolver(passwordSchema) })
  const codeForm = useForm<CodeForm>({ resolver: zodResolver(codeSchema) })

  const identifyMutation = useMutation({
    mutationFn: identify,
    onSuccess: (data, submittedEmail) => {
      if (data.matches.length === 0) {
        setIdentifyError(GENERIC_IDENTIFY_ERROR)
        return
      }
      setIdentifyError(null)
      if (data.matches.length === 1) {
        const match = data.matches[0]
        const tenant = { tenantId: match.tenant_id, tenantName: match.tenant_name }
        setResolvedTenant(tenant)
        rememberTenant(submittedEmail, tenant)
        setStep('password')
      } else {
        setTenantMatches(data.matches)
        setStep('org-picker')
      }
    },
    onError: () => {
      // Network/server error -- same generic copy, never a distinct message.
      setIdentifyError(GENERIC_IDENTIFY_ERROR)
    },
  })

  const ssoStatusMutation = useMutation({
    mutationFn: (tenantId: string) => getSsoStatus(tenantId),
    onSuccess: (status, tenantId) => {
      if (status.enabled) {
        // Tier 4 / ADR-054: a real browser redirect, not an API fetch -- the
        // OIDC authorization-code flow needs the user's own browser to visit
        // the identity provider.
        window.location.href = `${API_BASE_URL}/auth/sso/${tenantId}/login`
      }
    },
  })

  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: (data) => {
      setDebugCode(data.debug_code ?? null)
      // Belt-and-suspenders against the "prefilled code" report -- genuinely
      // blank on every entry into this step, not whatever a previous
      // attempt (or aggressive browser autofill) left behind.
      codeForm.reset({ code: '' })
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

  function submitEmail(values: EmailForm) {
    setEmail(values.email)
    const remembered = readRememberedTenant(values.email)
    if (remembered) {
      setResolvedTenant(remembered)
      setIdentifyError(null)
      setStep('password')
      return
    }
    identifyMutation.mutate(values.email)
  }

  function pickTenant(match: { tenant_id: string; tenant_name: string }) {
    const tenant = { tenantId: match.tenant_id, tenantName: match.tenant_name }
    setResolvedTenant(tenant)
    rememberTenant(email, tenant)
    setStep('password')
  }

  function switchOrganization() {
    forgetRememberedTenant(email)
    setResolvedTenant(null)
    setIdentifyError(null)
    passwordForm.reset({ password: '' })
    identifyMutation.mutate(email)
  }

  function backToEmail() {
    setStep('email')
    setIdentifyError(null)
    passwordForm.reset({ password: '' })
  }

  const credentialsError =
    loginMutation.error instanceof ApiError ? loginMutation.error.message : null
  const codeError = verifyMutation.error instanceof ApiError ? verifyMutation.error.message : null

  return (
    <div className="flex min-h-svh flex-col items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-base text-[var(--foreground)]">QTestHub</CardTitle>
          <p className="text-sm text-[var(--muted-foreground)]">
            {step === 'email' && 'Sign in to your organization'}
            {step === 'org-picker' && 'Choose your organization'}
            {step === 'password' && 'Enter your password'}
            {step === 'mfa' && 'Enter your verification code'}
          </p>
        </CardHeader>
        <CardContent>
          {step === 'email' && (
            <form
              className="flex flex-col gap-4"
              onSubmit={emailForm.handleSubmit(submitEmail)}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoFocus {...emailForm.register('email')} />
                {emailForm.formState.errors.email && (
                  <p className="text-xs text-[var(--destructive)]">
                    {emailForm.formState.errors.email.message}
                  </p>
                )}
              </div>
              {identifyError && <p className="text-xs text-[var(--destructive)]">{identifyError}</p>}
              <Button type="submit" disabled={identifyMutation.isPending}>
                {identifyMutation.isPending ? 'Checking…' : 'Continue'}
              </Button>
            </form>
          )}

          {step === 'org-picker' && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-[var(--muted-foreground)]">
                {email} is used in more than one organization. Choose which one to sign in to.
              </p>
              {tenantMatches.map((match) => (
                <Button
                  key={match.tenant_id}
                  type="button"
                  variant="outline"
                  className="justify-start"
                  onClick={() => pickTenant(match)}
                >
                  {match.tenant_name}
                </Button>
              ))}
              <Button type="button" variant="ghost" onClick={backToEmail}>
                Back
              </Button>
            </div>
          )}

          {step === 'password' && resolvedTenant && (
            <form
              className="flex flex-col gap-4"
              onSubmit={passwordForm.handleSubmit((values) =>
                loginMutation.mutate({
                  tenant_id: resolvedTenant.tenantId,
                  email,
                  password: values.password,
                })
              )}
            >
              <p className="text-xs text-[var(--muted-foreground)]">
                Signing in to <span className="font-medium">{resolvedTenant.tenantName}</span> as{' '}
                {email}.{' '}
                <button
                  type="button"
                  className="underline hover:text-[var(--foreground)]"
                  onClick={switchOrganization}
                >
                  Not you? Switch organization
                </button>
              </p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoFocus
                  {...passwordForm.register('password')}
                />
              </div>
              {credentialsError && <p className="text-xs text-[var(--destructive)]">{credentialsError}</p>}
              <Button type="submit" disabled={loginMutation.isPending}>
                {loginMutation.isPending ? 'Signing in…' : 'Sign in'}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={ssoStatusMutation.isPending}
                onClick={() => ssoStatusMutation.mutate(resolvedTenant.tenantId)}
              >
                Sign in with SSO
              </Button>
              {ssoStatusMutation.isSuccess && !ssoStatusMutation.data.enabled && (
                <p className="text-xs text-[var(--muted-foreground)]">
                  SSO is not configured for this organization.
                </p>
              )}
              <Button type="button" variant="ghost" onClick={backToEmail}>
                Back
              </Button>
            </form>
          )}

          {step === 'mfa' && (
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
                <Input
                  id="code"
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  {...codeForm.register('code')}
                />
                {codeForm.formState.errors.code && (
                  <p className="text-xs text-[var(--destructive)]">{codeForm.formState.errors.code.message}</p>
                )}
              </div>
              {codeError && <p className="text-xs text-[var(--destructive)]">{codeError}</p>}
              <Button type="submit" disabled={verifyMutation.isPending}>
                {verifyMutation.isPending ? 'Verifying…' : 'Verify'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  codeForm.reset({ code: '' })
                  setStep('email')
                }}
              >
                Back
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
      <p className="mt-4 text-center text-xs text-[var(--muted-foreground)]">
        New here?{' '}
        <a href="/signup" className="underline hover:text-[var(--foreground)]">
          Start a free trial
        </a>
      </p>
      <p className="mt-2 text-center text-xs text-[var(--muted-foreground)]">
        <a href="/platform-admin" className="hover:text-[var(--foreground)]">
          Platform Administrator sign-in
        </a>
      </p>
    </div>
  )
}
