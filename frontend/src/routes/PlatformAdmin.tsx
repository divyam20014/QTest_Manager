import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError } from '@/api/client'
import {
  createTenant,
  listTenants,
  updateTenantStatus,
  type PlatformCredentials,
  type Tenant,
} from '@/api/platformAdmin'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Platform Administration manages tenant lifecycle (create/approve/suspend)
// and is intentionally separate from the tenant app's own auth/RBAC
// (ADR-008): a different identity (platform_admins), HTTP Basic, never a
// session cookie. This screen is not linked from the main app shell/nav --
// reachable only via its own URL, matching that separation.
export function PlatformAdmin() {
  const [credentials, setCredentials] = useState<PlatformCredentials | null>(null)

  return credentials ? (
    <TenantConsole credentials={credentials} onSignOut={() => setCredentials(null)} />
  ) : (
    <SignInForm onSignedIn={setCredentials} />
  )
}

function SignInForm({ onSignedIn }: { onSignedIn: (c: PlatformCredentials) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const verifyMutation = useMutation({
    mutationFn: (c: PlatformCredentials) => listTenants(c),
    onSuccess: (_data, c) => onSignedIn(c),
  })

  const error = verifyMutation.error instanceof ApiError ? verifyMutation.error.message : null

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-base text-[var(--foreground)]">Platform Administration</CardTitle>
          <p className="text-sm text-[var(--muted-foreground)]">
            Separate from tenant sign-in — for provisioning and tenant lifecycle only.
          </p>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              verifyMutation.mutate({ email, password })
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="platform-email">Email</Label>
              <Input
                id="platform-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="platform-password">Password</Label>
              <Input
                id="platform-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && <p className="text-xs text-[var(--destructive)]">{error}</p>}
            <Button type="submit" disabled={verifyMutation.isPending}>
              {verifyMutation.isPending ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

const STATUS_TONE: Record<Tenant['status'], 'positive' | 'neutral' | 'critical'> = {
  approved: 'positive',
  pending: 'neutral',
  suspended: 'critical',
}

function TenantConsole({
  credentials,
  onSignOut,
}: {
  credentials: PlatformCredentials
  onSignOut: () => void
}) {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const tenantsQuery = useQuery({
    queryKey: ['platform-tenants'],
    queryFn: () => listTenants(credentials),
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Tenant['status'] }) =>
      updateTenantStatus(credentials, id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['platform-tenants'] }),
  })

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Platform Administration</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Signed in as {credentials.email}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            New Tenant
          </Button>
          <Button variant="outline" size="sm" onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--muted)] text-left text-xs text-[var(--muted-foreground)]">
            <tr>
              <th className="px-4 py-2 font-medium">Tenant</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Created</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {tenantsQuery.data?.map((t) => (
              <tr key={t.id} className="border-t border-[var(--border)]">
                <td className="px-4 py-2">
                  <div className="font-medium">{t.name}</div>
                  <div className="font-mono text-xs text-[var(--muted-foreground)]">{t.id}</div>
                </td>
                <td className="px-4 py-2">
                  <Badge tone={STATUS_TONE[t.status]}>{t.status}</Badge>
                </td>
                <td className="px-4 py-2 text-[var(--muted-foreground)]">
                  {new Date(t.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="flex justify-end gap-2">
                    {t.status !== 'approved' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => statusMutation.mutate({ id: t.id, status: 'approved' })}
                      >
                        Approve
                      </Button>
                    )}
                    {t.status !== 'suspended' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => statusMutation.mutate({ id: t.id, status: 'suspended' })}
                      >
                        Suspend
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <NewTenantDialog
        credentials={credentials}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  )
}

function NewTenantDialog({
  credentials,
  open,
  onClose,
}: {
  credentials: PlatformCredentials
  open: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [tenantName, setTenantName] = useState('')
  const [adminName, setAdminName] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')

  const createMutation = useMutation({
    mutationFn: () =>
      createTenant(credentials, {
        tenant_name: tenantName,
        admin_name: adminName,
        admin_email: adminEmail,
        admin_password: adminPassword,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-tenants'] })
      setTenantName('')
      setAdminName('')
      setAdminEmail('')
      setAdminPassword('')
      onClose()
    },
  })

  const serverError = createMutation.error instanceof ApiError ? createMutation.error.message : null

  return (
    <Dialog open={open} onClose={onClose} title="New Tenant">
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tenant-name">Tenant Name</Label>
          <Input id="tenant-name" value={tenantName} onChange={(e) => setTenantName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="admin-name">First Admin — Name</Label>
          <Input id="admin-name" value={adminName} onChange={(e) => setAdminName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="admin-email">First Admin — Email</Label>
          <Input
            id="admin-email"
            type="email"
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="admin-password">First Admin — Temporary Password</Label>
          <Input
            id="admin-password"
            type="password"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
          />
          <p className="text-xs text-[var(--muted-foreground)]">
            At least 12 characters, with an uppercase letter, a lowercase letter, and a digit.
          </p>
        </div>
        {serverError && <p className="text-xs text-[var(--destructive)]">{serverError}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? 'Creating…' : 'Create Tenant'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
