import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'

import { hasPermission, isManagerOrAbove } from '@/api/auth'
import { ApiError } from '@/api/client'
import { addTeamToProject, describeTeamAdd, listTeams } from '@/api/teams'
import {
  addProjectMember,
  getProject,
  listProjectMembers,
  removeProjectMember,
  setProjectMemberRole,
} from '@/api/projects'
import { listAssignableRoles } from '@/api/roles'
import { listUsers } from '@/api/users'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DetailSkeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/PageHeader'
import { Select } from '@/components/ui/select'
import { useConfirm } from '@/components/ui/useConfirm'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'

// ADR-122: the Team tab. TeamMembersCard moved here from the former Details page; the mutations, queries and permission gates are the same.
export function ProjectTeam() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const projectQuery = useQuery({ queryKey: ['projects', projectId], queryFn: () => getProject(projectId) })
  if (projectQuery.isLoading) return <DetailSkeleton />
  if (projectQuery.isError)
    return (
      <ErrorState message="Could not load this project." error={projectQuery.error} onRetry={() => projectQuery.refetch()} />
    )
  if (!projectQuery.data)
    return <EmptyState title="Project not found" description="It may have been deleted, or you may not have access to it." />
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Team"
        description="Who works on this project. A project role replaces a person’s role for everything in this project."
      />
      <div className="flex max-w-3xl flex-col gap-4">
        <TeamMembersCard projectId={projectId} assignedUserIds={projectQuery.data.assigned_user_ids} />
        {!projectQuery.data.archived_at && <AddTeamCard projectId={projectId} />}
      </div>
    </div>
  )
}

/** ADR-141: add everyone in a team at once. Shown to those who may add members, when teams exist. */
export function AddTeamCard({ projectId }: { projectId: string }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const [teamId, setTeamId] = useState('')
  const canManage = isManagerOrAbove(user) && hasPermission(user, 'project.members.manage')
  const teams = useQuery({ queryKey: ['teams'], queryFn: listTeams, enabled: canManage })

  const add = useMutation({
    mutationFn: () => addTeamToProject(projectId, teamId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] })
      setTeamId('')
      showToast('success', describeTeamAdd(result))
    },
    onError: (err) => showToast('error', err instanceof ApiError ? err.message : 'Could not add that team'),
  })

  if (!canManage || !teams.data?.length) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a team</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Select aria-label="Team to add to the project" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">Select a team…</option>
            {teams.data.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.members.length})
              </option>
            ))}
          </Select>
          <Button size="sm" disabled={!teamId || add.isPending} onClick={() => add.mutate()}>
            Add team
          </Button>
        </div>
        <p className="text-xs text-[var(--muted-foreground)]">
          Adds the people in the team now, each with their own role. Later changes to the team do not change this
          project.
        </p>
      </CardContent>
    </Card>
  )
}

export function TeamMembersCard({ projectId, assignedUserIds }: { projectId: string; assignedUserIds: string[] }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [newMemberId, setNewMemberId] = useState('')
  const { show: showToast } = useToast()
  const { ask, dialog: confirmDialog } = useConfirm()

  const canManage = () => isManagerOrAbove(user)
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers, enabled: canManage() })

  // RBAC Phase 1: project-scoped role overrides -- loaded alongside the
  // member list only when the viewer can manage membership, same gate as
  // the rest of this card.
  const projectRolesQuery = useQuery({
    queryKey: ['projects', projectId, 'members-with-roles'],
    queryFn: () => listProjectMembers(projectId),
    enabled: canManage(),
  })
  const assignableRolesQuery = useQuery({
    queryKey: ['roles', 'assignable'],
    queryFn: listAssignableRoles,
    enabled: canManage(),
  })

  const setMemberRoleMutation = useMutation({
    mutationFn: ({ userId, roleId }: { userId: string; roleId: string | null }) =>
      setProjectMemberRole(projectId, userId, roleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'members-with-roles'] })
      showToast('success', 'Project role updated')
    },
    // A refusal says why: for example, which permissions you do not hold here (ADR-143).
    onError: (err) =>
      showToast('error', err instanceof ApiError ? err.message : 'Could not update that member’s project role'),
  })

  const addMemberMutation = useMutation({
    mutationFn: (userId: string) => addProjectMember(projectId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] })
      setNewMemberId('')
      showToast('success', 'Member added')
    },
    onError: () => showToast('error', 'Could not add that member'),
  })

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => removeProjectMember(projectId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] })
      showToast('success', 'Member removed')
    },
    onError: (err) => showToast('error', err instanceof ApiError ? err.message : 'Could not remove that member'),
  })

  const assignableUsers = (usersQuery.data ?? []).filter((u) => !assignedUserIds.includes(u.id))
  const memberUsers = (usersQuery.data ?? []).filter((u) => assignedUserIds.includes(u.id))

  return (
    <Card>
      {confirmDialog}
      <CardHeader>
        <CardTitle>Team Members</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col gap-2 text-sm">
          {memberUsers.length === 0 && <li className="text-[var(--muted-foreground)]">No members assigned.</li>}
          {memberUsers.map((member) => {
            const projectRole = projectRolesQuery.data?.find((m) => m.user_id === member.id)
            return (
              <li key={member.id} className="flex flex-col gap-1 border-b border-[var(--border)] pb-2 last:border-none last:pb-0">
                <div className="flex items-center justify-between">
                  <span>
                    {member.name} <span className="text-xs text-[var(--muted-foreground)]">({member.role})</span>
                  </span>
                  {canManage() && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        ask({
                          title: `Remove ${member.name} from this project?`,
                          description: `${member.name} loses access to this project and any project-scoped role they hold here. Their account and past work are not affected, and you can add them back.`,
                          confirmLabel: 'Remove member',
                          run: () => removeMemberMutation.mutateAsync(member.id),
                        })
                      }
                      disabled={removeMemberMutation.isPending}
                    >
                      Remove
                    </Button>
                  )}
                </div>
                {canManage() && assignableRolesQuery.data && (
                  <div className="flex items-center gap-2">
                    <label htmlFor={`project-role-${member.id}`} className="text-xs text-[var(--muted-foreground)] whitespace-nowrap">
                      Project role
                    </label>
                    <Select
                      id={`project-role-${member.id}`}
                      aria-label={`Project-scoped role override for ${member.name}`}
                      value={projectRole?.project_role_id ?? ''}
                      onChange={(e) =>
                        setMemberRoleMutation.mutate({
                          userId: member.id,
                          roleId: e.target.value || null,
                        })
                      }
                      disabled={setMemberRoleMutation.isPending}
                    >
                      <option value="">Use tenant role ({member.role})</option>
                      {/* ADR-143: Admin is an organization role and cannot be a project role. */}
                      {assignableRolesQuery.data
                        .filter((r) => (r.is_active && r.code !== 'admin') || r.id === projectRole?.project_role_id)
                        .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        {canManage() && assignableUsers.length > 0 && (
          <div className="flex gap-2 border-t border-[var(--border)] pt-3">
            <Select
              id="add-member-select"
              aria-label="Select a user to add to the project"
              value={newMemberId}
              onChange={(e) => setNewMemberId(e.target.value)}
            >
              <option value="">Select a user…</option>
              {assignableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.role})
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              disabled={!newMemberId || addMemberMutation.isPending}
              onClick={() => addMemberMutation.mutate(newMemberId)}
            >
              Add
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
