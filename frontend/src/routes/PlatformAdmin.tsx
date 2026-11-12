import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, CheckCircle2, Clock, PauseCircle, ShieldCheck, ShieldOff } from 'lucide-react'

import { ApiError } from '@/api/client'
import {
  assignTenantSubscription,
  createPlatformAdmin,
  createTenant,
  listPlans,
  listPlatformAdmins,
  listTenants,
  updatePlatformAdminActive,
  updateTenantDataRegion,
  updateTenantStatus,
  type PlatformAdminAccount,
  type PlatformCredentials,
  type Tenant,
  type TenantStatus,
} from '@/api/platformAdmin'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Tabs } from '@/components/ui/tabs'
import { useToast } from '@/lib/toast'

// Platform Administration manages tenant lifecycle (create/approve/suspend/
// deactivate) and platform admin accounts, deliberately separate from the
// tenant app's own auth/RBAC (ADR-008): a different identity
// (platform_admins), HTTP Basic, never a session cookie. This screen is not
// linked from the main app shell/nav -- reachable only via its own URL,
// matching that separation.
export function PlatformAdmin() {
  const [credentials, setCredentials] = useState<PlatformCredentials | null>(null)

  return credentials ? (
    <AdminConsole credentials={credentials} onSignOut={() => setCredentials(null)} />
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
                autoComplete="username"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="platform-password">Password</Label>
              <Input
                id="platform-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            {error && (
              <p role="alert" className="text-xs text-[var(--destructive)]">
                {error}
              </p>
            )}
            <Button type="submit" disabled={verifyMutation.isPending}>
              {verifyMutation.isPending ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

const STATUS_TONE: Record<TenantStatus, 'positive' | 'neutral' | 'critical' | 'warning'> = {
  approved: 'positive',
  pending: 'neutral',
  suspended: 'critical',
  inactive: 'warning',
}

const STATUS_ICON: Record<TenantStatus, typeof CheckCircle2> = {
  approved: CheckCircle2,
  pending: Clock,
  suspended: Ban,
  inactive: PauseCircle,
}

function StatusBadge({ status }: { status: TenantStatus }) {
  const Icon = STATUS_ICON[status]
  return (
    <Badge tone={STATUS_TONE[status]} className="gap-1">
      <Icon aria-hidden="true" className="h-3 w-3" />
      {status}
    </Badge>
  )
}

function AdminConsole({
  credentials,
  onSignOut,
}: {
  credentials: PlatformCredentials
  onSignOut: () => void
}) {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Platform Administration</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Signed in as {credentials.email}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onSignOut}>
          Sign out
        </Button>
      </div>

      <Tabs
        defaultKey="tenants"
        items={[
          { key: 'tenants', label: 'Tenants', content: <TenantsPanel credentials={credentials} /> },
          {
            key: 'admins',
            label: 'Platform Admins',
            content: <PlatformAdminsPanel credentials={credentials} />,
          },
        ]}
      />
    </div>
  )
}

// A tiny reusable confirmation dialog built on the shared Dialog (focus
// trap / Escape / return-focus already handled there) -- this app has no
// standalone ConfirmDialog component yet, so this stays local rather than
// introducing a new shared one for a single screen's use.
function ConfirmActionDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive,
  pending,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  destructive?: boolean
  pending: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-[var(--muted-foreground)]">{description}</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant={destructive ? 'destructive' : 'default'}
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

const PAGE_SIZE = 25
const REGION_OPTIONS = ['us', 'eu', 'apac']

