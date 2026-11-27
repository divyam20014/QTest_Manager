import { History, Settings } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { fetchProjectTestStatus } from '@/api/projectDashboard'
import type { Project } from '@/api/projects'
import { RecordPin } from '@/components/RecordPin'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Skeleton } from '@/components/ui/skeleton'
import { type ProjectTabKey, approvedProgress, projectActivityPath, projectSettingsPath } from '@/lib/projectNav'
import { cn } from '@/lib/utils'

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

/** An icon link to a project page that is not a tab; it says when you are on that page. */
function HeaderLink({ to, label, testId, children }: { to: string; label: string; testId: string; children: ReactNode }) {
  const current = useLocation().pathname === to
  return (
    <Link
      to={to}
      aria-label={label}
      aria-current={current ? 'page' : undefined}
      title={label}
      data-testid={testId}
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-[var(--radius-control)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] max-md:size-11 [&_svg]:size-4',
        current && 'bg-[var(--muted)] text-[var(--foreground)]',
      )}
    >
      {children}
    </Link>
  )
}

/**
 * Header of the project workspace (ADR-122): name, status, owner, progress, favourite star, the
 * project switcher, and the way into Activity and Settings (ADR-131). The name is the page's <h1> only on Overview; every
 * other tab keeps its own page heading, so a page never has two.
 */
export function ProjectHeader({
  project,
  tabKey,
  asHeading,
  canOpenSettings,
  density = 'full',
}: {
  project: Project | undefined
  tabKey: ProjectTabKey | null
  asHeading: boolean
  canOpenSettings: boolean
  density?: 'full' | 'phone-compact' | 'compact'
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
  const compact = density === 'compact'
  // On phones the details leave a compact header; on a record page they are not rendered at all.
  const details = density === 'phone-compact' ? 'max-md:hidden' : ''
  return (
    <div
      data-testid="project-header"
      data-density={density}
      className={cn(
        'relative flex flex-wrap items-center justify-between gap-x-4 gap-y-2',
        density !== 'full' && 'max-md:flex-nowrap',
        compact && 'flex-nowrap',
      )}
    >
      <div className={cn('flex min-w-0 flex-wrap items-center gap-2', density !== 'full' && 'max-md:flex-nowrap', compact && 'flex-nowrap')}>
        <Name
          className={cn(
            'qth-type-page-title min-w-0 break-words',
            compact && 'truncate text-base text-[var(--muted-foreground)]',
            density === 'phone-compact' && 'max-md:truncate max-md:text-base',
          )}
          title={project.name}
        >
          {project.name}
        </Name>
        <ProjectSwitcher projectId={project.id} projectName={project.name} tabKey={tabKey} />
        {project.archived_at && (
          <span className="shrink-0" data-testid="project-archived">
            <StatusBadge tone="warning">Archived: read-only</StatusBadge>
          </span>
        )}
        {!compact && (
          <span className={details ? 'contents max-md:hidden' : 'contents'}>
            <RecordPin type="project" id={project.id} title={project.name} url={`/projects/${project.id}`} />
            <StatusBadge tone={STATUS_TONE[project.status]}>{project.status}</StatusBadge>
            <StatusBadge tone={PRIORITY_TONE[project.priority]}>{project.priority}</StatusBadge>
          </span>
        )}
      </div>
      <div className={cn('flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--muted-foreground)]', density !== 'full' && 'max-md:shrink-0', compact && 'shrink-0')}>
        {!compact && (
          <>
            {project.manager_name && (
              <span data-testid="project-owner" className={details}>
                Owner: <span className="text-[var(--foreground)]">{project.manager_name}</span>
              </span>
            )}
            <span data-testid="project-progress" className={cn('flex items-center gap-2', details)}>
              <ProjectProgress project={project} />
            </span>
          </>
        )}
        <span className="flex items-center gap-1">
          <HeaderLink to={projectActivityPath(project.id)} label="Project activity" testId="project-activity-shortcut">
            <History aria-hidden="true" />
          </HeaderLink>
          {canOpenSettings && (
            <HeaderLink to={projectSettingsPath(project.id)} label="Project settings" testId="project-settings-shortcut">
              <Settings aria-hidden="true" />
            </HeaderLink>
          )}
        </span>
      </div>
    </div>
  )
}
