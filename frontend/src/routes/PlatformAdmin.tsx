import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, CheckCircle2, Clock, PauseCircle, ShieldCheck, ShieldOff } from 'lucide-react'

import { ApiError } from '@/api/client'
import { TENANT_DOMAINS, tenantDomainLabel, type TenantDomain } from '@/api/projects'
import {
  assignTenantSubscription,
  createPlatformAdmin,
  createTenant,
  getPlatformSession,
  listLeads,
  listPlans,
  listPlatformAdmins,
  listTenants,
  PLATFORM_SESSION_EXPIRED_EVENT,
  PLATFORM_SESSION_KEY,
  platformLogout,
  resetPlatformAdminMfa,
  updateLeadStatus,
  updatePlatformAdminActive,
  updateTenantDataRegion,
  updateTenantStatus,
  type MarketingLead,
  type LeadKind,
  type LeadStatus,
  type PlatformAdminAccount,
  type PlatformSessionInfo,
  type Tenant,
  type TenantStatus,
} from '@/api/platformAdmin'
import { FilterBar } from '@/components/table/FilterBar'
import { ResponsiveTable, type ResponsiveColumn } from '@/components/table/ResponsiveTable'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ErrorState } from '@/components/ui/empty-state'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Tabs } from '@/components/ui/tabs'
import { Tooltip } from '@/components/ui/tooltip'
import { useToast } from '@/lib/toast'
import { FormError } from '@/components/ui/form-field'
import { PlatformSignIn } from './platformAdmin/PlatformSignIn'

// Platform Administration manages tenant lifecycle (create/approve/suspend/
// deactivate) and platform admin accounts, deliberately separate from the
// tenant app's own auth/RBAC (ADR-008): a different identity
// (platform_admins) with its own session cookie. ADR-074: sign-in is password
// + TOTP MFA (or a recovery code). This screen is not linked from the main app
// shell/nav -- reachable only via its own URL, matching that separation.
export function PlatformAdmin() {
  const queryClient = useQueryClient()
  // Forget everything the signed-in console fetched, but keep the session query
  // itself: clearing it would detach the observer that drives this screen, so
  // setting it to null afterwards would never re-render the page.
  const dropConsoleData = () =>
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== PLATFORM_SESSION_KEY[0] })

  // The session lives in an HttpOnly cookie the page cannot read; this asks
  // the server who (if anyone) is signed in. 401 -> null -> show sign-in.
  const sessionQuery = useQuery({
    queryKey: PLATFORM_SESSION_KEY,
    queryFn: () =>
      getPlatformSession().catch((err: unknown) => {
        if (err instanceof ApiError && err.code === 'unauthorized') return null
        throw err
      }),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    const onExpired = () => {
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== PLATFORM_SESSION_KEY[0] })
      queryClient.setQueryData(PLATFORM_SESSION_KEY, null)
    }
    window.addEventListener(PLATFORM_SESSION_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(PLATFORM_SESSION_EXPIRED_EVENT, onExpired)
  }, [queryClient])

  const setSession = (next: PlatformSessionInfo | null) => {
    queryClient.setQueryData(PLATFORM_SESSION_KEY, next)
  }

  if (sessionQuery.isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center p-4">
        <p role="status" className="text-sm text-[var(--muted-foreground)]">
          Checking your session…
        </p>
      </div>
    )
  }

  if (sessionQuery.isError) {
    return (
      <div className="flex min-h-svh items-center justify-center p-4">
        <ErrorState
          message="Could not reach the server."
          error={sessionQuery.error}
          onRetry={() => sessionQuery.refetch()}
        />
      </div>
    )
  }

  const session = sessionQuery.data ?? null
  if (session?.stage === 'mfa_verified') {
    return (
      <AdminConsole
        email={session.email}
        onSignOut={() => {
          void platformLogout().finally(() => {
            dropConsoleData()
            setSession(null)
          })
        }}
      />
    )
  }
  return <PlatformSignIn session={session} onSession={setSession} />
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

function AdminConsole({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:p-6">
      <PageHeader
        title="Platform Administration"
        description={<span className="break-all">Signed in as {email}</span>}
        actions={
          <Button variant="outline" size="sm" onClick={onSignOut}>
            Sign out
          </Button>
        }
      />

      <Tabs
        defaultKey="tenants"
        items={[
          { key: 'tenants', label: 'Tenants', content: <TenantsPanel /> },
          {
            key: 'admins',
            label: 'Platform Admins',
            content: <PlatformAdminsPanel adminEmail={email} />,
          },
          { key: 'leads', label: 'Leads', content: <LeadsPanel /> },
        ]}
      />
    </div>
  )
}

