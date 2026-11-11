import { Fragment, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError } from '@/api/client'
import {
  createRole,
  deactivateRole,
  listPermissions,
  listRoles,
  updateRole,
  type Permission,
  type Role,
} from '@/api/roles'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/lib/toast'

function groupByPrefix(permissions: Permission[]): Record<string, Permission[]> {
  const groups: Record<string, Permission[]> = {}
  for (const p of permissions) {
    const prefix = p.code.split('.')[0] ?? 'other'
    groups[prefix] ??= []
    groups[prefix].push(p)
  }
  return groups
}

export function RolesPermissions() {
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Role | null>(null)

  const rolesQuery = useQuery({ queryKey: ['roles'], queryFn: listRoles })
  const permissionsQuery = useQuery({ queryKey: ['permissions'], queryFn: listPermissions })
  const grouped = useMemo(
    () => groupByPrefix(permissionsQuery.data ?? []),
    [permissionsQuery.data],
  )

  const deactivateMutation = useMutation({
    mutationFn: (roleId: string) => deactivateRole(roleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] })
      showToast('success', 'Role deactivated')
    },
    // No onError toast -- `deactivateError` below already renders this
    // inline, avoiding the duplicate-text strict-mode-locator problem
    // confirmed by a real Playwright failure elsewhere in this pass.
  })
  const deactivateError =
    deactivateMutation.error instanceof ApiError ? deactivateMutation.error.message : null

  const roles = rolesQuery.data ?? []
  const permissions = permissionsQuery.data ?? []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Roles &amp; Permissions</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Admin, Manager, and Tester are built-in and can't be edited or removed. Define
            additional roles below with any combination of permissions.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          New Role
        </Button>
      </div>

      {deactivateError && <p className="text-xs text-[var(--destructive)]">{deactivateError}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Permission Matrix</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-[var(--muted-foreground)]">
                <tr>
                  <th className="px-2 py-2 font-medium">Permission</th>
                  {roles.map((r) => (
                    <th key={r.id} className="px-2 py-2 text-center font-medium">
                      <div className="flex flex-col items-center gap-1">
                        <span>{r.name}</span>
                        {r.is_system && <Badge tone="neutral">system</Badge>}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(grouped).map(([group, perms]) => (
                  <Fragment key={group}>
                    <tr className="border-t border-[var(--border)]">
                      <td
                        colSpan={roles.length + 1}
                        className="px-2 py-1 text-xs font-semibold uppercase text-[var(--muted-foreground)]"
                      >
                        {group}
                      </td>
                    </tr>
                    {perms.map((p) => (
                      <tr key={p.code} className="border-t border-[var(--border)]">
                        <td className="px-2 py-2">
                          <div className="font-mono text-xs">{p.code}</div>
                          {p.description && (
                            <div className="text-xs text-[var(--muted-foreground)]">
                              {p.description}
                            </div>
                          )}
                        </td>
                        {roles.map((r) => (
                          <td key={r.id} className="px-2 py-2 text-center">
                            {r.permission_codes.includes(p.code) ? '✓' : ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Roles</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2">
            {roles.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded border border-[var(--border)] px-3 py-2"
              >
                <div>
                  <div className="font-medium">
                    {r.name} {r.is_system && <Badge tone="neutral">system</Badge>}
                    {!r.is_active && <Badge tone="critical">inactive</Badge>}
                  </div>
                  <div className="text-xs text-[var(--muted-foreground)]">
                    {r.user_count} user(s) · {r.permission_codes.length} permission(s)
                  </div>
                </div>
                {!r.is_system && (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditTarget(r)}>
                      Edit
                    </Button>
                    {r.is_active && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => deactivateMutation.mutate(r.id)}
                      >
                        Deactivate
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <RoleFormDialog
        mode="create"
        open={createOpen}
        permissions={permissions}
        role={null}
        onClose={() => setCreateOpen(false)}
      />
      <RoleFormDialog
        mode="edit"
        open={!!editTarget}
        permissions={permissions}
        role={editTarget}
        onClose={() => setEditTarget(null)}
      />
    </div>
  )
}

function RoleFormDialog({
  mode,
  open,
  role,
  permissions,
  onClose,
}: {
  mode: 'create' | 'edit'
  open: boolean
  role: Role | null
  permissions: Permission[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const [name, setName] = useState(role?.name ?? '')
  const [selected, setSelected] = useState<Set<string>>(new Set(role?.permission_codes ?? []))

  const mutation = useMutation({
    mutationFn: () => {
      const codes = Array.from(selected)
      return mode === 'create'
        ? createRole({ name, permission_codes: codes })
        : updateRole(role!.id, { name, permission_codes: codes })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] })
      showToast('success', mode === 'create' ? 'Role created' : 'Role updated')
      handleClose()
    },
  })

  const serverError = mutation.error instanceof ApiError ? mutation.error.message : null

  function handleClose() {
    setName('')
    setSelected(new Set())
    mutation.reset()
    onClose()
  }

  function toggle(code: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  // Resync local state whenever the dialog opens for a (possibly new) role.
  const openKey = `${open}-${role?.id ?? 'new'}`
  const [lastKey, setLastKey] = useState(openKey)
  if (openKey !== lastKey) {
    setLastKey(openKey)
    setName(role?.name ?? '')
    setSelected(new Set(role?.permission_codes ?? []))
  }

  if (!open) return null

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={mode === 'create' ? 'New Role' : `Edit Role — ${role?.name}`}
    >
      <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto text-sm">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="role-name">Role Name</Label>
          <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label>Permissions</Label>
          {permissions.map((p) => (
            <label key={p.code} className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={selected.has(p.code)}
                onChange={() => toggle(p.code)}
                className="mt-0.5"
              />
              <span>
                <span className="font-mono">{p.code}</span>
                {p.description && (
                  <span className="text-[var(--muted-foreground)]"> — {p.description}</span>
                )}
              </span>
            </label>
          ))}
        </div>
        {serverError && <p className="text-xs text-[var(--destructive)]">{serverError}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={mutation.isPending || !name.trim()}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Saving…' : 'Save Role'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
