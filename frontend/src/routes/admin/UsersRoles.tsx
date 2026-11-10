import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError } from '@/api/client'
import type { RoleCode } from '@/api/auth'
import {
  createUser,
  deactivateUser,
  inviteUser,
  listUsers,
  resetPassword,
  updateUser,
  type User,
} from '@/api/users'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { useAuth } from '@/lib/auth'

const ROLES: RoleCode[] = ['admin', 'manager', 'tester']

export function UsersRoles() {
  const { user: currentUser } = useAuth()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [resetTarget, setResetTarget] = useState<User | null>(null)

  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers })

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: RoleCode }) => updateUser(id, { role }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  })

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => deactivateUser(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  })

  const activateMutation = useMutation({
    mutationFn: (id: string) => updateUser(id, { is_active: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Users &amp; Roles</h1>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            Invite User
          </Button>
          <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
            New User (set password directly)
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--muted)] text-left text-xs text-[var(--muted-foreground)]">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {usersQuery.data?.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                isSelf={u.id === currentUser?.user_id}
                onRoleChange={(role) => roleMutation.mutate({ id: u.id, role })}
                onDeactivate={() => deactivateMutation.mutate(u.id)}
                onActivate={() => activateMutation.mutate(u.id)}
                onResetPassword={() => setResetTarget(u)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <NewUserDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <InviteUserDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
      <ResetPasswordDialog
        user={resetTarget}
        onClose={() => setResetTarget(null)}
      />
    </div>
  )
}

function UserRow({
  user,
  isSelf,
  onRoleChange,
  onDeactivate,
  onActivate,
  onResetPassword,
}: {
  user: User
  isSelf: boolean
  onRoleChange: (role: RoleCode) => void
  onDeactivate: () => void
  onActivate: () => void
  onResetPassword: () => void
}) {
  return (
    <tr className="border-t border-[var(--border)] hover:bg-[var(--muted)]">
      <td className="px-4 py-2 font-medium">
        {user.name} {isSelf && <span className="text-xs text-[var(--muted-foreground)]">(you)</span>}
      </td>
      <td className="px-4 py-2">{user.email}</td>
      <td className="px-4 py-2">
        <Select
          aria-label={`Role for ${user.name}`}
          value={user.role}
          disabled={isSelf}
          onChange={(e) => onRoleChange(e.target.value as RoleCode)}
          className="w-32"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
      </td>
      <td className="px-4 py-2">
        <Badge tone={user.is_active ? 'positive' : 'neutral'}>{user.is_active ? 'Active' : 'Deactivated'}</Badge>
      </td>
      <td className="px-4 py-2 text-right">
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onResetPassword}>
            Reset Password
          </Button>
          {user.is_active && !isSelf && (
            <Button variant="outline" size="sm" onClick={onDeactivate}>
              Deactivate
            </Button>
          )}
          {!user.is_active && (
            <Button variant="outline" size="sm" onClick={onActivate}>
              Activate
            </Button>
          )}
        </div>
      </td>
    </tr>
  )
}

function ResetPasswordDialog({ user, onClose }: { user: User | null; onClose: () => void }) {
  const [password, setPassword] = useState('')

  const resetMutation = useMutation({
    mutationFn: () => resetPassword(user!.id, password),
    onSuccess: () => {
      setPassword('')
      onClose()
    },
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
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="text-xs text-[var(--muted-foreground)]">
            At least 12 characters, with an uppercase letter, a lowercase letter, and a digit. This
            signs the user out of all existing sessions.
          </p>
        </div>
        {serverError && <p className="text-xs text-[var(--destructive)]">{serverError}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={resetMutation.isPending} onClick={() => resetMutation.mutate()}>
            {resetMutation.isPending ? 'Resetting…' : 'Reset Password'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function NewUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<RoleCode>('tester')
  const [password, setPassword] = useState('')

  const createMutation = useMutation({
    mutationFn: () => createUser({ email, name, role, password }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setEmail('')
      setName('')
      setRole('tester')
      setPassword('')
      onClose()
    },
  })

  const serverError = createMutation.error instanceof ApiError ? createMutation.error.message : null

  return (
    <Dialog open={open} onClose={onClose} title="New User">
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="user-name">Name</Label>
          <Input id="user-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="user-email">Email</Label>
          <Input id="user-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="user-role">Role</Label>
          <Select id="user-role" value={role} onChange={(e) => setRole(e.target.value as RoleCode)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="user-password">Temporary Password</Label>
          <Input
            id="user-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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
            {createMutation.isPending ? 'Creating…' : 'Create User'}
          </Button>
        </div>
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

  const inviteMutation = useMutation({
    mutationFn: () => inviteUser({ email, name, role }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      if (data.invite_token) {
        setSentLink(`${window.location.origin}/accept-invite/${data.invite_token}`)
      } else {
        handleClose()
      }
    },
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
            <p className="break-all rounded bg-[var(--muted)] p-2 font-mono text-xs">{sentLink}</p>
            <div className="flex justify-end">
              <Button size="sm" onClick={handleClose}>
                Done
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invite-name">Name</Label>
              <Input id="invite-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <Select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as RoleCode)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </div>
            {serverError && <p className="text-xs text-[var(--destructive)]">{serverError}</p>}
            <div className="flex justify-end gap-2">
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
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}
