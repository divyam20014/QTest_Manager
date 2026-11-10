import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError } from '@/api/client'
import {
  assignTenantSubscription,
  createTenant,
  listPlans,
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
import { Select } from '@/components/ui/select'

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
  const [planTarget, setPlanTarget] = useState<Tenant | null>(null)
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

      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
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
                    <Button variant="outline" size="sm" onClick={() => setPlanTarget(t)}>
                      Plan
                    </Button>
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
      <PlanDialog credentials={credentials} tenant={planTarget} onClose={() => setPlanTarget(null)} />
    </div>
  )
}

// Tier 1 / ADR-053: schema/record-keeping only -- no payment gateway, no
// billing engine.
function PlanDialog({
  credentials,
  tenant,
  onClose,
}: {
  credentials: PlatformCredentials
  tenant: Tenant | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [planCode, setPlanCode] = useState('')
  const [status, setStatus] = useState<'trialing' | 'active' | 'past_due' | 'canceled'>('active')
  const [seatCount, setSeatCount] = useState(1)

  const plansQuery = useQuery({
    queryKey: ['platform-plans'],
    queryFn: () => listPlans(credentials),
    enabled: !!tenant,
  })

  const assignMutation = useMutation({
    mutationFn: () =>
      assignTenantSubscription(credentials, tenant!.id, {
        plan_code: planCode,
        status,
        seat_count: seatCount,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-tenants'] })
      onClose()
    },
  })

  const serverError = assignMutation.error instanceof ApiError ? assignMutation.error.message : null

  if (!tenant) return null

  return (
    <Dialog open={!!tenant} onClose={onClose} title={`Subscription — ${tenant.name}`}>
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="plan-code">Plan</Label>
          <Select id="plan-code" value={planCode} onChange={(e) => setPlanCode(e.target.value)}>
            <option value="">Select a plan…</option>
            {plansQuery.data?.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="plan-status">Status</Label>
          <Select
            id="plan-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            <option value="trialing">Trialing</option>
            <option value="active">Active</option>
            <option value="past_due">Past Due</option>
            <option value="canceled">Canceled</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="plan-seats">Seat Count</Label>
          <Input
            id="plan-seats"
            type="number"
            min={1}
            value={seatCount}
            onChange={(e) => setSeatCount(Number(e.target.value))}
          />
        </div>
        {serverError && <p className="text-xs text-[var(--destructive)]">{serverError}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!planCode || assignMutation.isPending}
            onClick={() => assignMutation.mutate()}
          >
            {assignMutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Dialog>
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