function TenantsPanel({ credentials }: { credentials: PlatformCredentials }) {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [planTarget, setPlanTarget] = useState<Tenant | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<{ tenant: Tenant; status: TenantStatus } | null>(
    null,
  )
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<TenantStatus | ''>('')
  const [page, setPage] = useState(1)
  const { show: showToast } = useToast()

  const tenantsQuery = useQuery({
    queryKey: ['platform-tenants', search, statusFilter, page],
    queryFn: () =>
      listTenants(credentials, { search, status: statusFilter, page, page_size: PAGE_SIZE }),
  })

  const total = tenantsQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TenantStatus }) =>
      updateTenantStatus(credentials, id, status),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['platform-tenants'] })
      showToast('success', `Tenant ${vars.status}`)
      setConfirmTarget(null)
    },
    onError: () => showToast('error', 'Could not update that tenant’s status'),
  })

  // Tier 4 / ADR-054: data residency readiness (PV-11.6) -- metadata
  // only, platform-admin-only to change.
  const dataRegionMutation = useMutation({
    mutationFn: ({ id, dataRegion }: { id: string; dataRegion: string }) =>
      updateTenantDataRegion(credentials, id, dataRegion),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-tenants'] })
      showToast('success', 'Data region updated')
    },
    onError: () => showToast('error', 'Could not update the data region'),
  })

  function requestStatusChange(tenant: Tenant, status: TenantStatus) {
    // Approve is a reversible, low-risk transition; suspend/inactive are
    // the ones that immediately log every signed-in user at that tenant
    // out, so those are the ones that get a confirmation step.
    if (status === 'suspended' || status === 'inactive') {
      setConfirmTarget({ tenant, status })
    } else {
      statusMutation.mutate({ id: tenant.id, status })
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tenant-search">Search</Label>
            <Input
              id="tenant-search"
              className="w-56"
              placeholder="Name or tenant ID…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tenant-status-filter">Status</Label>
            <Select
              id="tenant-status-filter"
              className="w-36"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as TenantStatus | '')
                setPage(1)
              }}
            >
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="suspended">Suspended</option>
              <option value="inactive">Inactive</option>
            </Select>
          </div>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          New Tenant
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--muted)] text-left text-xs text-[var(--muted-foreground)]">
            <tr>
              <th className="px-4 py-2 font-medium">Tenant</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Region</th>
              <th className="px-4 py-2 font-medium">Created</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {tenantsQuery.isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-[var(--muted-foreground)]">
                  Loading tenants…
                </td>
              </tr>
            )}
            {!tenantsQuery.isLoading && total === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-[var(--muted-foreground)]">
                  No tenants match your search.
                </td>
              </tr>
            )}
            {tenantsQuery.data?.items.map((t) => (
              <tr key={t.id} className="border-t border-[var(--border)]">
                <td className="px-4 py-2">
                  <div className="font-medium">{t.name}</div>
                  <div className="font-mono text-xs text-[var(--muted-foreground)]">{t.id}</div>
                </td>
                <td className="px-4 py-2">
                  <StatusBadge status={t.status} />
                </td>
                <td className="px-4 py-2">
                  <Select
                    aria-label={`Data region for ${t.name}`}
                    className="h-7 w-24 px-2 py-0.5 text-xs"
                    value={t.data_region}
                    disabled={dataRegionMutation.isPending}
                    onChange={(e) =>
                      dataRegionMutation.mutate({ id: t.id, dataRegion: e.target.value })
                    }
                  >
                    {REGION_OPTIONS.includes(t.data_region) ? null : (
                      <option value={t.data_region}>{t.data_region}</option>
                    )}
                    {REGION_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </Select>
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
                        onClick={() => requestStatusChange(t, 'approved')}
                      >
                        Approve
                      </Button>
                    )}
                    {t.status !== 'inactive' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => requestStatusChange(t, 'inactive')}
                      >
                        Deactivate
                      </Button>
                    )}
                    {t.status !== 'suspended' && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => requestStatusChange(t, 'suspended')}
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

      {total > 0 && (
        <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
          <span>
            Page {page} of {totalPages} ({total} tenant{total === 1 ? '' : 's'})
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage(Math.min(totalPages, page + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <NewTenantDialog
        credentials={credentials}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
      <PlanDialog credentials={credentials} tenant={planTarget} onClose={() => setPlanTarget(null)} />
      {confirmTarget && (
        <ConfirmActionDialog
          open={!!confirmTarget}
          title={`${confirmTarget.status === 'suspended' ? 'Suspend' : 'Deactivate'} ${confirmTarget.tenant.name}?`}
          description={
            confirmTarget.status === 'suspended'
              ? `Every user at ${confirmTarget.tenant.name} will be immediately logged out and blocked from signing in again until this tenant is re-approved. Use this for a compliance or abuse hold.`
              : `Every user at ${confirmTarget.tenant.name} will be immediately logged out and blocked from signing in again until this tenant is re-approved. Use this for routine offboarding (e.g. non-payment), not a compliance hold.`
          }
          confirmLabel={confirmTarget.status === 'suspended' ? 'Suspend tenant' : 'Deactivate tenant'}
          destructive
          pending={statusMutation.isPending}
          onConfirm={() => statusMutation.mutate({ id: confirmTarget.tenant.id, status: confirmTarget.status })}
          onClose={() => setConfirmTarget(null)}
        />
      )}
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
  const { show: showToast } = useToast()

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
      showToast('success', 'Subscription updated')
    },
    // No onError toast -- `serverError` below already renders this inline.
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

const PASSWORD_HINT = 'At least 12 characters, with an uppercase letter, a lowercase letter, and a digit.'

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
  const [dataRegion, setDataRegion] = useState('us')
  const { show: showToast } = useToast()

  const createMutation = useMutation({
    mutationFn: () =>
      createTenant(credentials, {
        tenant_name: tenantName,
        admin_name: adminName,
        admin_email: adminEmail,
        admin_password: adminPassword,
        data_region: dataRegion,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-tenants'] })
      setTenantName('')
      setAdminName('')
      setAdminEmail('')
      setAdminPassword('')
      setDataRegion('us')
      onClose()
      showToast('success', 'Tenant created')
    },
    // No onError toast -- `serverError` below already renders this inline.
  })

  const serverError = createMutation.error instanceof ApiError ? createMutation.error.message : null

  return (
    <Dialog open={open} onClose={onClose} title="New Tenant">
      <form
        className="flex flex-col gap-5 text-sm"
        onSubmit={(e) => {
          e.preventDefault()
          createMutation.mutate()
        }}
      >
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Organization
          </legend>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tenant-name">Tenant Name</Label>
            <Input
              id="tenant-name"
              required
              minLength={3}
              value={tenantName}
              onChange={(e) => setTenantName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="data-region">Data Region</Label>
            <Select
              id="data-region"
              value={dataRegion}
              onChange={(e) => setDataRegion(e.target.value)}
            >
              {REGION_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
            <p className="text-xs text-[var(--muted-foreground)]">
              Readiness metadata only — no per-region deployment exists yet.
            </p>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3 border-t border-[var(--border)] pt-4">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            First Admin Account
          </legend>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="admin-name">Name</Label>
            <Input
              id="admin-name"
              required
              value={adminName}
              onChange={(e) => setAdminName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="admin-email">Email</Label>
            <Input
              id="admin-email"
              type="email"
              required
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="admin-password">Temporary Password</Label>
            <Input
              id="admin-password"
              type="password"
              required
              aria-describedby="admin-password-hint"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
            />
            <p id="admin-password-hint" className="text-xs text-[var(--muted-foreground)]">
              {PASSWORD_HINT}
            </p>
          </div>
        </fieldset>

        {serverError && (
          <p role="alert" className="text-xs text-[var(--destructive)]">
            {serverError}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Creating…' : 'Create Tenant'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

function PlatformAdminsPanel({ credentials }: { credentials: PlatformCredentials }) {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [confirmTarget, setConfirmTarget] = useState<PlatformAdminAccount | null>(null)
  const { show: showToast } = useToast()

  const adminsQuery = useQuery({
    queryKey: ['platform-admins'],
    queryFn: () => listPlatformAdmins(credentials),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      updatePlatformAdminActive(credentials, id, isActive),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['platform-admins'] })
      showToast('success', vars.isActive ? 'Admin reactivated' : 'Admin deactivated')
      setConfirmTarget(null)
    },
    onError: (err) =>
      showToast('error', err instanceof ApiError ? err.message : 'Could not update that admin'),
  })

  const isSelf = (admin: PlatformAdminAccount) =>
    admin.email.toLowerCase() === credentials.email.toLowerCase()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--muted-foreground)]">
          Accounts that can sign in to Platform Administration.
        </p>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          New Admin
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--muted)] text-left text-xs text-[var(--muted-foreground)]">
            <tr>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Created</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {adminsQuery.isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-[var(--muted-foreground)]">
                  Loading admins…
                </td>
              </tr>
            )}
            {adminsQuery.data?.items.map((a) => (
              <tr key={a.id} className="border-t border-[var(--border)]">
                <td className="px-4 py-2">
                  <div className="font-medium">{a.email}</div>
                  {isSelf(a) && (
                    <div className="text-xs text-[var(--muted-foreground)]">You</div>
                  )}
                </td>
                <td className="px-4 py-2">
                  <Badge tone={a.is_active ? 'positive' : 'warning'} className="gap-1">
                    {a.is_active ? (
                      <ShieldCheck aria-hidden="true" className="h-3 w-3" />
                    ) : (
                      <ShieldOff aria-hidden="true" className="h-3 w-3" />
                    )}
                    {a.is_active ? 'active' : 'inactive'}
                  </Badge>
                </td>
                <td className="px-4 py-2 text-[var(--muted-foreground)]">
                  {new Date(a.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-2 text-right">
                  {a.is_active ? (
                    <span title={isSelf(a) ? 'You cannot deactivate your own account' : undefined}>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={isSelf(a)}
                        onClick={() => setConfirmTarget(a)}
                      >
                        Deactivate
                      </Button>
                    </span>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleMutation.mutate({ id: a.id, isActive: true })}
                    >
                      Reactivate
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <NewAdminDialog
        credentials={credentials}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
      {confirmTarget && (
        <ConfirmActionDialog
          open={!!confirmTarget}
          title={`Deactivate ${confirmTarget.email}?`}
          description="This admin will no longer be able to sign in to Platform Administration until reactivated."
          confirmLabel="Deactivate admin"
          destructive
          pending={toggleMutation.isPending}
          onConfirm={() => toggleMutation.mutate({ id: confirmTarget.id, isActive: false })}
          onClose={() => setConfirmTarget(null)}
        />
      )}
    </div>
  )
}

function NewAdminDialog({
  credentials,
  open,
  onClose,
}: {
  credentials: PlatformCredentials
  open: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { show: showToast } = useToast()

  const createMutation = useMutation({
    mutationFn: () => createPlatformAdmin(credentials, { email, password }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-admins'] })
      setEmail('')
      setPassword('')
      onClose()
      showToast('success', 'Platform admin created')
    },
  })

  const serverError = createMutation.error instanceof ApiError ? createMutation.error.message : null

  return (
    <Dialog open={open} onClose={onClose} title="New Platform Admin">
      <form
        className="flex flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault()
          createMutation.mutate()
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-admin-email">Email</Label>
          <Input
            id="new-admin-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-admin-password">Password</Label>
          <Input
            id="new-admin-password"
            type="password"
            required
            aria-describedby="new-admin-password-hint"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p id="new-admin-password-hint" className="text-xs text-[var(--muted-foreground)]">
            {PASSWORD_HINT}
          </p>
        </div>
        {serverError && (
          <p role="alert" className="text-xs text-[var(--destructive)]">
            {serverError}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Creating…' : 'Create Admin'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
