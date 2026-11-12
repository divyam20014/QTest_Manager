import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'

import { fetchTraceabilityMatrix, traceabilityMatrixExportUrl } from '@/api/reporting'
import { getProject } from '@/api/projects'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { TableSkeleton } from '@/components/ui/skeleton'
import { ColumnVisibilityMenu } from '@/components/table/ColumnVisibilityMenu'
import { ResizableTh } from '@/components/table/ResizableTh'
import { useColumnPrefs, type TableColumnDef } from '@/components/table/tablePrefs'

// Phase 3 (redesign plan): a dedicated per-requirement pass/fail/blocked/
// not-executed breakdown, extending the single coverage badge already on
// RequirementsList (which only answers "does this requirement have any
// linked test case at all" -- a different, coarser question). This page
// is read-only over existing data: no new requirement/test-case linking
// behavior is introduced here.
const MATRIX_COLUMNS: TableColumnDef[] = [
  { key: 'requirement', label: 'Requirement', alwaysVisible: true, defaultWidth: 320 },
  { key: 'linked', label: 'Test Cases', defaultWidth: 110 },
  { key: 'passed', label: 'Passed', defaultWidth: 90 },
  { key: 'failed', label: 'Failed', defaultWidth: 90 },
  { key: 'blocked', label: 'Blocked', defaultWidth: 90 },
  { key: 'not_executed', label: 'Not Executed', defaultWidth: 110 },
  { key: 'coverage', label: 'Coverage', defaultWidth: 110 },
]

export function TraceabilityMatrix() {
  const { projectId } = useParams<{ projectId: string }>()
  const columnPrefs = useColumnPrefs('traceability-matrix', MATRIX_COLUMNS)

  const projectQuery = useQuery({
    queryKey: ['projects', projectId],
    queryFn: () => getProject(projectId!),
    enabled: !!projectId,
  })
  const matrixQuery = useQuery({
    queryKey: ['traceability-matrix', projectId],
    queryFn: () => fetchTraceabilityMatrix(projectId!),
    enabled: !!projectId,
  })

  const report = matrixQuery.data

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">
            Requirements Traceability Matrix {projectQuery.data ? `— ${projectQuery.data.name}` : ''}
          </h1>
          <Link
            to={`/projects/${projectId}/requirements`}
            className="text-sm text-[var(--muted-foreground)] underline-offset-2 hover:underline"
          >
            ← Back to Requirements
          </Link>
        </div>
        {report && (
          <a
            href={traceabilityMatrixExportUrl(projectId!)}
            download
            className="rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--muted)]"
          >
            Download CSV
          </a>
        )}
      </div>

      {report && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Overall Requirement Coverage</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-3 text-sm">
            <span>
              {report.total_requirements} requirement{report.total_requirements === 1 ? '' : 's'} total
            </span>
            <Badge tone={report.overall_requirement_coverage_percentage === 100 ? 'positive' : 'neutral'}>
              {report.overall_requirement_coverage_percentage}% have at least one linked test case
            </Badge>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-end">
        <ColumnVisibilityMenu
          columns={MATRIX_COLUMNS}
          isVisible={columnPrefs.isVisible}
          toggleVisible={columnPrefs.toggleVisible}
          showAll={columnPrefs.showAll}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--muted)] text-left text-xs text-[var(--muted-foreground)]">
            <tr>
              <ResizableTh width={columnPrefs.width('requirement')} onResize={(w) => columnPrefs.setWidth('requirement', w)}>
                Requirement
              </ResizableTh>
              {columnPrefs.isVisible('linked') && (
                <ResizableTh width={columnPrefs.width('linked')} onResize={(w) => columnPrefs.setWidth('linked', w)}>
                  Test Cases
                </ResizableTh>
              )}
              {columnPrefs.isVisible('passed') && (
                <ResizableTh width={columnPrefs.width('passed')} onResize={(w) => columnPrefs.setWidth('passed', w)}>
                  Passed
                </ResizableTh>
              )}
              {columnPrefs.isVisible('failed') && (
                <ResizableTh width={columnPrefs.width('failed')} onResize={(w) => columnPrefs.setWidth('failed', w)}>
                  Failed
                </ResizableTh>
              )}
              {columnPrefs.isVisible('blocked') && (
                <ResizableTh width={columnPrefs.width('blocked')} onResize={(w) => columnPrefs.setWidth('blocked', w)}>
                  Blocked
                </ResizableTh>
              )}
              {columnPrefs.isVisible('not_executed') && (
                <ResizableTh
                  width={columnPrefs.width('not_executed')}
                  onResize={(w) => columnPrefs.setWidth('not_executed', w)}
                >
                  Not Executed
                </ResizableTh>
              )}
              {columnPrefs.isVisible('coverage') && (
                <ResizableTh width={columnPrefs.width('coverage')} onResize={(w) => columnPrefs.setWidth('coverage', w)}>
                  Coverage
                </ResizableTh>
              )}
            </tr>
          </thead>
          <tbody>
            {matrixQuery.isLoading && <TableSkeleton columns={MATRIX_COLUMNS.length} />}
            {matrixQuery.isError && (
              <tr>
                <td colSpan={MATRIX_COLUMNS.length} className="px-4">
                  <ErrorState onRetry={() => matrixQuery.refetch()} />
                </td>
              </tr>
            )}
            {report?.entries.map((e) => (
              <tr
                key={e.requirement_id}
                className="border-t border-[var(--border)] hover:bg-[var(--muted)]"
              >
                <td className="px-4 py-2 font-medium">
                  <Link
                    to={`/requirements/${e.requirement_id}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {e.requirement_title}
                  </Link>
                  {e.linked_test_case_count === 0 && (
                    <Badge tone="warning" className="ml-2">
                      Uncovered
                    </Badge>
                  )}
                </td>
                {columnPrefs.isVisible('linked') && (
                  <td className="px-4 py-2">
                    <Link
                      to={`/requirements/${e.requirement_id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {e.linked_test_case_count}
                    </Link>
                  </td>
                )}
                {columnPrefs.isVisible('passed') && (
                  <td className="px-4 py-2">
                    <Badge tone={e.passed_count > 0 ? 'positive' : 'neutral'}>{e.passed_count}</Badge>
                  </td>
                )}
                {columnPrefs.isVisible('failed') && (
                  <td className="px-4 py-2">
                    <Badge tone={e.failed_count > 0 ? 'critical' : 'neutral'}>{e.failed_count}</Badge>
                  </td>
                )}
                {columnPrefs.isVisible('blocked') && (
                  <td className="px-4 py-2">
                    <Badge tone={e.blocked_count > 0 ? 'warning' : 'neutral'}>{e.blocked_count}</Badge>
                  </td>
                )}
                {columnPrefs.isVisible('not_executed') && (
                  <td className="px-4 py-2">
                    <Badge tone="neutral">{e.not_executed_count}</Badge>
                  </td>
                )}
                {columnPrefs.isVisible('coverage') && (
                  <td className="px-4 py-2">
                    <Badge tone={e.coverage_percentage === 100 ? 'positive' : 'neutral'}>
                      {e.coverage_percentage}%
                    </Badge>
                  </td>
                )}
              </tr>
            ))}
            {!matrixQuery.isLoading && !matrixQuery.isError && report?.entries.length === 0 && (
              <tr>
                <td colSpan={MATRIX_COLUMNS.length} className="px-4">
                  <EmptyState
                    title="No requirements yet"
                    description="Add a requirement to start tracking its execution coverage here."
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
