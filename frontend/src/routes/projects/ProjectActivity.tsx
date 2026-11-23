import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'

import { fetchActivityStream } from '@/api/reporting'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'

import { ProjectDrilldown } from './ProjectDrilldown'

// Entity types the audit stream names that have a detail page to link to.
const ENTITY_PATH: Record<string, string> = {
  test_case: '/test-cases',
  defect: '/defects',
  test_run: '/test-runs',
  requirement: '/requirements',
}

/**
 * ADR-122: the Activity tab. The project's change stream (the same endpoint the Recent activity
 * widget reads, scoped by project) above the existing recent test cases / defects lists.
 */
export function ProjectActivity() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const activityQuery = useQuery({
    queryKey: ['activity', projectId],
    queryFn: () => fetchActivityStream(projectId),
  })
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Activity" description="What changed in this project recently." />
      <Card>
        <CardHeader>
          <CardTitle>Recent changes</CardTitle>
        </CardHeader>
        <CardContent>
          {activityQuery.isLoading ? (
            <div role="status" className="flex flex-col gap-2">
              <span className="sr-only">Loading activity</span>
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : activityQuery.isError ? (
            <ErrorState
              message="Could not load the project activity."
              error={activityQuery.error}
              onRetry={() => activityQuery.refetch()}
            />
          ) : (activityQuery.data ?? []).length === 0 ? (
            <EmptyState title="No activity yet" description="Changes to this project's records will show up here." />
          ) : (
            <ul aria-label="Project activity" className="flex flex-col divide-y divide-[var(--border)] text-sm">
              {(activityQuery.data ?? []).map((entry, index) => {
                const base = ENTITY_PATH[entry.entity_type]
                const what = entry.entity_type.replace(/_/g, ' ')
                return (
                  <li key={`${entry.entity_id}-${index}`} className="flex flex-col gap-0.5 py-2">
                    <span className="break-words">
                      {entry.user_name ?? 'Someone'} {entry.action.replace(/[._]/g, ' ')}{' '}
                      {base ? (
                        <Link className="font-medium underline" to={`${base}/${entry.entity_id}`}>
                          {what}
                        </Link>
                      ) : (
                        <span>({what})</span>
                      )}
                    </span>
                    <time className="text-xs text-[var(--muted-foreground)]" dateTime={entry.created_at}>
                      {new Date(entry.created_at).toLocaleString()}
                    </time>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
      <ProjectDrilldown projectId={projectId} />
    </div>
  )
}
