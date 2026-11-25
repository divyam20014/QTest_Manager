import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Navigate, useLocation, useParams } from 'react-router-dom'

import { getDefect } from '@/api/defects'
import { getTestRun } from '@/api/execution'
import { getRequirement } from '@/api/requirements'
import { getTestCase } from '@/api/testCases'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { DetailSkeleton } from '@/components/ui/skeleton'
import { entityPath, type EntityKind } from '@/lib/entityRoutes'

type RecordKind = Exclude<EntityKind, 'task'>

const PARAM: Record<RecordKind, string> = {
  requirement: 'requirementId',
  'test-case': 'testCaseId',
  'test-run': 'runId',
  defect: 'defectId',
}

/**
 * Reads a record with the SAME query key its detail page uses, so the request is shared and the
 * detail page opens from cache after a redirect or a guard check.
 */
function useRecordProject(kind: RecordKind, id: string) {
  const query = useQuery({
    queryKey:
      kind === 'requirement'
        ? ['requirements', 'detail', id]
        : kind === 'test-case'
          ? ['test-cases', 'detail', id]
          : kind === 'test-run'
            ? ['test-runs', 'detail', id]
            : ['defects', 'detail', id],
    queryFn: (): Promise<{ project_id: string }> =>
      kind === 'requirement'
        ? getRequirement(id)
        : kind === 'test-case'
          ? getTestCase(id)
          : kind === 'test-run'
            ? getTestRun(id)
            : getDefect(id),
    enabled: !!id,
  })
  return { query, projectId: query.data?.project_id }
}

/**
 * An old top-level record URL (`/defects/:id`, `/test-cases/:id/edit`, ...): looks the record up, then
 * replaces the URL with the one inside its project, keeping the query string and hash. A record that
 * cannot be read shows the same states the detail page would (no access, not found).
 */
export function LegacyEntityRedirect({ kind, suffix = '' }: { kind: RecordKind; suffix?: string }) {
  const params = useParams()
  const location = useLocation()
  const id = params[PARAM[kind]] ?? ''
  const { query, projectId } = useRecordProject(kind, id)

  if (query.isError) {
    return <ErrorState message="Could not open this record." error={query.error} onRetry={() => query.refetch()} />
  }
  if (projectId) {
    return <Navigate to={entityPath(kind, projectId, id, suffix) + location.search + location.hash} replace />
  }
  if (query.isLoading) return <DetailSkeleton />
  return <EmptyState title="Not found" description="It may have been deleted, or you may not have access to it." />
}

/**
 * Around a detail page under `/projects/:projectId/...`: when the record belongs to another project
 * than the URL says (a hand-edited or stale link), go to the right one instead of showing a record
 * under the wrong project's header. Renders the page straight away; the check uses the page's own query.
 */
export function EntityProjectGuard({ kind, children }: { kind: RecordKind; children: ReactNode }) {
  const params = useParams()
  const location = useLocation()
  const id = params[PARAM[kind]] ?? ''
  const urlProject = params.projectId ?? ''
  const { projectId } = useRecordProject(kind, id)
  if (projectId && urlProject && projectId !== urlProject) {
    const suffix = location.pathname.endsWith('/edit') ? '/edit' : ''
    return <Navigate to={entityPath(kind, projectId, id, suffix) + location.search + location.hash} replace />
  }
  return <>{children}</>
}

/**
 * `/defects/new?projectId=...`: the creation page now lives inside the project. Without a project in
 * the URL the page stays where it was, and asks which project.
 */
export function LegacyDefectNew({ children }: { children: ReactNode }) {
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const projectId = params.get('projectId')
  if (projectId && /^[0-9a-f-]{8,}$/i.test(projectId)) {
    params.delete('projectId')
    const rest = params.toString()
    return <Navigate to={`/projects/${projectId}/defects/new${rest ? `?${rest}` : ''}${location.hash}`} replace />
  }
  return <>{children}</>
}