// The local ConfirmActionDialog was promoted to the shared ConfirmDialog
// (components/ui/confirm-dialog.tsx) in design-system Phase B; behaviour and
// props are unchanged.

const PAGE_SIZE = 25
const REGION_OPTIONS = ['us', 'eu', 'apac']

function TenantsPanel() {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [planTarget, setPlanTarget] = useState<Tenant | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<{
    tenant: Tenant
    status: TenantStatus
  } | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<TenantStatus | ''>('')
  const [page, setPage] = useState(1)
  const { show: showToast } = useToast()

  const tenantsQuery = useQuery({
    queryKey: ['platform-tenants', search, statusFilter, page],
    queryFn: () => listTenants({ search, status: statusFilter, page, page_size: PAGE_SIZE }),
  })

  const total = tenantsQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TenantStatus }) =>
      updateTenantStatus(id, status),
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
      updateTenantDataRegion(id, dataRegion),
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

  const tenantColumns: ResponsiveColumn<Tenant>[] = [
    {
      key: 'tenant',
      header: 'Tenant',
      card: 'title',
      cell: (t) => (
        <>
          <div className="font-medium">{t.name}</div>
          <div className="font-mono text-xs text-[var(--muted-foreground)]">{t.id}</div>
        </>
      ),
      cardCell: (t) => (
        <>
          <p className="break-words py-1 text-base font-medium leading-snug">{t.name}</p>
          <p className="break-all font-mono text-xs text-[var(--muted-foreground)]">{t.id}</p>
        </>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      card: 'badge',
      cell: (t) => <StatusBadge status={t.status} />,
    },
    {
      key: 'domain',
      header: 'Domain',
      cardLabel: 'Insurance domain',
      tdClassName: 'text-[var(--muted-foreground)]',
      cell: (t) => t.primary_domain ?? '—',
    },
    {
      key: 'region',
      header: 'Region',
      cardLabel: 'Data region',
      cell: (t) => (
        <Select
          aria-label={`Data region for ${t.name}`}
          className="h-8 w-24 px-2 py-0.5 text-xs max-md:h-11 max-md:w-full max-md:text-base"
          value={t.data_region}
          disabled={dataRegionMutation.isPending}
          onChange={(e) => dataRegionMutation.mutate({ id: t.id, dataRegion: e.target.value })}
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
      ),
    },
    {
      key: 'created',
      header: 'Created',
      tdClassName: 'text-[var(--muted-foreground)]',
      cell: (t) => new Date(t.created_at).toLocaleDateString(),
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          New Tenant
        </Button>
      </div>

      <FilterBar
        activeCount={statusFilter ? 1 : 0}
        onClear={() => {
          setStatusFilter('')
          setPage(1)
        }}
        desktopClear={false}
        primary={
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="tenant-search">Search</Label>
            <Input
              id="tenant-search"
              type="search"
              inputMode="search"
              enterKeyHint="search"
              className="w-56 max-md:w-full"
              placeholder="Name or tenant ID…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
            />
          </div>
        }
      >
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
      </FilterBar>

      <ResponsiveTable
        label="Tenants"
        rows={tenantsQuery.data?.items ?? []}
        rowKey={(t) => t.id}
        columns={tenantColumns}
        stateCellClassName="px-4"
        state={
          tenantsQuery.isLoading ? (
            <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">
              Loading tenants…
            </p>
          ) : total === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">
              No tenants match your search.
            </p>
          ) : undefined
        }
        rowActions={(t) => (
          <div className="flex flex-wrap justify-end gap-2 md:flex-nowrap">
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
        )}
      />

      {total > 0 && (
        <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
          <span>
            Page {page} of {totalPages} ({total} tenant{total === 1 ? '' : 's'})
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
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

      <NewTenantDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <PlanDialog tenant={planTarget} onClose={() => setPlanTarget(null)} />
      {confirmTarget && (
        <ConfirmDialog
          open={!!confirmTarget}
          title={`${confirmTarget.status === 'suspended' ? 'Suspend' : 'Deactivate'} ${confirmTarget.tenant.name}?`}
          description={
            confirmTarget.status === 'suspended'
              ? `Every user at ${confirmTarget.tenant.name} will be immediately logged out and blocked from signing in again until this tenant is re-approved. Use this for a compliance or abuse hold.`
              : `Every user at ${confirmTarget.tenant.name} will be immediately logged out and blocked from signing in again until this tenant is re-approved. Use this for routine offboarding (e.g. non-payment), not a compliance hold.`
          }
          confirmLabel={
            confirmTarget.status === 'suspended' ? 'Suspend tenant' : 'Deactivate tenant'
          }
          destructive
          pending={statusMutation.isPending}
          onConfirm={() =>
            statusMutation.mutate({
              id: confirmTarget.tenant.id,
              status: confirmTarget.status,
            })
          }
          onClose={() => setConfirmTarget(null)}
        />
      )}
    </div>
  )
}

// Tier 1 / ADR-053: schema/record-keeping only -- no payment gateway, no
// billing engine.
function PlanDialog({ tenant, onClose }: { tenant: Tenant | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [planCode, setPlanCode] = useState('')
  const [status, setStatus] = useState<'trialing' | 'active' | 'past_due' | 'canceled'>('active')
  const [seatCount, setSeatCount] = useState(1)
  const { show: showToast } = useToast()

  const plansQuery = useQuery({
    queryKey: ['platform-plans'],
    queryFn: () => listPlans(),
    enabled: !!tenant,
  })

  const assignMutation = useMutation({
    mutationFn: () =>
      assignTenantSubscription(tenant!.id, {
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
        <FormError>{serverError}</FormError>
        <DialogFooter>
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
        </DialogFooter>
      </div>
    </Dialog>
  )
}

const PASSWORD_HINT =
  'At least 12 characters, with an uppercase letter, a lowercase letter, and a digit.'

function NewTenantDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [tenantName, setTenantName] = useState('')
  const [adminName, setAdminName] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [dataRegion, setDataRegion] = useState('us')
  const [primaryDomain, setPrimaryDomain] = useState<TenantDomain | ''>('')
  const { show: showToast } = useToast()

  const createMutation = useMutation({
    mutationFn: () =>
      createTenant({
        tenant_name: tenantName,
        admin_name: adminName,
        admin_email: adminEmail,
        admin_password: adminPassword,
        data_region: dataRegion,
        ...(primaryDomain ? { primary_domain: primaryDomain } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-tenants'] })
      setTenantName('')
      setAdminName('')
      setAdminEmail('')
      setAdminPassword('')
      setDataRegion('us')
      setPrimaryDomain('')
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
            <Label htmlFor="tenant-domain">Insurance Domain (optional)</Label>
            <Select
              id="tenant-domain"
              value={primaryDomain}
              onChange={(e) => setPrimaryDomain(e.target.value as TenantDomain | '')}
            >
              <option value="">Not specified</option>
              {TENANT_DOMAINS.map((d) => (
                <option key={d} value={d}>
                  {tenantDomainLabel(d)}
                </option>
              ))}
            </Select>
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
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Creating…' : 'Create Tenant'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}

function PlatformAdminsPanel({ adminEmail }: { adminEmail: string }) {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [confirmTarget, setConfirmTarget] = useState<PlatformAdminAccount | null>(null)
  const [resetTarget, setResetTarget] = useState<PlatformAdminAccount | null>(null)
  const { show: showToast } = useToast()

  const adminsQuery = useQuery({
    queryKey: ['platform-admins'],
    queryFn: () => listPlatformAdmins(),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      updatePlatformAdminActive(id, isActive),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['platform-admins'] })
      showToast('success', vars.isActive ? 'Admin reactivated' : 'Admin deactivated')
      setConfirmTarget(null)
    },
    onError: (err) =>
      showToast('error', err instanceof ApiError ? err.message : 'Could not update that admin'),
  })

  const resetMfaMutation = useMutation({
    mutationFn: (id: string) => resetPlatformAdminMfa(id),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['platform-admins'] })
      showToast('success', `MFA reset for ${updated.email}; they will re-enrol at next sign-in`)
      setResetTarget(null)
    },
    onError: (err) =>
      showToast('error', err instanceof ApiError ? err.message : 'Could not reset MFA'),
  })

  const isSelf = (admin: PlatformAdminAccount) =>
    admin.email.toLowerCase() === adminEmail.toLowerCase()

  const adminColumns: ResponsiveColumn<PlatformAdminAccount>[] = [
    {
      key: 'email',
      header: 'Email',
      card: 'title',
      cell: (a) => (
        <>
          <div className="font-medium">{a.email}</div>
          {isSelf(a) && <div className="text-xs text-[var(--muted-foreground)]">You</div>}
        </>
      ),
      cardCell: (a) => (
        <>
          <p className="break-all py-1 text-base font-medium leading-snug">{a.email}</p>
          {isSelf(a) && <p className="text-xs text-[var(--muted-foreground)]">You</p>}
        </>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      card: 'badge',
      cell: (a) => (
        <Badge tone={a.is_active ? 'positive' : 'warning'} className="gap-1">
          {a.is_active ? (
            <ShieldCheck aria-hidden="true" className="h-3 w-3" />
          ) : (
            <ShieldOff aria-hidden="true" className="h-3 w-3" />
          )}
          {a.is_active ? 'active' : 'inactive'}
        </Badge>
      ),
    },
    {
      key: 'mfa',
      header: 'MFA',
      card: 'badge',
      cell: (a) => (
        <Badge tone={a.mfa_enabled ? 'positive' : 'warning'} className="gap-1">
          <ShieldCheck aria-hidden="true" className="h-3 w-3" />
          {a.mfa_enabled ? 'MFA on' : 'MFA not set up'}
        </Badge>
      ),
    },
    {
      key: 'created',
      header: 'Created',
      tdClassName: 'text-[var(--muted-foreground)]',
      cell: (a) => new Date(a.created_at).toLocaleDateString(),
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--muted-foreground)]">
          Accounts that can sign in to Platform Administration (password + authenticator app).
        </p>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          New Admin
        </Button>
      </div>

      <ResponsiveTable
        label="Platform administrators"
        rows={adminsQuery.data?.items ?? []}
        rowKey={(a) => a.id}
        columns={adminColumns}
        stateCellClassName="px-4"
        state={
          adminsQuery.isLoading ? (
            <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">
              Loading admins…
            </p>
          ) : undefined
        }
        rowActions={(a) => (
          <>
            {!isSelf(a) && a.mfa_enabled && (
              <Button variant="outline" size="sm" onClick={() => setResetTarget(a)}>
                Reset MFA
              </Button>
            )}
            {a.is_active ? (
              <Tooltip
                content={isSelf(a) ? 'You cannot deactivate your own account' : null}
                side="bottom"
              >
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isSelf(a)}
                  aria-label={
                    isSelf(a) ? 'Deactivate (you cannot deactivate your own account)' : undefined
                  }
                  onClick={() => setConfirmTarget(a)}
                >
                  Deactivate
                </Button>
              </Tooltip>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => toggleMutation.mutate({ id: a.id, isActive: true })}
              >
                Reactivate
              </Button>
            )}
          </>
        )}
      />

      <NewAdminDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      {resetTarget && (
        <ConfirmDialog
          open={!!resetTarget}
          title={`Reset MFA for ${resetTarget.email}?`}
          description="Their authenticator and recovery codes are removed and every active session ends. They must set up a new authenticator at their next sign-in."
          confirmLabel="Reset MFA"
          destructive
          pending={resetMfaMutation.isPending}
          onConfirm={() => resetMfaMutation.mutate(resetTarget.id)}
          onClose={() => setResetTarget(null)}
        />
      )}
      {confirmTarget && (
        <ConfirmDialog
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

function NewAdminDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { show: showToast } = useToast()

  const createMutation = useMutation({
    mutationFn: () => createPlatformAdmin({ email, password }),
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
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Creating…' : 'Create Admin'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}

const LEAD_KIND_LABEL: Record<LeadKind, string> = {
  demo: 'Demo request',
  contact: 'Contact',
  pricing: 'Pricing',
  enterprise: 'Enterprise',
}
const LEAD_STATUS_TONE: Record<LeadStatus, 'warning' | 'positive' | 'neutral'> = {
  new: 'warning',
  contacted: 'positive',
  closed: 'neutral',
}

// Enquiries from the public website's Request a Demo / Contact forms.
// Prospects have no tenant yet, so leads live at platform level.
function LeadsPanel() {
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const [kind, setKind] = useState<LeadKind | ''>('')
  const [status, setStatus] = useState<LeadStatus | ''>('')
  const [page, setPage] = useState(1)

  const leadsQuery = useQuery({
    queryKey: ['platform-leads', kind, status, page],
    queryFn: () => listLeads({ kind, status, page, page_size: PAGE_SIZE }),
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: LeadStatus }) => updateLeadStatus(id, next),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-leads'] })
      showToast('success', 'Lead updated')
    },
    onError: (err) =>
      showToast('error', err instanceof ApiError ? err.message : 'Could not update that lead'),
  })

  const total = leadsQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const statusSelect = (lead: MarketingLead) => (
    <Select
      aria-label={`Status for ${lead.full_name}`}
      className="w-32 max-md:w-full"
      value={lead.status}
      disabled={statusMutation.isPending}
      onChange={(e) =>
        statusMutation.mutate({
          id: lead.id,
          next: e.target.value as LeadStatus,
        })
      }
    >
      <option value="new">New</option>
      <option value="contacted">Contacted</option>
      <option value="closed">Closed</option>
    </Select>
  )

  const leadColumns: ResponsiveColumn<MarketingLead>[] = [
    {
      key: 'received',
      header: 'Received',
      tdClassName: 'whitespace-nowrap text-[var(--muted-foreground)]',
      cell: (lead) => new Date(lead.created_at).toLocaleString(),
    },
    {
      key: 'contact',
      header: 'Contact',
      card: 'title',
      cell: (lead) => (
        <>
          <div className="font-medium">{lead.full_name}</div>
          <a
            className="text-xs text-[var(--brand)] hover:underline"
            href={`mailto:${lead.business_email}`}
          >
            {lead.business_email}
          </a>
          {lead.message && (
            <p className="mt-1 max-w-md whitespace-pre-line text-xs text-[var(--muted-foreground)]">
              {lead.message}
            </p>
          )}
        </>
      ),
      cardCell: (lead) => (
        <>
          <p className="break-words py-1 text-base font-medium leading-snug">{lead.full_name}</p>
          <a
            className="relative z-10 inline-flex min-h-11 items-center break-all text-sm text-[var(--brand)] hover:underline"
            href={`mailto:${lead.business_email}`}
          >
            {lead.business_email}
          </a>
          {lead.message && (
            <p className="whitespace-pre-line break-words text-sm text-[var(--muted-foreground)]">
              {lead.message}
            </p>
          )}
          <div className="mt-2 flex flex-col gap-1">
            <span className="text-xs text-[var(--muted-foreground)]">Update status</span>
            {statusSelect(lead)}
          </div>
        </>
      ),
    },
    {
      key: 'company',
      header: 'Company',
      cell: (lead) => (
        <>
          <div>{lead.company}</div>
          <div className="text-xs text-[var(--muted-foreground)]">
            {[lead.job_role, lead.team_size && `${lead.team_size} people`, lead.primary_requirement]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </>
      ),
    },
    {
      key: 'kind',
      header: 'Type',
      card: 'badge',
      cell: (lead) => <Badge tone="neutral">{LEAD_KIND_LABEL[lead.kind]}</Badge>,
    },
    {
      key: 'status',
      header: 'Status',
      card: 'badge',
      cell: (lead) => (
        <div className="flex flex-col items-start gap-1.5">
          <Badge tone={LEAD_STATUS_TONE[lead.status]}>{lead.status}</Badge>
          {statusSelect(lead)}
        </div>
      ),
      cardCell: (lead) => <Badge tone={LEAD_STATUS_TONE[lead.status]}>{lead.status}</Badge>,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[var(--muted-foreground)]">
        Submitted from the public website&rsquo;s demo and contact forms.
      </p>

      <FilterBar
        activeCount={(kind ? 1 : 0) + (status ? 1 : 0)}
        onClear={() => {
          setKind('')
          setStatus('')
          setPage(1)
        }}
        desktopClear={false}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lead-kind-filter">Type</Label>
          <Select
            id="lead-kind-filter"
            className="w-40"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as LeadKind | '')
              setPage(1)
            }}
          >
            <option value="">All types</option>
            <option value="demo">Demo request</option>
            <option value="contact">Contact</option>
            <option value="pricing">Pricing</option>
            <option value="enterprise">Enterprise</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lead-status-filter">Status</Label>
          <Select
            id="lead-status-filter"
            className="w-36"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as LeadStatus | '')
              setPage(1)
            }}
          >
            <option value="">All statuses</option>
            <option value="new">New</option>
            <option value="contacted">Contacted</option>
            <option value="closed">Closed</option>
          </Select>
        </div>
      </FilterBar>

      <ResponsiveTable
        label="Leads"
        rows={leadsQuery.data?.items ?? []}
        rowKey={(l) => l.id}
        columns={leadColumns}
        stateCellClassName="px-4"
        state={
          leadsQuery.isLoading ? (
            <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">
              Loading leads…
            </p>
          ) : leadsQuery.isError ? (
            <p className="py-6 text-center text-sm text-[var(--status-serious)]">
              Could not load leads.
            </p>
          ) : leadsQuery.data && leadsQuery.data.items.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">
              No leads match these filters yet.
            </p>
          ) : undefined
        }
      />

      {total > 0 && (
        <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
          <span>
            Page {page} of {totalPages} ({total} lead{total === 1 ? '' : 's'})
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
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
    </div>
  )
}
