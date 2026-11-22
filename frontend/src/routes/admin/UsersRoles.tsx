import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError } from '@/api/client'
import type { RoleCode } from '@/api/auth'
import { listRoles } from '@/api/roles'
import {
  createUser,
  deactivateUser,
  eraseUser,
  inviteUser,
  listUsers,
  resetPassword,
  updateUser,
  type User,
} from '@/api/users'
import { FilterBar, FilterField } from '@/components/table/FilterBar'
import { ResponsiveTable, type ResponsiveColumn } from '@/components/table/ResponsiveTable'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/PageHeader'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/useConfirm'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { hasPermission } from '@/api/auth'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'
import { useIsMobile } from '@/lib/useMediaQuery'
import { useUrlFilters } from '@/lib/useUrlFilters'
import { FormError } from '@/components/ui/form-field'

const INVITE_ROLES: RoleCode[] = ['admin', 'manager', 'tester']

// GAP-91 item 2: this list has no bulk-action backing endpoint (role
// change/activate/deactivate/reset-password are all single-user actions
// today) and only 6 fixed columns, so no bulk-action bar or column-picker
// is added here -- noted rather than forced. Sort IS added (Name/Last
// Login), since that's a genuine, cheap usability win on a list that can
// grow past what fits on one screen.
type SortKey = 'name' | 'last_login_at'

