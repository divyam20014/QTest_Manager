import { Fragment, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, ChevronRight, Minus } from 'lucide-react'

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
import { TableSkeleton } from '@/components/ui/skeleton'
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
  const isLoading = rolesQuery.isLoading || permissionsQuery.isLoading

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

      {isLoading ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Permission Matrix</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <tbody>
                <TableSkeleton rows={6} columns={4} />
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : (
        <PermissionMatrix roles={roles} grouped={grouped} />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Roles</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2">
            {roles.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-4 py-3 transition-colors hover:bg-[var(--muted)]/40"
              >
                <div>
                  <div className="flex items-center gap-2 font-medium">
                    {r.name}
                    {r.is_system && <Badge tone="neutral">system</Badge>}
                    {!r.is_active && <Badge tone="critical">inactive</Badge>}
                  </div>
                  <div className="text-xs text-[var(--muted-foreground)]">
                    {r.user_count} user{r.user_count === 1 ? '' : 's'} · {r.permission_codes.length}{' '}
                    permission{r.permission_codes.length === 1 ? '' : 's'}
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

// Interactive permission matrix: system roles (Admin/Manager/Tester) stay
// read-only (their permission sets are fixed by the backend seed, not
// user-editable), but custom roles get inline toggle cells with a local
// "dirty" draft per role column, committed via the same PATCH /roles/{id}
// endpoint the Edit-role dialog already uses (full permission_codes
// replacement) -- no new backend contract needed.
function PermissionMatrix({
  roles,
  grouped,
}: {
  roles: Role[]
  grouped: Record<string, Permission[]>
}) {
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const groupNames = Object.keys(grouped)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  // roleId -> draft set of permission codes, only present while that
  // role's column has unsaved changes.
  const [drafts, setDrafts] = useState<Record<string, Set<string>>>({})

  const saveMutation = useMutation({
    mutationFn: ({ roleId, codes }: { roleId: string; codes: string[] }) =>
      updateRole(roleId, { permission_codes: codes }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['roles'] })
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[variables.roleId]
        return next
      })
      showToast('success', 'Permissions saved')
    },
  })
  const saveError = saveMutation.error instanceof ApiError ? saveMutation.error.message : null

  function toggleGroup(group: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  function currentCodes(role: Role): Set<string> {
    return drafts[role.id] ?? new Set(role.permission_codes)
  }

  function ensureDraft(role: Role): Set<string> {
    const existing = drafts[role.id]
    if (existing) return existing
    const seeded = new Set(role.permission_codes)
    setDrafts((prev) => ({ ...prev, [role.id]: seeded }))
    return seeded
  }

  function toggleCell(role: Role, code: string) {
    if (role.is_system) return
    const base = ensureDraft(role)
    const next = new Set(base)
    if (next.has(code)) next.delete(code)
    else next.add(code)
    setDrafts((prev) => ({ ...prev, [role.id]: next }))
  }

  function setGroupAll(role: Role, codes: string[], enabled: boolean) {
    if (role.is_system) return
    const base = new Set(ensureDraft(role))
    for (const code of codes) {
      if (enabled) base.add(code)
      else base.delete(code)
    }
    setDrafts((prev) => ({ ...prev, [role.id]: base }))
  }

  function cancelDraft(roleId: string) {
    setDrafts((prev) => {
      const next = { ...prev }
      delete next[roleId]
      return next
    })
  }

  function saveDraft(role: Role) {
    const codes = Array.from(currentCodes(role))
    saveMutation.mutate({ roleId: role.id, codes })
  }

  const editableRoles = roles.filter((r) => !r.is_system)
  const dirtyRoleIds = Object.keys(drafts)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Permission Matrix</CardTitle>
        <p className="text-xs text-[var(--muted-foreground)]">
          Click a cell to toggle a permission for a custom role. System roles are fixed and shown
          for reference only.
        </p>
      </CardHeader>
      <CardContent>
        {saveError && <p className="mb-2 text-xs text-[var(--destructive)]">{saveError}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-[var(--muted-foreground)]">
              <tr>
                <th className="sticky left-0 bg-[var(--background)] px-2 py-2 font-medium">
                  Permission
                </th>
                {roles.map((r) => {
                  const isDirty = dirtyRoleIds.includes(r.id)
                  return (
                    <th key={r.id} className="min-w-[7rem] px-2 py-2 text-center font-medium">
                      <div className="flex flex-col items-center gap-1">
                        <span className="flex items-center gap-1">
                          {r.name}
                          {isDirty && (
                            <span
                              className="size-1.5 rounded-full bg-[var(--status-warning)]"
                              title="Unsaved changes"
                            />
                          )}
                        </span>
                        {r.is_system && <Badge tone="neutral">system</Badge>}
                        {isDirty && (
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              className="h-6 px-2 text-xs"
                              disabled={saveMutation.isPending}
                              onClick={() => saveDraft(r)}
                            >
                              {saveMutation.isPending ? 'Saving…' : 'Save'}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 px-2 text-xs"
                              onClick={() => cancelDraft(r.id)}
                            >
                              Cancel
                            </Button>
                          </div>
                        )}
                      </div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {groupNames.map((group) => {
                const perms = grouped[group]
                const collapsed = collapsedGroups.has(group)
                return (
                  <Fragment key={group}>
                    <tr className="border-t border-[var(--border)] bg-[var(--muted)]/40">
                      <td className="sticky left-0 bg-[var(--muted)]/40 px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => toggleGroup(group)}
                          aria-expanded={!collapsed}
                          className="flex items-center gap-1 text-xs font-semibold uppercase text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                        >
                          {collapsed ? (
                            <ChevronRight className="size-3.5" />
                          ) : (
                            <ChevronDown className="size-3.5" />
                          )}
                          {group}
                        </button>
                      </td>
                      {editableRoles.length > 0 &&
                        roles.map((r) => {
                          if (r.is_system) return <td key={r.id} />
                          const codes = perms.map((p) => p.code)
                          const current = currentCodes(r)
                          const allOn = codes.every((c) => current.has(c))
                          const allOff = codes.every((c) => !current.has(c))
                          return (
                            <td key={r.id} className="px-2 py-1.5 text-center">
                              {!collapsed && (
                                <div className="flex justify-center gap-1 text-[10px]">
                                  <button
                                    type="button"
                                    disabled={allOn}
                                    onClick={() => setGroupAll(r, codes, true)}
                                    className="rounded px-1 text-[var(--link)] hover:underline disabled:opacity-40 disabled:no-underline"
                                  >
                                    All
                                  </button>
                                  <span className="text-[var(--muted-foreground)]">/</span>
                                  <button
                                    type="button"
                                    disabled={allOff}
                                    onClick={() => setGroupAll(r, codes, false)}
                                    className="rounded px-1 text-[var(--link)] hover:underline disabled:opacity-40 disabled:no-underline"
                                  >
                                    None
                                  </button>
                                </div>
                              )}
                            </td>
                          )
                        })}
                    </tr>
                    {!collapsed &&
                      perms.map((p) => (
                        <tr key={p.code} className="border-t border-[var(--border)]">
                          <td className="sticky left-0 bg-[var(--background)] px-2 py-2">
                            <div className="font-mono text-xs">{p.code}</div>
                            {p.description && (
                              <div className="text-xs text-[var(--muted-foreground)]">
                                {p.description}
                              </div>
                            )}
                          </td>
                          {roles.map((r) => {
                            const checked = currentCodes(r).has(p.code)
                            if (r.is_system) {
                              return (
                                <td key={r.id} className="px-2 py-2 text-center">
                                  {checked ? (
                                    <Check className="mx-auto size-4 text-[var(--status-good)]" />
                                  ) : (
                                    <Minus className="mx-auto size-3.5 text-[var(--muted-foreground)]/40" />
                                  )}
                                </td>
                              )
                            }
                            return (
                              <td key={r.id} className="px-2 py-2 text-center">
                                <button
                                  type="button"
                                  role="checkbox"
                                  aria-checked={checked}
                                  aria-label={`${checked ? 'Disable' : 'Enable'} ${p.code} for ${r.name}`}
                                  onClick={() => toggleCell(r, p.code)}
                                  className={`mx-auto flex size-6 items-center justify-center rounded-md border transition-colors ${
                                    checked
                                      ? 'border-[var(--status-good)] bg-[var(--status-good-bg)] text-[var(--status-good)]'
                                      : 'border-[var(--border)] text-transparent hover:bg-[var(--muted)]'
                                  }`}
                                >
                                  <Check className="size-3.5" />
                                </button>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
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
