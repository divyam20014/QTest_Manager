import { Settings } from 'lucide-react'
import { Link } from 'react-router-dom'

import { fetchProjectTestStatus } from '@/api/projectDashboard'
import type { Project } from '@/api/projects'
import { RecordPin } from '@/components/RecordPin'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Skeleton } from '@/components/ui/skeleton'
import { type ProjectTabKey, approvedProgress } from '@/lib/projectNav'

import { ProjectSwitcher } from './ProjectSwitcher'
import { useOverviewQuery } from './overview/shared'
import { PRIORITY_TONE, STATUS_TONE } from './statusDisplay'

/**
 * Progress in the header: how much of the project's test cases have been executed and the pass
 * rate (the same aggregate the Overview's key numbers use, one shared request). Until it is
 * available, or if the viewer may not read it, it falls back to the approved share of the counts
 * the project already carries.
 */
function ProjectProgress({ project }: { project: Project }) {
  const status = useOverviewQuery(project.id, ['test-status'], () => fetchProjectTestStatus(project.id))
  const s = status.data
  if (s && s.total > 0) {
    const percent = Math.round(s.execution_percentage ?? 0)
    return (
      <>
        <span
          role="progressbar"
          aria-label="Test execution progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={`${s.executed} of ${s.total} test cases executed`}
          className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--muted)]"
        >
          <span className="block h-full bg-[var(--primary)]" style={{ width: `${percent}%` }} />
        </span>
        <span className="tabular-nums">
          {percent}% executed ({s.executed}/{s.total})
          {s.pass_rate != null && <> · {Math.round(s.pass_rate)}% case pass rate</>}
        </span>
      </>
    )
  }
  const progress = approvedProgress(project)
  if (progress === null) return <span>0 test cases</span>
  return (
    <>
      <span
        role="progressbar"
        aria-label="Approved test cases"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-valuetext={`${project.approved_test_case_count} of ${project.test_case_count} test cases approved`}
        className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--muted)]"
      >
        <span className="block h-full bg-[var(--primary)]" style={{ width: `${progress}%` }} />
      </span>
      <span className="tabular-nums">
        {progress}% approved ({project.approved_test_case_count}/{project.test_case_count})
      </span>
    </>
  )
}

/**
 * Header of the project workspace (ADR-122): name, status, owner, progress, favourite star, the
 * project switcher and a Settings shortcut. The name is the page's <h1> only on Overview; every
 * other tab keeps its own page heading, so a page never has two.
 */
export function ProjectHeader({
  project,
  tabKey,
  asHeading,
  canOpenSettings,
}: {
  project: Project | undefined
  tabKey: ProjectTabKey | null
  asHeading: boolean
  canOpenSettings: boolean
}) {
  if (!project) {
    return (
      <div role="status" className="flex flex-col gap-2">
        <span className="sr-only">Loading project</span>
        <Skeleton className="h-7 w-64 max-w-full" />
        <Skeleton className="h-4 w-48 max-w-full" />
      </div>
    )
  }
  const Name = asHeading ? 'h1' : 'p'
  return (
    <div data-testid="project-header" className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Name className="qth-type-page-title min-w-0 break-words">{project.name}</Name>
        <ProjectSwitcher projectId={project.id} projectName={project.name} tabKey={tabKey} />
        <RecordPin type="project" id={project.id} title={project.name} url={`/projects/${project.id}`} />
        <StatusBadge tone={STATUS_TONE[project.status]}>{project.status}</StatusBadge>
        <StatusBadge tone={PRIORITY_TONE[project.priority]}>{project.priority}</StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--muted-foreground)]">
        <span data-testid="project-owner">
          Owner: <span className="text-[var(--foreground)]">{project.manager_name}</span>
        </span>
        <span data-testid="project-progress" className="flex items-center gap-2">
          <ProjectProgress project={project} />
        </span>
        {canOpenSettings && (
          <Link
            to={`/projects/${project.id}/settings`}
            aria-label="Project settings"
            title="Project settings"
            data-testid="project-settings-shortcut"
            className="inline-flex size-8 items-center justify-center rounded-[var(--radius-control)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] max-md:size-11 [&_svg]:size-4"
          >
            <Settings aria-hidden="true" />
          </Link>
        )}
      </div>
    </div>
  )
}
