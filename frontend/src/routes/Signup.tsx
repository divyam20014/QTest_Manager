import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'

import { signup } from '@/api/auth'
import { TENANT_DOMAINS, tenantDomainLabel, type TenantDomain } from '@/api/projects'
import { ApiError } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PasswordInput, PasswordStrengthMeter } from '@/components/ui/password-input'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { FormError } from '@/components/ui/form-field'

// Pass 2 (ADR-064): public, unauthenticated -- creating the tenant IS the
// thing that happens here, there's no session to require yet. The new
// admin still goes through the ordinary login+MFA flow afterward on the
// Login page -- MFA is never bypassed for onboarding convenience.
export function Signup() {
  const navigate = useNavigate()
  const [tenantName, setTenantName] = useState('')
  const [adminName, setAdminName] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [primaryDomain, setPrimaryDomain] = useState<TenantDomain | ''>('')

  const signupMutation = useMutation({
    mutationFn: () =>
      signup({
        tenant_name: tenantName,
        admin_name: adminName,
        admin_email: adminEmail,
        admin_password: adminPassword,
        ...(primaryDomain ? { primary_domain: primaryDomain } : {}),
      }),
    onSuccess: () => {
      setTimeout(() => navigate('/login', { replace: true }), 1800)
    },
  })

  const error = signupMutation.error instanceof ApiError ? signupMutation.error.message : null

  return (
    <main id="main-content" className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle as="h1" className="text-base text-[var(--foreground)]">
            Start your free trial
          </CardTitle>
          <p className="text-sm text-[var(--muted-foreground)]">
            Your organization starts on the Trial plan with a sample project already set up — no payment required.
          </p>
        </CardHeader>
        <CardContent>
          {signupMutation.isSuccess ? (
            <p className="text-sm text-[var(--status-good)]">Account created. Redirecting to sign in…</p>
          ) : (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                signupMutation.mutate()
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="signup-tenant">Organization Name</Label>
                <Input
                  id="signup-tenant"
                  autoComplete="organization"
                  value={tenantName}
                  onChange={(e) => setTenantName(e.target.value)}
                  required
                  minLength={3}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="signup-domain">
                  Insurance Domain <span className="font-normal text-[var(--muted-foreground)]">(optional)</span>
                </Label>
                <Select
                  id="signup-domain"
                  value={primaryDomain}
                  onChange={(e) => setPrimaryDomain(e.target.value as TenantDomain | '')}
                  aria-describedby="signup-domain-help"
                >
                  <option value="">Not specified</option>
                  {TENANT_DOMAINS.map((d) => (
                    <option key={d} value={d}>
                      {tenantDomainLabel(d)}
                    </option>
                  ))}
                </Select>
                <p id="signup-domain-help" className="text-xs text-[var(--muted-foreground)]">
                  Your main line of insurance. It only pre-selects the domain on new projects, and you can change it
                  later in Settings.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="signup-name">Your Name</Label>
                <Input
                  id="signup-name"
                  autoComplete="name"
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="signup-email">Work Email</Label>
                <Input
                  id="signup-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="off"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="signup-password">Password</Label>
                <PasswordInput
                  id="signup-password"
                  autoComplete="new-password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  required
                />
                <p className="text-xs text-[var(--muted-foreground)]">
                  At least 12 characters, with an uppercase letter, a lowercase letter, and a digit.
                </p>
                <PasswordStrengthMeter value={adminPassword} />
              </div>
              <FormError>{error}</FormError>
              <Button type="submit" loading={signupMutation.isPending}>
                {signupMutation.isPending ? 'Creating your organization…' : 'Create Account'}
              </Button>
            </form>
          )}
          <p className="mt-4 text-center text-xs text-[var(--muted-foreground)]">
            Already have an account?{' '}
            <Link to="/login" className="underline hover:text-[var(--foreground)]">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