export function UsersRoles() {
  const { user: currentUser } = useAuth()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [resetTarget, setResetTarget] = useState<User | null>(null)
  const [eraseTarget, setEraseTarget] = useState<User | null>(null)
  const canErase = hasPermission(currentUser, 'user.erase')
  const { show: showToast } = useToast()
  const { ask, dialog: confirmDialog } = useConfirm()

  const filterDefaults = { search: '', role: '', status: '', sort: 'name' }
  const urlFilters = useUrlFilters(filterDefaults)
  const search = urlFilters.values.search
  const roleFilter = urlFilters.values.role
  const statusFilter = urlFilters.values.status as '' | 'active' | 'inactive'
  const sort = urlFilters.values.sort
  const sortKey = sort.replace(/^-/, '') as SortKey
  const sortDesc = sort.startsWith('-')
  const isMobile = useIsMobile()

  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers })
  const rolesQuery = useQuery({ queryKey: ['roles'], queryFn: listRoles })
  const activeRoles = (rolesQuery.data ?? []).filter((r) => r.is_active)

  // Client-side filtering -- the user list is tenant-scoped and small
  // enough (no pagination exists on this endpoint) that a server round
  // trip per keystroke isn't warranted.
  const filteredUsers = (usersQuery.data ?? [])
    .filter((u) => {
      if (search && !`${u.name} ${u.erased_at ? '' : u.email}`.toLowerCase().includes(search.toLowerCase())) return false
      if (roleFilter && u.role_id !== roleFilter) return false
      if (statusFilter === 'active' && !u.is_active) return false
      if (statusFilter === 'inactive' && u.is_active) return false
      return true
    })
    .sort((a, b) => {
      const av = sortKey === 'last_login_at' ? a.last_login_at ?? '' : a.name
      const bv = sortKey === 'last_login_at' ? b.last_login_at ?? '' : b.name
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDesc ? -cmp : cmp
    })

  function toggleSort(key: SortKey) {
    const next = sortKey !== key ? key : sortDesc ? key : `-${key}`
    urlFilters.setFilter('sort', next)
  }

  const FILTER_CHIP_LABEL: Record<string, string> = { search: 'Search', role: 'Role', status: 'Status' }
  const visibleFilterChips = urlFilters.active.filter((key) => key in FILTER_CHIP_LABEL)
  const chipDisplayValue: Record<string, string> = {
    role: activeRoles.find((r) => r.id === roleFilter)?.name ?? roleFilter,
    status: statusFilter === 'active' ? 'Active' : statusFilter === 'inactive' ? 'Deactivated' : '',
  }

  const roleMutation = useMutation({
    mutationFn: ({ id, roleId }: { id: string; roleId: string }) =>
      updateUser(id, { role_id: roleId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      showToast('success', 'Role updated')
    },
    onError: () => showToast('error', 'Could not update that user’s role'),
  })

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => deactivateUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      showToast('success', 'User deactivated')
    },
    onError: () => showToast('error', 'Could not deactivate that user'),
  })

  const activateMutation = useMutation({
    mutationFn: (id: string) => updateUser(id, { is_active: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      showToast('success', 'User activated')
    },
    onError: () => showToast('error', 'Could not activate that user'),
  })

  const columns: ResponsiveColumn<User>[] = [
    {
      key: 'name',
      header: 'Name',
      headerCell: (
        <button
          type="button"
          onClick={() => toggleSort('name')}
          className="inline-flex items-center gap-1 hover:text-[var(--foreground)]"
        >
          Name {sortKey === 'name' && (sortDesc ? '↓' : '↑')}
        </button>
      ),
      card: 'title',
      tdClassName: 'font-medium',
      cell: (u) => (
        <>
          {u.name} {u.id === currentUser?.user_id && <span className="text-xs text-[var(--muted-foreground)]">(you)</span>}
        </>
      ),
      cardCell: (u) => (
        <p className="break-words py-1 text-base font-medium leading-snug">
          {u.name} {u.id === currentUser?.user_id && <span className="text-xs text-[var(--muted-foreground)]">(you)</span>}
        </p>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      card: 'badge',
      cell: (u) =>
        u.erased_at ? (
          <Badge tone="neutral">Erased</Badge>
        ) : (
          <Badge tone={u.is_active ? 'positive' : 'neutral'}>{u.is_active ? 'Active' : 'Deactivated'}</Badge>
        ),
    },
    {
      key: 'email',
      header: 'Email',
      cardFull: true,
      cell: (u) => (u.erased_at ? <span className="text-[var(--muted-foreground)]">Erased</span> : u.email),
      cardCell: (u) => (
        <span className="block min-w-0 [overflow-wrap:anywhere]">
          {u.erased_at ? <span className="text-[var(--muted-foreground)]">Erased</span> : u.email}
        </span>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      cell: (u) => (
        <Select
          aria-label={`Role for ${u.name}`}
          value={u.role_id}
          disabled={u.id === currentUser?.user_id || !!u.erased_at}
          onChange={(e) => roleMutation.mutate({ id: u.id, roleId: e.target.value })}
          className="w-36 max-md:w-full"
        >
          {activeRoles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
      ),
    },
    {
      key: 'last_login',
      header: 'Last Login',
      headerCell: (
        <button
          type="button"
          onClick={() => toggleSort('last_login_at')}
          className="inline-flex items-center gap-1 hover:text-[var(--foreground)]"
        >
          Last Login {sortKey === 'last_login_at' && (sortDesc ? '↓' : '↑')}
        </button>
      ),
      tdClassName: 'text-[var(--muted-foreground)]',
      cell: (u) => (u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : 'Never'),
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Users & Roles"
        description="Invite people, assign their roles and control who can sign in."
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
              New User (set password directly)
            </Button>
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              Invite User
            </Button>
          </>
        }
      />

      <FilterBar
        activeCount={(roleFilter ? 1 : 0) + (statusFilter ? 1 : 0)}
        onClear={() => {
          urlFilters.setFilter('role', '')
          urlFilters.setFilter('status', '')
        }}
        desktopClear={false}
        primary={
          <Input
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => urlFilters.setFilter('search', e.target.value)}
            className="w-56 max-md:w-full"
            aria-label="Search users"
          />
        }
      >
        <FilterField label="Role">
          <Select
            aria-label="Filter by role"
            value={roleFilter}
            onChange={(e) => urlFilters.setFilter('role', e.target.value)}
            className="w-40"
          >
            <option value="">All roles</option>
            {activeRoles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Status">
          <Select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => urlFilters.setFilter('status', e.target.value)}
            className="w-36"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Deactivated</option>
          </Select>
        </FilterField>
        {isMobile && (
          <FilterField label="Sort by">
            <Select
              aria-label="Sort users"
              value={sort}
              onChange={(e) => urlFilters.setFilter('sort', e.target.value)}
            >
              <option value="name">Name (A-Z)</option>
              <option value="-name">Name (Z-A)</option>
              <option value="-last_login_at">Last login (newest)</option>
              <option value="last_login_at">Last login (oldest)</option>
            </Select>
          </FilterField>
        )}
        {!isMobile && urlFilters.active.length > 0 && (
          <Button variant="outline" size="sm" onClick={urlFilters.clearAll}>
            Clear filters
          </Button>
        )}
      </FilterBar>

      {visibleFilterChips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {visibleFilterChips.map((key) => (
            <span
              key={key}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--muted)] px-2.5 py-1 text-xs"
            >
              {FILTER_CHIP_LABEL[key]}: {chipDisplayValue[key] ?? urlFilters.values[key]}
              <button
                type="button"
                onClick={() => urlFilters.setFilter(key, '')}
                aria-label={`Remove ${FILTER_CHIP_LABEL[key]} filter`}
                className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] max-md:flex max-md:size-8 max-md:items-center max-md:justify-center"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <ResponsiveTable
        label="Users"
        rows={filteredUsers}
        rowKey={(u) => u.id}
        columns={columns}
        stateCellClassName="px-4"
        loading={usersQuery.isLoading}
        state={
          usersQuery.isError ? (
            <ErrorState error={usersQuery.error} onRetry={() => usersQuery.refetch()} />
          ) : filteredUsers.length === 0 && usersQuery.data && usersQuery.data.length > 0 ? (
            <EmptyState
              variant="filtered"
              title="No users match your filters"
              description="Try clearing a filter or the search to see more people."
              action={
                <Button variant="outline" size="sm" onClick={urlFilters.clearAll}>
                  Clear filters
                </Button>
              }
            />
          ) : undefined
        }
        rowActions={(u) => (
          <div className="flex flex-wrap justify-end gap-2">
            {!u.erased_at && (
              <Button variant="outline" size="sm" onClick={() => setResetTarget(u)}>
                Reset Password
              </Button>
            )}
            {u.is_active && u.id !== currentUser?.user_id && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  ask({
                    title: `Deactivate ${u.name}?`,
                    description: `${u.name} will be signed out and unable to log in until an admin activates them again. Their test results, defects and comments are kept.`,
                    confirmLabel: 'Deactivate user',
                    run: () => deactivateMutation.mutateAsync(u.id),
                  })
                }
              >
                Deactivate
              </Button>
            )}
            {!u.is_active && !u.erased_at && (
              <Button variant="outline" size="sm" onClick={() => activateMutation.mutate(u.id)}>
                Activate
              </Button>
            )}
            {canErase && !u.erased_at && u.id !== currentUser?.user_id && (
              <Button
                variant="outline"
                size="sm"
                aria-label={`Erase personal data for ${u.name}`}
                onClick={() => setEraseTarget(u)}
              >
                Erase personal data
              </Button>
            )}
          </div>
        )}
      />

      {confirmDialog}
      <NewUserDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <InviteUserDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
      <ResetPasswordDialog
        user={resetTarget}
        onClose={() => setResetTarget(null)}
      />
      <EraseUserDialog user={eraseTarget} onClose={() => setEraseTarget(null)} />
    </div>
  )
}

function ResetPasswordDialog({ user, onClose }: { user: User | null; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const { show: showToast } = useToast()

  const resetMutation = useMutation({
    mutationFn: () => resetPassword(user!.id, password),
    onSuccess: () => {
      setPassword('')
      onClose()
      showToast('success', 'Password reset -- the user has been signed out of all sessions')
    },
    // No onError toast -- `serverError` below already renders this inline.
  })

  const serverError = resetMutation.error instanceof ApiError ? resetMutation.error.message : null

  if (!user) return null

  return (
    <Dialog open={!!user} onClose={onClose} title={`Reset Password — ${user.name}`}>
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reset-password">New Temporary Password</Label>
          <Input
            id="reset-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="text-xs text-[var(--muted-foreground)]">
            At least 12 characters, with an uppercase letter, a lowercase letter, and a digit. This
            signs the user out of all existing sessions.
          </p>
        </div>
        <FormError>{serverError}</FormError>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={resetMutation.isPending} onClick={() => resetMutation.mutate()}>
            {resetMutation.isPending ? 'Resetting…' : 'Reset Password'}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  )
}

const ERASE_LABELS: Record<string, string> = {
  users: 'Profile (name and email replaced)',
  sessions_revoked: 'Active sessions signed out',
  mfa_challenges_deleted: 'Verification codes deleted',
  notifications_deleted: 'Notifications deleted',
  notifications_naming_user_redacted: 'Others’ notifications naming them, redacted',
  user_invites_anonymised: 'Invites for their email anonymised',
  report_schedule_recipients_removed: 'Report schedules: address removed',
}
const RETAINED_LABELS: Record<string, string> = {
  audit_logs_as_actor: 'Audit entries they performed',
  audit_logs_about_user: 'Audit entries about them',
  comments: 'Comments they wrote',
  defects_reported: 'Defects they reported',
}

// ADR-086 (GAP-03): irreversible anonymisation. Shows the server's dry-run
// preview first, and only enables the real run once the user's current email
// has been typed back.
function EraseUserDialog({ user, onClose }: { user: User | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const [typed, setTyped] = useState('')

  const previewQuery = useQuery({
    queryKey: ['user-erase-preview', user?.id],
    queryFn: () => eraseUser(user!.id, { dry_run: true }),
    enabled: !!user,
    retry: false,
    gcTime: 0,
  })

  const eraseMutation = useMutation({
    mutationFn: () => eraseUser(user!.id, { dry_run: false, confirm_email: typed.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      handleClose()
      showToast('success', 'Personal data erased')
    },
    // No onError toast -- `serverError` below renders this inline.
  })

  const serverError =
    eraseMutation.error instanceof ApiError
      ? eraseMutation.error.message
      : previewQuery.error instanceof ApiError
        ? previewQuery.error.message
        : null

  function handleClose() {
    setTyped('')
    eraseMutation.reset()
    onClose()
  }

  if (!user) return null
  const preview = previewQuery.data
  const emailOk = typed.trim().toLowerCase() === user.email.toLowerCase()

  return (
    <Dialog open={!!user} onClose={handleClose} title={`Erase personal data — ${user.name}`}>
      <div className="flex flex-col gap-3 text-sm" data-testid="erase-dialog">
        <p className="text-[var(--muted-foreground)]">
          This permanently replaces the user’s name and email with a placeholder, deactivates the
          account and signs them out. It cannot be undone. Their comments, defects, test cases and
          runs are kept and shown as “Erased user”. Audit log entries are never changed, and older
          ones may still contain the email or name that was typed at the time.
        </p>
        {previewQuery.isLoading && <p role="status">Checking what would change…</p>}
        {preview && (
          <div className="flex flex-col gap-2" role="group" aria-label="Erasure preview">
            <p className="text-xs font-semibold uppercase text-[var(--muted-foreground)]">
              Will change
            </p>
            <ul className="flex flex-col gap-1">
              {Object.entries(preview.changes).map(([key, n]) => (
                <li key={key} className="flex justify-between gap-3">
                  <span>{ERASE_LABELS[key] ?? key}</span>
                  <span className="font-medium tabular-nums">{n}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs font-semibold uppercase text-[var(--muted-foreground)]">Kept</p>
            <ul className="flex flex-col gap-1">
              {Object.entries(preview.retained).map(([key, n]) => (
                <li key={key} className="flex justify-between gap-3">
                  <span>{RETAINED_LABELS[key] ?? key}</span>
                  <span className="font-medium tabular-nums">{n}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="erase-confirm-email">Type the user’s email to confirm</Label>
          <Input
            id="erase-confirm-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            spellCheck={false}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          <p className="text-xs text-[var(--muted-foreground)]">
            Expected: <span className="break-all font-mono">{user.email}</span>
          </p>
        </div>
        <FormError>{serverError}</FormError>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={handleClose} disabled={eraseMutation.isPending}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={!preview || !emailOk || eraseMutation.isPending}
            onClick={() => eraseMutation.mutate()}
          >
            {eraseMutation.isPending ? 'Erasing…' : 'Erase personal data'}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  )
}

function NewUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const rolesQuery = useQuery({ queryKey: ['roles'], queryFn: listRoles })
  const activeRoles = (rolesQuery.data ?? []).filter((r) => r.is_active)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [roleId, setRoleId] = useState('')
  const [password, setPassword] = useState('')
  const { show: showToast } = useToast()

  const createMutation = useMutation({
    mutationFn: () => createUser({ email, name, role_id: roleId, password }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setEmail('')
      setName('')
      setRoleId('')
      setPassword('')
      onClose()
      showToast('success', 'User created')
    },
    // No onError toast -- `serverError` below already renders this inline.
  })

  const serverError = createMutation.error instanceof ApiError ? createMutation.error.message : null

  return (
    <Dialog open={open} onClose={onClose} title="New User">
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="user-name">Name</Label>
          <Input id="user-name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="user-email">Email</Label>
          <Input id="user-email" type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="user-role">Role</Label>
          <Select id="user-role" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="" disabled>
              Select a role…
            </option>
            {activeRoles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="user-password">Temporary Password</Label>
          <Input
            id="user-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="text-xs text-[var(--muted-foreground)]">
            At least 12 characters, with an uppercase letter, a lowercase letter, and a digit.
          </p>
        </div>
        <FormError>{serverError}</FormError>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={createMutation.isPending || !roleId}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? 'Creating…' : 'Create User'}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  )
}

// Tier 1 / ADR-053: replaces admin-sets-the-password-directly provisioning
// (NewUserDialog above, kept for scripts/back-compat) -- the invitee sets
// their own password when they accept.
function InviteUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<RoleCode>('tester')
  const [sentLink, setSentLink] = useState<string | null>(null)
  const { show: showToast } = useToast()

  const inviteMutation = useMutation({
    mutationFn: () => inviteUser({ email, name, role }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      if (data.invite_token) {
        setSentLink(`${window.location.origin}/accept-invite/${data.invite_token}`)
      } else {
        handleClose()
        showToast('success', 'Invite sent')
      }
    },
    // No onError toast -- `serverError` below already renders this inline.
  })

  const serverError = inviteMutation.error instanceof ApiError ? inviteMutation.error.message : null

  function handleClose() {
    setEmail('')
    setName('')
    setRole('tester')
    setSentLink(null)
    inviteMutation.reset()
    onClose()
  }

  return (
    <Dialog open={open} onClose={handleClose} title="Invite User">
      <div className="flex flex-col gap-3 text-sm">
        {sentLink ? (
          <>
            <p className="text-sm text-[var(--muted-foreground)]">
              Invite created. No email provider is configured in this environment, so share this
              link with the invitee directly — it expires after a few days:
            </p>
            <p className="break-all rounded-md bg-[var(--muted)] p-2 font-mono text-xs">{sentLink}</p>
            <DialogFooter>
              <Button size="sm" onClick={handleClose}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invite-name">Name</Label>
              <Input id="invite-name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                inputMode="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <Select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as RoleCode)}>
                {INVITE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </div>
            <FormError>{serverError}</FormError>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={inviteMutation.isPending}
                onClick={() => inviteMutation.mutate()}
              >
                {inviteMutation.isPending ? 'Sending…' : 'Send Invite'}
              </Button>
            </DialogFooter>
          </>
        )}
      </div>
    </Dialog>
  )
}
