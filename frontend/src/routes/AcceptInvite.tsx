import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'

import { acceptInvite } from '@/api/users'
import { ApiError } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Tier 1 / ADR-053 (SR-2.4/5.11, SAAS-GAP-8): public, unauthenticated --
// the token itself (an unguessable secret, hashed at rest server-side) is
// the only credential needed to reach this page.
export function AcceptInvite() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')

  const acceptMutation = useMutation({
    mutationFn: () => acceptInvite(token ?? '', password),
  })

  const error = acceptMutation.error instanceof ApiError ? acceptMutation.error.message : null

  useEffect(() => {
    if (!acceptMutation.isSuccess) return
    // Give the "activated" confirmation a moment on screen rather than
    // navigating away in the same tick the mutation resolves.
    const timer = setTimeout(() => navigate('/login', { replace: true }), 1500)
    return () => clearTimeout(timer)
  }, [acceptMutation.isSuccess, navigate])

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-base text-[var(--foreground)]">Accept Invite</CardTitle>
          <p className="text-sm text-[var(--muted-foreground)]">
            Set your password to activate your QTestHub account.
          </p>
        </CardHeader>
        <CardContent>
          {acceptMutation.isSuccess ? (
            <p className="text-sm text-[var(--status-good)]">
              Account activated. Redirecting to sign in…
            </p>
          ) : (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                acceptMutation.mutate()
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="accept-password">New Password</Label>
                <Input
                  id="accept-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <p className="text-xs text-[var(--muted-foreground)]">
                  At least 12 characters, with an uppercase letter, a lowercase letter, and a
                  digit.
                </p>
              </div>
              {error && <p className="text-xs text-[var(--destructive)]">{error}</p>}
              <Button type="submit" disabled={acceptMutation.isPending || !token}>
                {acceptMutation.isPending ? 'Activating…' : 'Activate Account'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
