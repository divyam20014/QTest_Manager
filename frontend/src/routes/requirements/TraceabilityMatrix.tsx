import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'

import {
  fetchTraceabilityMatrix,
  traceabilityMatrixExportUrl,
  traceabilityMatrixExportXlsxPath,
  type TraceabilityMatrixEntry,
} from '@/api/reporting'
import { ExportButton } from '@/components/ui/ExportButton'
import { getProject } from '@/api/projects'
import { buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { TaskPicker } from '@/components/TaskPicker'
import { useUrlFilters } from '@/lib/useUrlFilters'
import { REQUIREMENT_STATUS_LABEL, REQUIREMENT_STATUS_TONE } from '@/lib/requirements'
import { ColumnVisibilityMenu } from '@/components/table/ColumnVisibilityMenu'
import { CARD_LINK_CLASS, ResponsiveTable, type ResponsiveColumn } from '@/components/table/ResponsiveTable'
import { useColumnPrefs, type TableColumnDef } from '@/components/table/tablePrefs'

// Phase 3 (redesign plan): a dedicated per-requirement pass/fail/blocked/
// not-executed breakdown, extending the single coverage badge already on
// RequirementsList (which only answers "does this requirement have any
// linked test case at all" -- a different, coarser question). This page
// is read-only over existing data: no new requirement/test-case linking
// behavior is introduced here.
const MATRIX_COLUMNS: TableColumnDef[] = [
  { key: 'requirement', label: 'Requirement', alwaysVisible: true, defaultWidth: 320 },
  { key: 'status', label: 'Status', defaultWidth: 110 },
  { key: 'task', label: 'Task', defaultWidth: 110 },
  { key: 'linked', label: 'Test Cases', defaultWidth: 110 },
  { key: 'passed', label: 'Passed', defaultWidth: 90 },
  { key: 'failed', label: 'Failed', defaultWidth: 90 },
  { key: 'blocked', label: 'Blocked', defaultWidth: 90 },
  { key: 'not_executed', label: 'Not Executed', defaultWidth: 110 },
  { key: 'coverage', label: 'Coverage', defaultWidth: 110 },
]

// Links are relative to this route (/projects/:projectId/traceability-matrix): `..` is the project.
const columns: ResponsiveColumn<TraceabilityMatrixEntry>[] = [
  {
    key: 'requirement',
    header: 'Requirement',
    card: 'title',
    tdClassName: 'font-medium',
    cell: (e) => (
      <>
        <span className="mr-2 font-mono text-xs font-normal text-[var(--muted-foreground)]">{e.display_id}</span>
        <Link to={`../requirements/${e.requirement_id}`} className="underline-offset-2 hover:underline">
          {e.requirement_title}
        </Link>
        {e.linked_test_case_count === 0 && e.status !== 'retired' && (
          <Badge tone="warning" className="ml-2">
            Uncovered
          </Badge>
        )}
        {e.review_count > 0 && (
          <Badge tone="warning" className="ml-2">
            {e.review_count} to review
          </Badge>
        )}
      </>
    ),
    cardCell: (e) => (
      <Link to={`../requirements/${e.requirement_id}`} className={CARD_LINK_CLASS}>
        {e.requirement_title}
      </Link>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    cell: (e) => <Badge tone={REQUIREMENT_STATUS_TONE[e.status]}>{REQUIREMENT_STATUS_LABEL[e.status]}</Badge>,
  },
  {
    key: 'task',
    header: 'Task',
    card: 'meta',
    tdClassName: 'font-mono text-xs',
    cell: (e) => e.task_display_id ?? '—',
  },
  {
    key: 'linked',
    header: 'Test Cases',
    cell: (e) => (
      <Link to={`../requirements/${e.requirement_id}`} className="relative z-10 underline-offset-2 hover:underline max-md:inline-flex max-md:min-h-11 max-md:min-w-11 max-md:items-center">
        {e.linked_test_case_count}
      </Link>
    ),
  },
  {
    key: 'passed',
    header: 'Passed',
    cell: (e) => <Badge tone={e.passed_count > 0 ? 'positive' : 'neutral'}>{e.passed_count}</Badge>,
  },
  {
    key: 'failed',
    header: 'Failed',
    cell: (e) => <Badge tone={e.failed_count > 0 ? 'critical' : 'neutral'}>{e.failed_count}</Badge>,
  },
  {
    key: 'blocked',
    header: 'Blocked',
    cell: (e) => <Badge tone={e.blocked_count > 0 ? 'warning' : 'neutral'}>{e.blocked_count}</Badge>,
  },
  {
    key: 'not_executed',
    header: 'Not Executed',
    cell: (e) => <Badge tone="neutral">{e.not_executed_count}</Badge>,
  },
  {
    key: 'coverage',
    header: 'Coverage',
    card: 'badge',
    cell: (e) => <Badge tone={e.coverage_percentage === 100 ? 'positive' : 'neutral'}>{e.coverage_percentage}%</Badge>,
    cardCell: (e) => (
      <>
        <Badge tone={e.coverage_percentage === 100 ? 'positive' : 'neutral'}>{e.coverage_percentage}% coverage</Badge>
        {e.linked_test_case_count === 0 && e.status !== 'retired' && (
          <Badge tone="warning" className="ml-1.5">
            Uncovered
          </Badge>
        )}
        {e.review_count > 0 && (
          <Badge tone="warning" className="ml-1.5">
            {e.review_count} to review
          </Badge>
        )}
      </>
    ),
  },
]

export function TraceabilityMatrix() {
  const { projectId } = useParams<{ projectId: string }>()
  // ADR-127: narrow the matrix to one task (and, optionally, its sub-tasks); the URL carries it.
  const urlFilters = useUrlFilters({ task: '', sub: '' })
  const taskId = urlFilters.values.task
  const includeSubTasks = urlFilters.values.sub === '1'
  const scope = taskId ? { task_id: taskId, include_sub_tasks: includeSubTasks } : {}
  const columnPrefs = useColumnPrefs('traceability-matrix', MATRIX_COLUMNS)

  const projectQuery = useQuery({
    queryKey: ['projects', projectId],
    queryFn: () => getProject(projectId!),
    enabled: !!projectId,
  })
  const matrixQuery = useQuery({
    queryKey: ['traceability-matrix', projectId, taskId, includeSubTasks],
    queryFn: () => fetchTraceabilityMatrix(projectId!, scope),
    enabled: !!projectId,
  })

  const report = matrixQuery.data

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        back={
          <Link
            to={`/projects/${projectId}/tasks`}
            className="inline-flex text-xs text-[var(--muted-foreground)] underline-offset-2 hover:underline max-md:min-h-11 max-md:items-center max-md:text-sm"
          >
            ← Back to Tasks
          </Link>
        }
        title={`Requirements Traceability Matrix ${projectQuery.data ? `— ${projectQuery.data.name}` : ''}`.trim()}
        actions={
          report && (
            <>
              <a
                href={traceabilityMatrixExportUrl(projectId!, scope)}
                download
                className={buttonVariants({ variant: 'outline' })}
              >
                Download CSV
              </a>
              <ExportButton
                label="Download Excel"
                path={traceabilityMatrixExportXlsxPath(projectId!, scope)}
                fallbackName="traceability_matrix.xlsx"
              />
            </>
          )
        }
      />

      {report && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Overall Requirement Coverage</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            <span>
              {report.total_requirements} requirement{report.total_requirements === 1 ? '' : 's'} total
              {report.retired_requirements > 0 && ` (${report.retired_requirements} retired, not counted)`}
            </span>
            <Badge tone={report.overall_requirement_coverage_percentage === 100 ? 'positive' : 'neutral'}>
              {report.overall_requirement_coverage_percentage}% have at least one linked test case
            </Badge>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-56 flex-col gap-1.5">
            <label htmlFor="matrix-filter-task" className="text-xs font-medium text-[var(--muted-foreground)]">
              Task
            </label>
            <TaskPicker
              id="matrix-filter-task"
              projectId={projectId ?? ''}
              value={taskId}
              placeholder="All requirements"
              aria-label="Show only one task"
              onChange={(id) => urlFilters.setFilters({ task: id, sub: id ? urlFilters.values.sub : '' })}
            />
          </div>
          {taskId && (
            <label className="flex min-h-10 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeSubTasks}
                onChange={(e) => urlFilters.setFilter('sub', e.target.checked ? '1' : '')}
              />
              Include sub-tasks
            </label>
          )}
        </div>
        <div className="max-md:hidden">
        <ColumnVisibilityMenu
          columns={MATRIX_COLUMNS}
          isVisible={columnPrefs.isVisible}
          toggleVisible={columnPrefs.toggleVisible}
          showAll={columnPrefs.showAll}
          density={columnPrefs.density}
          setDensity={columnPrefs.setDensity}
        />
        </div>
      </div>

      {/* Desktop: the wide matrix. Phone: one card per requirement with its
          coverage and pass/fail/blocked/not-executed counts, tap to drill into
          the requirement (and from there its linked test cases). */}
      <ResponsiveTable
        label="Requirements traceability"
        rows={report?.entries ?? []}
        rowKey={(e) => e.requirement_id}
        columns={columns}
        prefs={columnPrefs}
        loading={matrixQuery.isLoading}
        stateCellClassName="px-4"
        state={
          matrixQuery.isError ? (
            <ErrorState error={matrixQuery.error} onRetry={() => matrixQuery.refetch()} />
          ) : !matrixQuery.isLoading && report?.entries.length === 0 ? (
            <EmptyState
              title="No requirements yet"
              description="Add a requirement to start tracking its execution coverage here."
            />
          ) : undefined
        }
      />
    </div>
  )
}
