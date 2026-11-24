import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'

import { hasPermission, isManagerOrAbove } from '@/api/auth'
import { ApiError } from '@/api/client'
import { type Project, type ProjectUpdateRequest, deleteProject, getProject, updateProject } from '@/api/projects'
import { listUsers } from '@/api/users'
import { NoAccess } from '@/components/NoAccess'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { FormError } from '@/components/ui/form-field'
import { PageHeader } from '@/components/ui/PageHeader'
import { DetailSkeleton } from '@/components/ui/skeleton'
import { useConfirm } from '@/components/ui/useConfirm'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'

import { ProjectNavSettings } from './ProjectNavSettings'
import { ProjectForm, type ProjectFormValues } from './ProjectForm'

// ADR-122: the Settings tab (project.edit). The Details card and the Delete button moved here from
// the former Details page unchanged; the navigation card is new.
export function ProjectSettings() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const { user } = useAuth()
  const projectQuery = useQuery({ queryKey: ['projects', projectId], queryFn: () => getProject(projectId) })
  if (projectQuery.isLoading) return <DetailSkeleton />
  if (projectQuery.isError)
    return (
      <ErrorState message="Could not load this project." error={projectQuery.error} onRetry={() => projectQuery.refetch()} />
    )
  const project = projectQuery.data
  if (!project)
    return <EmptyState title="Project not found" description="It may have been deleted, or you may not have access to it." />
  // The page variant carries the <h1> this tab needs (only Overview has the project name as <h1>).
  if (!hasPermission(user, 'project.edit')) return <NoAccess />
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Project settings"
        description="Edit the project, choose which tabs it shows, or delete it."
        actions={isManagerOrAbove(user) ? <DeleteProjectButton project={project} /> : undefined}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ProjectDetailsCard project={project} />
        <ProjectNavSettings project={project} />
      </div>
    </div>
  )
}

export function ProjectDetailsCard({ project }: { project: Project }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const canManage = isManagerOrAbove(user)
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers, enabled: canManage })

  const updateMutation = useMutation({
    mutationFn: (req: ProjectUpdateRequest) => updateProject(project.id, req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      showToast('success', 'Project updated')
    },
    // No onError toast -- `updateError` below already renders this inline.
  })
  const updateError = updateMutation.error instanceof ApiError ? updateMutation.error.message : null

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
      </CardHeader>
      <CardContent>
        {canManage ? (
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
  )
}

export function DeleteProjectButton({ project }: { project: Project }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const { ask, dialog: confirmDialog } = useConfirm()
  const deleteMutation = useMutation({
    mutationFn: () => deleteProject(project.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      navigate('/projects')
      showToast('success', 'Project deleted')
    },
    // No onError toast -- `deleteError` below already renders this inline.
  })
  const deleteError = deleteMutation.error instanceof ApiError ? deleteMutation.error.message : null
  return (
    <>
      <Button
        variant="destructive"
        size="sm"
        onClick={() =>
          ask({
            title: `Delete project “${project.name}”?`,
            description: `This permanently deletes the project and everything in it: ${project.test_case_count} test case${project.test_case_count === 1 ? '' : 's'}, ${project.test_run_count} test run${project.test_run_count === 1 ? '' : 's'}, requirements, suites, plans and their results. This cannot be undone.`,
            confirmLabel: 'Delete project',
            requireText: project.name,
            run: () => deleteMutation.mutateAsync(),
          })
        }
        disabled={deleteMutation.isPending}
      >
        Delete Project
      </Button>
      {confirmDialog}
      <FormError>{deleteError}</FormError>
    </>
  )
}
