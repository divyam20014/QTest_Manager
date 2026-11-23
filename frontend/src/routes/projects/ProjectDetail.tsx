import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'

import { isManagerOrAbove } from '@/api/auth'
import { getProject } from '@/api/projects'
import { buttonVariants } from '@/components/ui/button'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/PageHeader'
import { DetailSkeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/lib/auth'

import { ProjectDrilldown } from './ProjectDrilldown'
import { TestPlansCard, TestSuitesCard } from './ProjectPlanning'
import { BuildsReleasesCard } from './ProjectReleases'
import { DeleteProjectButton, ProjectDetailsCard } from './ProjectSettings'
import { TeamMembersCard } from './ProjectTeam'

/**
 * The legacy /projects/:id/details page (ADR-122). Its sections now live in their own tabs
 * (Settings, Team, Planning, Releases, Activity); this page keeps the old URL working by showing
 * the same cards together. It adds no logic of its own.
 */
export function ProjectDetail() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const { user } = useAuth()
  const canManage = isManagerOrAbove(user)

  const projectQuery = useQuery({
    queryKey: ['projects', projectId],
    queryFn: () => getProject(projectId),
    enabled: !!projectId,
  })

  const project = projectQuery.data
  if (projectQuery.isLoading) return <DetailSkeleton />
  if (projectQuery.isError) return <ErrorState message="Could not load this project." error={projectQuery.error} onRetry={() => projectQuery.refetch()} />
  if (!project) return <EmptyState title="Project not found" description="It may have been deleted, or you may not have access to it." />

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Project details"
        description="Everything about this project on one page. Each section also has its own tab."
        actionsClassName="grid grid-cols-2 md:flex md:flex-wrap [&>a]:justify-center"
        actions={
          <>
            <Link
              to={`/projects/${project.id}/traceability-matrix`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Traceability Matrix
            </Link>
            <Link
              to={`/reporting?project=${project.id}`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Release Readiness
            </Link>
            {canManage && <DeleteProjectButton project={project} />}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricTile label="Test Cases" value={project.test_case_count} />
        <MetricTile label="Approved" value={project.approved_test_case_count} />
        <MetricTile label="Test Runs" value={project.test_run_count} />
        <MetricTile label="Open Defects" value={project.open_defect_count} />
      </div>

      <ProjectDrilldown projectId={project.id} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ProjectDetailsCard project={project} />
        <TeamMembersCard projectId={project.id} assignedUserIds={project.assigned_user_ids} />
        <BuildsReleasesCard projectId={project.id} canManage={canManage} />
        <TestSuitesCard projectId={project.id} canManage={canManage} />
        <TestPlansCard projectId={project.id} canManage={canManage} />
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
