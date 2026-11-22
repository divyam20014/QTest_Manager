import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Ban,
  BookOpen,
  CheckCircle2,
  Clock,
  Copy,
  KeyRound,
  Laptop,
  PauseCircle,
  ShieldCheck,
  ShieldOff,
} from 'lucide-react'

import { ApiError, downloadFile } from '@/api/client'
import { TENANT_DOMAINS, tenantDomainLabel, type TenantDomain } from '@/api/projects'
import {
  assignTenantSubscription,
  createPlatformAdmin,
  changePlatformPassword,
  createTenant,
  issuePlatformAdminPasswordResetCode,
  getPlatformSession,
  listLeads,
  listPlatformAuditEvents,
  listPlatformSessions,
  listPlans,
  listPlatformAdmins,
  listTenants,
  PLATFORM_SESSION_EXPIRED_EVENT,
  PLATFORM_SESSION_KEY,
  platformLogout,
  reissuePlatformAdminEnrolmentCode,
  resetPlatformAdminMfa,
  revokePlatformSession,
  SESSION_IDLE_CODE,
  setStepUpHandler,
  stepUpPlatform,
  updateLeadStatus,
  verifyPlatformAuditChain,
  createPlatformAuditCheckpoint,
  PLATFORM_AUDIT_CHECKPOINT_EXPORT_PATH,
  updatePlatformAdminActive,
  updateTenantDataRegion,
  updateTenantStatus,
  type MarketingLead,
  type LeadKind,
  type LeadStatus,
  type PlatformAdminAccount,
  type PlatformAuditEvent,
  type PlatformAuditOutcome,
  type PlatformAdminWithCode,
  type PlatformSessionEntry,
  type PlatformSessionInfo,
  type SecondFactor,
  type Tenant,
  type TenantStatus,
} from '@/api/platformAdmin'
import { FilterBar } from '@/components/table/FilterBar'
import { ResponsiveTable, type ResponsiveColumn } from '@/components/table/ResponsiveTable'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button, buttonVariants } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ErrorState } from '@/components/ui/empty-state'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { PasswordInput, PasswordStrengthMeter } from '@/components/ui/password-input'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Tabs } from '@/components/ui/tabs'
import { Tooltip } from '@/components/ui/tooltip'
import { checkpointStatusText, createdCheckpointText } from '@/lib/auditCheckpoints'
import { copyText } from '@/lib/clipboard'
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
    queryClient.removeQueries({
      predicate: (q) => q.queryKey[0] !== PLATFORM_SESSION_KEY[0],
    })

  // The session lives in an HttpOnly cookie the page cannot read; this asks
  // the server who (if anyone) is signed in. 401 -> null -> show sign-in.
  const sessionQuery = useQuery({
    queryKey: PLATFORM_SESSION_KEY,
    queryFn: () =>
      getPlatformSession().catch((err: unknown) => {
        if (
          err instanceof ApiError &&
          (err.code === 'unauthorized' || err.code === SESSION_IDLE_CODE)
        )
          return null
        throw err
      }),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })

  // ADR-083: why the console fell back to sign-in (idle timeout), shown above the
  // form. Cleared as soon as somebody signs in again.
  const [expiredNotice, setExpiredNotice] = useState<string | null>(null)

  useEffect(() => {
    const onExpired = (event: Event) => {
      const message = (event as CustomEvent<{ message?: string | null }>).detail?.message
      if (message) setExpiredNotice(message)
      queryClient.removeQueries({
        predicate: (q) => q.queryKey[0] !== PLATFORM_SESSION_KEY[0],
      })
      queryClient.setQueryData(PLATFORM_SESSION_KEY, null)
    }
    window.addEventListener(PLATFORM_SESSION_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(PLATFORM_SESSION_EXPIRED_EVENT, onExpired)
  }, [queryClient])

  const setSession = (next: PlatformSessionInfo | null) => {
    if (next) setExpiredNotice(null)
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
  return <PlatformSignIn session={session} onSession={setSession} initialNotice={expiredNotice} />
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
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  const [sessionsOpen, setSessionsOpen] = useState(false)
  return (
    <main
      id="main-content"
      className="mx-auto flex max-w-5xl flex-col gap-6 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:p-6"
    >
      <PageHeader
        title="Platform Administration"
        description={<span className="break-all">Signed in as {email}</span>}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="max-md:min-h-11"
              onClick={() => setSessionsOpen(true)}
            >
              <Laptop aria-hidden="true" className="size-4" /> My sessions
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="max-md:min-h-11"
              onClick={() => setChangePasswordOpen(true)}
            >
              <KeyRound aria-hidden="true" className="size-4" /> Change password
            </Button>
            <Link
              to="/platform-admin/docs"
              className={buttonVariants({ variant: 'outline', size: 'sm', className: 'max-md:min-h-11' })}
            >
              <BookOpen aria-hidden="true" className="size-4" /> Documentation
            </Link>
            <Button variant="outline" size="sm" className="max-md:min-h-11" onClick={onSignOut}>
              Sign out
            </Button>
          </div>
        }
      />
      <ChangePasswordDialog
        open={changePasswordOpen}
        onClose={() => setChangePasswordOpen(false)}
      />
      <MySessionsDialog
        open={sessionsOpen}
        onClose={() => setSessionsOpen(false)}
        onCurrentRevoked={onSignOut}
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
          { key: 'audit', label: 'Audit', content: <AuditPanel /> },
        ]}
      />
      {/* Last in the DOM so it stacks above any confirm dialog whose action it interrupts. */}
      <StepUpHost />
    </main>
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
            loading={assignMutation.isPending} disabled={!planCode}
            onClick={() => assignMutation.mutate()}
          >
            {assignMutation.isPending ? 'Saving…' : 'Save plan'}
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
            <PasswordInput
              id="admin-password"
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
  const [reissueTarget, setReissueTarget] = useState<PlatformAdminAccount | null>(null)
  const [passwordResetTarget, setPasswordResetTarget] = useState<PlatformAdminAccount | null>(null)
  // The one-time enrolment code from the last create / reset / re-issue. Held
  // only in this component's memory and dropped when the dialog closes.
  const [issued, setIssued] = useState<IssuedCode | null>(null)
  const showIssued = (admin: PlatformAdminWithCode, kind: CodeKind = 'enrolment') =>
    setIssued(issuedCodeFor(admin, kind))
  const { show: showToast } = useToast()

  const adminsQuery = useQuery({
    queryKey: ['platform-admins'],
    // The tab has no pager, and deactivated admins stay listed forever, so ask for
    // the API's maximum page rather than the default 25 (oldest first).
    queryFn: () => listPlatformAdmins({ page_size: 100 }),
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
      showIssued(updated)
    },
    onError: (err) =>
      showToast('error', err instanceof ApiError ? err.message : 'Could not reset MFA'),
  })

  const reissueMutation = useMutation({
    mutationFn: (id: string) => reissuePlatformAdminEnrolmentCode(id),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['platform-admins'] })
      setReissueTarget(null)
      showIssued(updated)
    },
    onError: (err) =>
      showToast(
        'error',
        err instanceof ApiError ? err.message : 'Could not issue an enrolment code',
      ),
  })

  const passwordResetMutation = useMutation({
    mutationFn: (id: string) => issuePlatformAdminPasswordResetCode(id),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['platform-admins'] })
      setPasswordResetTarget(null)
      showIssued(updated, 'reset')
    },
    onError: (err) => {
      setPasswordResetTarget(null)
      showToast(
        'error',
        err instanceof ApiError ? err.message : 'Could not issue a password reset code',
      )
    },
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
      key: 'enrolment',
      header: 'Enrolment code',
      card: 'meta',
      tdClassName: 'text-[var(--muted-foreground)]',
      cell: (a) =>
        a.mfa_enabled ? (
          <span aria-label="Not needed, already enrolled">—</span>
        ) : a.enrolment_code_active && a.enrolment_code_expires_at ? (
          <span>Active until {new Date(a.enrolment_code_expires_at).toLocaleString()}</span>
        ) : (
          <span>No active code</span>
        ),
    },
    {
      key: 'password-reset',
      header: 'Password reset',
      card: 'meta',
      tdClassName: 'text-[var(--muted-foreground)]',
      cell: (a) =>
        a.password_reset_code_active && a.password_reset_code_expires_at ? (
          <span>
            Reset code active until {new Date(a.password_reset_code_expires_at).toLocaleString()}
          </span>
        ) : a.password_reset_code_expires_at ? (
          <span>Reset code expired</span>
        ) : (
          <span>No reset pending</span>
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
          Accounts that can sign in to Platform Administration (password + authenticator app; a new
          admin also needs a one-time enrolment code).
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
          <div className="flex flex-wrap justify-end gap-2 [&_button]:whitespace-nowrap">
            {!isSelf(a) && a.mfa_enabled && (
              <Button variant="outline" size="sm" onClick={() => setResetTarget(a)}>
                Reset MFA
              </Button>
            )}
            {!isSelf(a) && !a.mfa_enabled && a.is_active && (
              <Button variant="outline" size="sm" onClick={() => setReissueTarget(a)}>
                Re-issue enrolment code
              </Button>
            )}
            {!isSelf(a) && a.is_active && (
              <Button variant="outline" size="sm" onClick={() => setPasswordResetTarget(a)}>
                Issue password reset code
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
          </div>
        )}
      />

      <NewAdminDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={showIssued}
      />
      <EnrolmentCodeDialog issued={issued} onClose={() => setIssued(null)} />
      {reissueTarget && (
        <ConfirmDialog
          open={!!reissueTarget}
          title={`Issue a new enrolment code for ${reissueTarget.email}?`}
          description="Any earlier code stops working. You will see the new code once; send it to them separately from their password."
          confirmLabel="Issue new code"
          pending={reissueMutation.isPending}
          onConfirm={() => reissueMutation.mutate(reissueTarget.id)}
          onClose={() => setReissueTarget(null)}
        />
      )}
      {passwordResetTarget && (
        <ConfirmDialog
          open={!!passwordResetTarget}
          title={`Issue a password reset code for ${passwordResetTarget.email}?`}
          description="Every active session of theirs ends now and their current password stops working. They must use the one-time reset code at sign-in to choose a new password. Any earlier reset code stops working. You will see the code once."
          confirmLabel="Issue reset code"
          destructive
          pending={passwordResetMutation.isPending}
          onConfirm={() => passwordResetMutation.mutate(passwordResetTarget.id)}
          onClose={() => setPasswordResetTarget(null)}
        />
      )}
      {resetTarget && (
        <ConfirmDialog
          open={!!resetTarget}
          title={`Reset MFA for ${resetTarget.email}?`}
          description="Their authenticator and recovery codes are removed and every active session ends. They must set up a new authenticator at their next sign-in using a new one-time enrolment code, which you will see once."
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

function NewAdminDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (created: PlatformAdminWithCode) => void
}) {
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { show: showToast } = useToast()

  const createMutation = useMutation({
    mutationFn: () => createPlatformAdmin({ email, password }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['platform-admins'] })
      setEmail('')
      setPassword('')
      onClose()
      showToast('success', 'Platform admin created')
      onCreated(created)
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
          <PasswordInput
            id="new-admin-password"
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

/** Shows a one-time enrolment code exactly once (ADR-080). Only the hash is
 * stored server-side, so closing this dialog loses the code for good (a new one
 * can be issued from the row). */
type CodeKind = 'enrolment' | 'reset'

interface IssuedCode {
  kind: CodeKind
  email: string
  code: string | null
  hours: number | null
}

/** Captured when the response arrives (an event), so the expiry in hours is
 * not recomputed on every render. */
function issuedCodeFor(admin: PlatformAdminWithCode, kind: CodeKind): IssuedCode {
  const expires =
    kind === 'reset' ? admin.password_reset_code_expires_at : admin.enrolment_code_expires_at
  const hours = expires
    ? Math.max(1, Math.round((new Date(expires).getTime() - Date.now()) / 3_600_000))
    : null
  const code = kind === 'reset' ? (admin.password_reset_code ?? null) : admin.enrolment_code
  return { kind, email: admin.email, code, hours }
}

function EnrolmentCodeDialog({
  issued,
  onClose,
}: {
  issued: IssuedCode | null
  onClose: () => void
}) {
  const { show: showToast } = useToast()
  const code = issued?.code ?? null
  const hours = issued?.hours ?? null
  const isReset = issued?.kind === 'reset'
  const label = isReset ? 'Password reset code' : 'Enrolment code'
  const expiry = hours ? `; it expires in ${hours} ${hours === 1 ? 'hour' : 'hours'}` : ''
  return (
    <Dialog
      open={!!issued && !!code}
      onClose={onClose}
      title={issued ? `${label} for ${issued.email}` : label}
    >
      <div className="flex flex-col gap-3 text-sm">
        {isReset ? (
          <p className="text-[var(--muted-foreground)]">
            This code is shown only once. Send it to the admin through a trusted channel. They
            choose{' '}
            <strong className="text-[var(--foreground)]">&ldquo;Have a reset code?&rdquo;</strong>{' '}
            on the Platform Administration sign-in screen, enter it with a new password and (if set
            up) an authenticator code. Their sessions have already ended{expiry}.
          </p>
        ) : (
          <p className="text-[var(--muted-foreground)]">
            This code is shown only once. Send it to the new admin{' '}
            <strong className="text-[var(--foreground)]">separately from their password</strong> (a
            different channel). They enter it on first sign-in before setting up their authenticator
            {expiry}.
          </p>
        )}
        <div className="flex items-center gap-2">
          <output
            aria-label={label}
            data-testid={isReset ? 'password-reset-code' : 'enrolment-code'}
            className="min-h-11 flex-1 select-all break-all rounded-md border border-[var(--border)] bg-[var(--muted)] px-3 py-2.5 font-mono text-base tracking-wider"
          >
            {code}
          </output>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 min-w-11"
            aria-label={`Copy ${label.toLowerCase()}`}
            onClick={async () => {
              const ok = code ? await copyText(code) : false
              showToast(ok ? 'success' : 'error', ok ? `${label} copied` : 'Could not copy')
            }}
          >
            <Copy aria-hidden="true" className="size-4" />
            <span className="ml-1.5 hidden sm:inline">Copy</span>
          </Button>
        </div>
        <DialogFooter>
          <Button type="button" size="sm" onClick={onClose}>
            I have passed it on
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  )
}

function shortUserAgent(ua: string | null): string {
  if (!ua) return 'Unknown device'
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : null
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null
  return browser && os ? `${browser} on ${os}` : browser || os || ua.slice(0, 60)
}

// ADR-083: the signed-in admin's own live sessions, each with a Sign out button
// (so a session on a lost laptop can be ended from this one).
function MySessionsDialog({
  open,
  onClose,
  onCurrentRevoked,
}: {
  open: boolean
  onClose: () => void
  onCurrentRevoked: () => void
}) {
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const sessionsQuery = useQuery({
    queryKey: ['platform-sessions'],
    queryFn: listPlatformSessions,
    enabled: open,
    // A just-revoked row must disappear, and a session list is never worth caching.
    staleTime: 0,
  })
  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokePlatformSession(id),
    onSuccess: (result) => {
      if (result.current) {
        onClose()
        onCurrentRevoked()
        return
      }
      queryClient.invalidateQueries({ queryKey: ['platform-sessions'] })
      showToast('success', 'Session signed out')
    },
    onError: (err) =>
      showToast('error', err instanceof ApiError ? err.message : 'Could not sign that session out'),
  })

  return (
    <Dialog open={open} onClose={onClose} title="My sessions">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-[var(--muted-foreground)]">
          Every browser currently signed in as you. Sign out any you do not recognise.
        </p>
        {sessionsQuery.isLoading && (
          <p role="status" className="text-[var(--muted-foreground)]">
            Loading sessions…
          </p>
        )}
        {sessionsQuery.isError && (
          <ErrorState
            message="Could not load your sessions."
            error={sessionsQuery.error}
            onRetry={() => sessionsQuery.refetch()}
          />
        )}
        <ul aria-label="Your signed-in sessions" className="flex flex-col gap-2">
          {(sessionsQuery.data ?? []).map((row: PlatformSessionEntry) => {
            const label = shortUserAgent(row.user_agent)
            return (
              <li
                key={row.id}
                className="flex flex-col gap-2 rounded-lg border border-[var(--border)] p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{label}</span>
                    {row.current && <Badge tone="positive">This session</Badge>}
                  </div>
                  <span className="break-all text-xs text-[var(--muted-foreground)]">
                    {row.ip_address ?? 'Unknown address'}
                  </span>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    Signed in {new Date(row.created_at).toLocaleString()}
                    {row.last_seen_at
                      ? ` · last active ${new Date(row.last_seen_at).toLocaleString()}`
                      : ''}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11 sm:min-h-0"
                  aria-label={row.current ? 'Sign out this session' : `Sign out session: ${label}`}
                  disabled={revokeMutation.isPending}
                  onClick={() => revokeMutation.mutate(row.id)}
                >
                  Sign out
                </Button>
              </li>
            )
          })}
        </ul>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  )
}

// ADR-083: sensitive actions need a TOTP / recovery code verified in the last few
// minutes. This registers itself as the API layer's step-up handler, so ANY
// platform request that answers 403 `step_up_required` opens this dialog and is
// retried automatically once the code is accepted -- no per-action wiring.
function StepUpHost() {
  const [open, setOpen] = useState(false)
  const [useRecovery, setUseRecovery] = useState(false)
  const [code, setCode] = useState('')
  const [recovery, setRecovery] = useState('')
  const pending = useRef<Promise<boolean> | null>(null)
  const settle = useRef<((ok: boolean) => void) | null>(null)

  useEffect(() => {
    setStepUpHandler(() => {
      if (!pending.current) {
        pending.current = new Promise<boolean>((resolve) => {
          settle.current = (ok) => {
            pending.current = null
            settle.current = null
            resolve(ok)
          }
        })
        setOpen(true)
      }
      return pending.current
    })
    return () => {
      setStepUpHandler(null)
      settle.current?.(false)
    }
  }, [])

  const reset = () => {
    setCode('')
    setRecovery('')
    setUseRecovery(false)
  }

  const stepUpMutation = useMutation({
    mutationFn: () => stepUpPlatform(useRecovery ? { recovery_code: recovery } : { code }),
    onSuccess: () => {
      reset()
      setOpen(false)
      settle.current?.(true)
    },
    // The code is single-use whether it was right or wrong: always clear it.
    onError: () => {
      setCode('')
      setRecovery('')
    },
  })

  const cancel = () => {
    reset()
    stepUpMutation.reset()
    setOpen(false)
    settle.current?.(false)
  }

  const ready = useRecovery ? recovery.replace(/[^A-Za-z0-9]/g, '').length >= 16 : code.length === 6
  const error = stepUpMutation.isError
    ? stepUpMutation.error instanceof ApiError
      ? stepUpMutation.error.message
      : 'Could not verify the code'
    : null

  return (
    <Dialog open={open} onClose={cancel} title="Confirm it's you">
      <form
        className="flex flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready && !stepUpMutation.isPending) stepUpMutation.mutate()
        }}
      >
        <p className="text-[var(--muted-foreground)]">
          This action needs a fresh authenticator code. Enter one to continue; it stays valid for a
          few minutes.
        </p>
        {useRecovery ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="step-up-recovery-code">Recovery code</Label>
            <Input
              id="step-up-recovery-code"
              value={recovery}
              onChange={(e) => setRecovery(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              autoFocus
              placeholder="XXXX-XXXX-XXXX-XXXX"
              className="min-h-11 font-mono md:min-h-0"
            />
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="step-up-code">Authentication code</Label>
            <Input
              id="step-up-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoComplete="one-time-code"
              autoFocus
              placeholder="123456"
              aria-describedby="step-up-code-hint"
              className="min-h-11 font-mono tracking-[0.3em] md:min-h-0"
            />
            <p id="step-up-code-hint" className="text-xs text-[var(--muted-foreground)]">
              A code that has already been used cannot be used again; if you just signed in, wait
              for the next one.
            </p>
          </div>
        )}
        <button
          type="button"
          className="min-h-11 self-start text-left underline-offset-4 hover:underline md:min-h-0"
          onClick={() => {
            setUseRecovery((v) => !v)
            stepUpMutation.reset()
          }}
        >
          {useRecovery ? 'Use an authenticator code instead' : 'Use a recovery code instead'}
        </button>
        <FormError>{error}</FormError>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={cancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" loading={stepUpMutation.isPending} disabled={!ready}>
            {stepUpMutation.isPending ? 'Verifying…' : 'Confirm identity'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}

function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { show: showToast } = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)
  const [code, setCode] = useState('')
  const [recovery, setRecovery] = useState('')

  const clear = () => {
    setCurrent('')
    setNext('')
    setConfirm('')
    setCode('')
    setRecovery('')
    setUseRecovery(false)
  }

  const mismatch = confirm.length > 0 && next !== confirm
  const factor: SecondFactor = useRecovery ? { recovery_code: recovery } : { code }
  const factorReady = useRecovery
    ? recovery.replace(/[^A-Za-z0-9]/g, '').length >= 16
    : code.length === 6
  const ready = current.length > 0 && next.length > 0 && next === confirm && factorReady

  const changeMutation = useMutation({
    mutationFn: () => changePlatformPassword(current, next, factor),
    onSuccess: () => {
      clear()
      onClose()
      showToast('success', 'Password changed; your other sessions were signed out')
    },
    // Wrong password / code: keep the typed new password, drop the secrets that
    // were rejected (the authenticator code is single-use anyway).
    onError: () => {
      setCurrent('')
      setCode('')
      setRecovery('')
    },
  })
  const error = changeMutation.isError
    ? changeMutation.error instanceof ApiError
      ? changeMutation.error.message
      : 'Could not change the password'
    : null

  const close = () => {
    clear()
    changeMutation.reset()
    onClose()
  }

  return (
    <Dialog open={open} onClose={close} title="Change password">
      <form
        className="flex flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready && !changeMutation.isPending) changeMutation.mutate()
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="change-current-password">Current password</Label>
          <PasswordInput
            id="change-current-password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="min-h-11 md:min-h-0"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="change-new-password">New password</Label>
          <PasswordInput
            id="change-new-password"
            autoComplete="new-password"
            aria-describedby="change-new-password-hint"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className="min-h-11 md:min-h-0"
          />
          <p id="change-new-password-hint" className="text-xs text-[var(--muted-foreground)]">
            {PASSWORD_HINT} It must differ from the current password.
          </p>
<PasswordStrengthMeter value={next} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="change-confirm-password">Confirm new password</Label>
          <PasswordInput
            id="change-confirm-password"
            autoComplete="new-password"
            aria-invalid={mismatch}
            aria-describedby={mismatch ? 'change-confirm-error' : undefined}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="min-h-11 md:min-h-0"
          />
          {mismatch && (
            <p id="change-confirm-error" role="alert" className="text-xs text-[var(--destructive)]">
              The two new passwords do not match
            </p>
          )}
        </div>
        {useRecovery ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="change-recovery-code">Recovery code</Label>
            <Input
              id="change-recovery-code"
              value={recovery}
              onChange={(e) => setRecovery(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              className="min-h-11 font-mono md:min-h-0"
            />
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="change-auth-code">Authentication code</Label>
            <Input
              id="change-auth-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoComplete="one-time-code"
              placeholder="123456"
              aria-describedby="change-auth-code-hint"
              className="min-h-11 font-mono tracking-[0.3em] md:min-h-0"
            />
            <p id="change-auth-code-hint" className="text-xs text-[var(--muted-foreground)]">
              A fresh code from your authenticator app. If you just signed in, wait for the next
              code.
            </p>
          </div>
        )}
        <button
          type="button"
          className="min-h-11 self-start text-left underline-offset-4 hover:underline md:min-h-0"
          onClick={() => {
            setUseRecovery((v) => !v)
            changeMutation.reset()
          }}
        >
          {useRecovery ? 'Use an authenticator code instead' : 'Use a recovery code instead'}
        </button>
        <FormError>{error}</FormError>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!ready || changeMutation.isPending}>
            {changeMutation.isPending ? 'Changing…' : 'Change password'}
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

const AUDIT_EVENT_TYPES = [
  'login_password_ok',
  'login_failed',
  'login_blocked',
  'lockout',
  'mfa_success',
  'mfa_failed',
  'mfa_enrolled',
  'enrolment_code_failed',
  'recovery_code_used',
  'password_changed',
  'password_change_failed',
  'password_reset_code_issued',
  'password_reset_completed',
  'password_reset_failed',
  'mfa_reset',
  'enrolment_code_issued',
  'admin_created',
  'admin_activated',
  'admin_deactivated',
  'logout',
]

function auditLabel(type: string): string {
  const text = type.replace(/_/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function auditDetails(event: PlatformAuditEvent): string {
  if (!event.details) return ''
  return Object.entries(event.details)
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${String(v)}`)
    .join(', ')
}

// ADR-082: read-only. There is deliberately no edit/delete control anywhere.
function AuditPanel() {
  const [eventType, setEventType] = useState('')
  const [outcome, setOutcome] = useState<PlatformAuditOutcome | ''>('')
  const [actor, setActor] = useState('')
  const [page, setPage] = useState(1)

  const eventsQuery = useQuery({
    queryKey: ['platform-audit-events', eventType, outcome, actor, page],
    queryFn: () =>
      listPlatformAuditEvents({
        event_type: eventType,
        outcome,
        actor_email: actor.trim(),
        page,
        page_size: PAGE_SIZE,
      }),
  })
  const verifyMutation = useMutation({ mutationFn: verifyPlatformAuditChain })
  const checkpointMutation = useMutation({
    mutationFn: createPlatformAuditCheckpoint,
    onSuccess: () => {
      if (verifyMutation.data) verifyMutation.mutate()
    },
  })
  const exportCheckpointsMutation = useMutation({
    mutationFn: () =>
      downloadFile(PLATFORM_AUDIT_CHECKPOINT_EXPORT_PATH, 'platform_audit_checkpoints.json'),
  })

  const total = eventsQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const columns: ResponsiveColumn<PlatformAuditEvent>[] = [
    {
      key: 'when',
      header: 'When',
      tdClassName: 'whitespace-nowrap text-[var(--muted-foreground)]',
      cell: (e) => new Date(e.created_at).toLocaleString(),
    },
    {
      key: 'event',
      header: 'Event',
      card: 'title',
      cell: (e) => <span className="font-medium">{auditLabel(e.event_type)}</span>,
    },
    {
      key: 'outcome',
      header: 'Outcome',
      cell: (e) => (
        <Badge tone={e.outcome === 'success' ? 'positive' : 'critical'}>{e.outcome}</Badge>
      ),
    },
    { key: 'actor', header: 'Actor', cell: (e) => e.actor_email ?? '—' },
    { key: 'ip', header: 'IP', cell: (e) => e.ip ?? '—' },
    {
      key: 'details',
      header: 'Details',
      cell: (e) => <span className="text-xs">{auditDetails(e) || '—'}</span>,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[var(--muted-foreground)]">
        Sign-in, MFA and admin-management events, newest first. The trail is append-only and
        hash-chained; it never contains passwords, codes, secrets or session tokens.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => verifyMutation.mutate()}
          disabled={verifyMutation.isPending}
        >
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          {verifyMutation.isPending ? 'Verifying…' : 'Verify chain'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => checkpointMutation.mutate()}
          disabled={checkpointMutation.isPending}
        >
          {checkpointMutation.isPending ? 'Creating…' : 'Create checkpoint'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => exportCheckpointsMutation.mutate()}
          disabled={exportCheckpointsMutation.isPending}
        >
          Export checkpoints
        </Button>
        <div role="status" aria-live="polite" data-testid="audit-verify-result" className="text-sm">
          {verifyMutation.isError && (
            <span className="text-[var(--status-serious)]">Could not verify the chain.</span>
          )}
          {verifyMutation.data &&
            (verifyMutation.data.valid ? (
              <span>
                Chain verified: {verifyMutation.data.checked_count} event
                {verifyMutation.data.checked_count === 1 ? '' : 's'} intact.
              </span>
            ) : verifyMutation.data.broken_at_id ? (
              <span className="text-[var(--status-serious)]">
                Chain BROKEN at event {verifyMutation.data.broken_at_id} (
                {verifyMutation.data.checked_count} checked).
              </span>
            ) : (
              <span className="text-[var(--status-serious)]">
                Chain links are consistent ({verifyMutation.data.checked_count} events), but
                verification FAILED.
              </span>
            ))}
          {verifyMutation.data && (
            <span
              data-testid="audit-checkpoint-status"
              className={`ml-1 ${verifyMutation.data.checkpoint_failure ? 'text-[var(--status-serious)]' : ''}`}
            >
              {checkpointStatusText(verifyMutation.data)}
            </span>
          )}
          {checkpointMutation.isError && (
            <span className="ml-1 text-[var(--status-serious)]">
              {checkpointMutation.error instanceof Error
                ? checkpointMutation.error.message
                : 'Could not create the checkpoint.'}
            </span>
          )}
          {checkpointMutation.data && (
            <span data-testid="audit-checkpoint-created" className="ml-1">
              {createdCheckpointText(
                checkpointMutation.data.created,
                checkpointMutation.data.checkpoint?.record_count ?? null,
              )}
            </span>
          )}
          {exportCheckpointsMutation.isError && (
            <span className="ml-1 text-[var(--status-serious)]">
              Could not export the checkpoints.
            </span>
          )}
        </div>
      </div>

      <FilterBar
        activeCount={(eventType ? 1 : 0) + (outcome ? 1 : 0)}
        onClear={() => {
          setEventType('')
          setOutcome('')
          setActor('')
          setPage(1)
        }}
        primary={
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="audit-actor-filter">Actor email</Label>
            <Input
              id="audit-actor-filter"
              className="w-56"
              type="search"
              placeholder="Search by email"
              value={actor}
              onChange={(e) => {
                setActor(e.target.value)
                setPage(1)
              }}
            />
          </div>
        }
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audit-type-filter">Event</Label>
          <Select
            id="audit-type-filter"
            className="w-56"
            value={eventType}
            onChange={(e) => {
              setEventType(e.target.value)
              setPage(1)
            }}
          >
            <option value="">All events</option>
            {AUDIT_EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {auditLabel(t)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audit-outcome-filter">Outcome</Label>
          <Select
            id="audit-outcome-filter"
            className="w-36"
            value={outcome}
            onChange={(e) => {
              setOutcome(e.target.value as PlatformAuditOutcome | '')
              setPage(1)
            }}
          >
            <option value="">All outcomes</option>
            <option value="success">Success</option>
            <option value="failure">Failure</option>
          </Select>
        </div>
      </FilterBar>

      <ResponsiveTable
        label="Platform audit events"
        rows={eventsQuery.data?.items ?? []}
        rowKey={(e) => e.id}
        columns={columns}
        stateCellClassName="px-4"
        state={
          eventsQuery.isLoading ? (
            <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">
              Loading audit events…
            </p>
          ) : eventsQuery.isError ? (
            <p className="py-6 text-center text-sm text-[var(--status-serious)]">
              Could not load audit events.
            </p>
          ) : eventsQuery.data && eventsQuery.data.items.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">
              No audit events match these filters.
            </p>
          ) : undefined
        }
      />

      {total > 0 && (
        <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
          <span>
            Page {page} of {totalPages} ({total} event{total === 1 ? '' : 's'})
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
