import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import {
  addProjectMember,
  deleteProject,
  getProject,
  removeProjectMember,
  updateProject,
  type ProjectUpdateRequest,
} from '@/api/projects'
import { listUsers } from '@/api/users'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { useAuth } from '@/lib/auth'
import { ProjectForm, type ProjectFormValues } from './ProjectForm'
import { PRIORITY_TONE, STATUS_TONE } from './statusDisplay'

export function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [newMemberId, setNewMemberId] = useState('')

  const projectQuery = useQuery({
    queryKey: ['projects', projectId],
    queryFn: () => getProject(projectId!),
    enabled: !!projectId,
  })

  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers, enabled: canManage() })

  function canManage() {
    return user?.role === 'admin' || user?.role === 'manager'
  }

  const updateMutation = useMutation({
    mutationFn: (req: ProjectUpdateRequest) => updateProject(projectId!, req),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects', projectId] }),
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteProject(projectId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      navigate('/projects')
    },
  })

  const addMemberMutation = useMutation({
    mutationFn: (userId: string) => addProjectMember(projectId!, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] })
      setNewMemberId('')
    },
  })

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => removeProjectMember(projectId!, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects', projectId] }),
  })

  const project = projectQuery.data
  if (projectQuery.isLoading) return <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>
  if (projectQuery.isError || !project) return <p className="text-sm text-[var(--destructive)]">Project not found.</p>

  const formValues: ProjectFormValues = {
    name: project.name,
    domain: project.domain,
    priority: project.priority,
    status: project.status,
    manager_name: project.manager_name,
    manager_user_id: project.manager_user_id ?? '',
    start_date: project.start_date,
    end_date: project.end_date,
    budget: project.budget,
    region: project.region,
  }

  const assignableUsers = (usersQuery.data ?? []).filter((u) => !project.assigned_user_ids.includes(u.id))
  const memberUsers = (usersQuery.data ?? []).filter((u) => project.assigned_user_ids.includes(u.id))

  const updateError = updateMutation.error instanceof ApiError ? updateMutation.error.message : null
  const deleteError = deleteMutation.error instanceof ApiError ? deleteMutation.error.message : null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">{project.name}</h1>
          <Badge tone={STATUS_TONE[project.status]}>{project.status}</Badge>
          <Badge tone={PRIORITY_TONE[project.priority]}>{project.priority}</Badge>
        </div>
        <div className="flex gap-2">
          <Link to={`/projects/${project.id}/requirements`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Requirements
          </Link>
          <Link to={`/projects/${project.id}/test-cases`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Test Cases
          </Link>
          <Link to={`/projects/${project.id}/test-runs`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Test Runs
          </Link>
          {canManage() && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              Delete Project
            </Button>
          )}
        </div>
      </div>
      {deleteError && <p className="text-xs text-[var(--destructive)]">{deleteError}</p>}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricTile label="Test Cases" value={project.test_case_count} />
        <MetricTile label="Approved" value={project.approved_test_case_count} />
        <MetricTile label="Test Runs" value={project.test_run_count} />
        <MetricTile label="Open Defects" value={project.open_defect_count} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            {canManage() ? (
              <ProjectForm
                defaultValues={formValues}
                submitLabel="Save Changes"
                isSubmitting={updateMutation.isPending}
                serverError={updateError}
                users={usersQuery.data ?? []}
                onSubmit={(values) => updateMutation.mutate(values)}
              />
            ) : (
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-[var(--muted-foreground)]">Domain</dt>
                <dd>{project.domain}</dd>
                <dt className="text-[var(--muted-foreground)]">Status</dt>
                <dd>{project.status}</dd>
                <dt className="text-[var(--muted-foreground)]">Priority</dt>
                <dd>{project.priority}</dd>
                <dt className="text-[var(--muted-foreground)]">Manager</dt>
                <dd>{project.manager_name}</dd>
                <dt className="text-[var(--muted-foreground)]">Dates</dt>
                <dd>
                  {project.start_date} → {project.end_date}
                </dd>
                <dt className="text-[var(--muted-foreground)]">Budget</dt>
                <dd>
                  {project.currency_code} {project.budget}
                </dd>
                <dt className="text-[var(--muted-foreground)]">Region</dt>
                <dd>{project.region}</dd>
              </dl>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Team Members</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ul className="flex flex-col gap-2 text-sm">
              {memberUsers.length === 0 && <li className="text-[var(--muted-foreground)]">No members assigned.</li>}
              {memberUsers.map((member) => (
                <li key={member.id} className="flex items-center justify-between">
                  <span>
                    {member.name} <span className="text-xs text-[var(--muted-foreground)]">({member.role})</span>
                  </span>
                  {canManage() && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeMemberMutation.mutate(member.id)}
                      disabled={removeMemberMutation.isPending}
                    >
                      Remove
                    </Button>
                  )}
                </li>
              ))}
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
      </div>
    </div>
  )
}

function MetricTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <div className="text-xs text-[var(--muted-foreground)]">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  )
}
