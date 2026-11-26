import { useQuery } from '@tanstack/react-query'
import { type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { type DefectStatus, listDefectsPage } from '@/api/defects'
import {
  listMyReviews,
  listMyRunCases,
  listMyTasks,
  type MyReview,
  type MyRunCase,
  type MyTask,
} from '@/api/myWork'
import { TaskStatusBadge } from '@/components/TaskStatusBadge'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { LevelBadge } from '@/components/ui/LevelBadge'
import { PageHeader } from '@/components/ui/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Tabs } from '@/components/ui/tabs'
import { useAuth } from '@/lib/auth'
import { DEFECT_STATUSES } from '@/lib/defectWorkflow'
import { dueRelative } from '@/lib/dueDate'
import { formatWhen } from '@/lib/formatWhen'
import { MY_DEFECT_REASON_LABEL, type MyDefect, groupRunCases, groupTasks, mergeMyDefects } from '@/lib/myWork'
import { levelTone, RUN_CASE_STATUS_TONE } from '@/lib/statusTones'
import { humanizeKey } from '@/lib/labels'
import { DefectStatusBadge } from '@/routes/defects/DefectStatusBadge'
import { severityTone } from '@/routes/defects/statusDisplay'
import { defectPath, taskPath } from '@/lib/entityRoutes'

// "Open" for the person: everything not Closed or Rejected (ADR-118's definition, the same
// one the Defects badge uses).
const OPEN_STATUSES = DEFECT_STATUSES.filter((s: DefectStatus) => s !== 'Closed' && s !== 'Rejected')
const PAGE_SIZE = 50

function ListSkeleton({ label }: { label: string }) {
  return (
    <div role="status" className="flex flex-col gap-2">
      <span className="sr-only">{label}</span>
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  )
}

const ROW =
  'flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] max-md:min-h-11'

function RunCaseRow({ item }: { item: MyRunCase }) {
  return (
    <li>
      <Link to={`/test-run-cases/${item.id}?runId=${item.run_id}`} className={ROW}>
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">
            {item.test_case_display_id && (
              <span className="mr-2 font-mono text-xs text-[var(--muted-foreground)]">{item.test_case_display_id}</span>
            )}
            {item.title}
          </span>
          <span className="truncate text-xs text-[var(--muted-foreground)]">
            {item.project_name} · {item.run_name}
            {item.run_paused && ' · run paused'}
            {item.status === 'blocked' && item.blocked_reason && ` · ${item.blocked_reason}`}
            {item.due_date && !item.overdue && ` · ${dueRelative(item.due_date)}`}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {item.overdue && item.due_date && (
            <StatusBadge tone="critical" title={`Due ${item.due_date}`}>
              {dueRelative(item.due_date)}
            </StatusBadge>
          )}
          <StatusBadge tone={RUN_CASE_STATUS_TONE[item.status]}>{humanizeKey(item.status)}</StatusBadge>
        </span>
      </Link>
    </li>
  )
}

function RunCasesPanel({ query }: { query: ReturnType<typeof useRunCasesQuery> }) {
  if (query.isPending) return <ListSkeleton label="Loading your run cases" />
  if (query.isError)
    return <ErrorState message="Your run cases could not be loaded." error={query.error} onRetry={() => query.refetch()} />
  const groups = groupRunCases(query.data.items)
  if (groups.length === 0) {
    return (
      <EmptyState
        title="No run cases waiting on you"
        description="When a test run case is assigned to you it appears here until you finish it."
      />
    )
  }
  return (
    <div className="flex flex-col gap-5">
      {groups.map((g) => (
        <section key={g.status} aria-labelledby={`mw-run-${g.status}`} className="flex flex-col gap-2">
          <h2 id={`mw-run-${g.status}`} className="text-sm font-semibold">
            {g.label} <span className="font-normal text-[var(--muted-foreground)]">({g.items.length})</span>
          </h2>
          <ul className="flex flex-col gap-2">
            {g.items.map((item) => (
              <RunCaseRow key={item.id} item={item} />
            ))}
          </ul>
        </section>
      ))}
      {query.data.total > query.data.items.length && (
        <p className="text-xs text-[var(--muted-foreground)]">
          Showing the first {query.data.items.length} of {query.data.total}.
        </p>
      )}
    </div>
  )
}

function TaskRow({ item }: { item: MyTask }) {
  return (
    <li>
      <Link to={taskPath(item.project_id, item.id)} className={ROW}>
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">
            {item.display_id && (
              <span className="mr-2 font-mono text-xs text-[var(--muted-foreground)]">{item.display_id}</span>
            )}
            {item.title}
          </span>
          <span className="truncate text-xs text-[var(--muted-foreground)]">
            {item.project_name}
            {item.due_date && !item.overdue && ` · ${dueRelative(item.due_date)}`}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          {item.overdue && item.due_date && (
            <StatusBadge tone="critical" title={`Due ${item.due_date}`}>
              {dueRelative(item.due_date)}
            </StatusBadge>
          )}
          <LevelBadge tone={levelTone(item.priority)}>{item.priority}</LevelBadge>
          <TaskStatusBadge status={item.status} />
        </span>
      </Link>
    </li>
  )
}

function TasksPanel({ query }: { query: ReturnType<typeof useTasksQuery> }) {
  if (query.isPending) return <ListSkeleton label="Loading your tasks" />
  if (query.isError)
    return <ErrorState message="Your tasks could not be loaded." error={query.error} onRetry={() => query.refetch()} />
  const groups = groupTasks(query.data.items)
  if (groups.length === 0) {
    return (
      <EmptyState
        title="No open tasks assigned to you"
        description="Tasks and sub-tasks assigned to you appear here until they are done."
      />
    )
  }
  return (
    <div className="flex flex-col gap-5">
      {groups.map((g) => (
        <section key={g.key} aria-labelledby={`mw-task-${g.key}`} className="flex flex-col gap-2">
          <h2 id={`mw-task-${g.key}`} className="text-sm font-semibold">
            {g.label} <span className="font-normal text-[var(--muted-foreground)]">({g.items.length})</span>
          </h2>
          <ul className="flex flex-col gap-2">
            {g.items.map((item) => (
              <TaskRow key={item.id} item={item} />
            ))}
          </ul>
        </section>
      ))}
      {query.data.total > query.data.items.length && (
        <p className="text-xs text-[var(--muted-foreground)]">
          Showing the first {query.data.items.length} of {query.data.total}.
        </p>
      )}
    </div>
  )
}

function DefectRow({ item }: { item: MyDefect }) {
  const d = item.defect
  return (
    <li>
      <Link to={defectPath(d.project_id, d.id)} className={ROW}>
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">
            {d.display_id && <span className="mr-2 font-mono text-xs text-[var(--muted-foreground)]">{d.display_id}</span>}
            {d.title}
          </span>
          <span className="truncate text-xs text-[var(--muted-foreground)]">
            {d.project_name} · {MY_DEFECT_REASON_LABEL[item.reason]}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <LevelBadge tone={severityTone(d.severity)}>{d.severity}</LevelBadge>
          <DefectStatusBadge status={d.status} label={d.status_label} />
        </span>
      </Link>
    </li>
  )
}

function DefectsPanel({ query }: { query: ReturnType<typeof useMyDefectsQuery> }) {
  if (query.isPending) return <ListSkeleton label="Loading your defects" />
  if (query.isError)
    return <ErrorState message="Your defects could not be loaded." error={query.error} onRetry={() => query.refetch()} />
  if (query.data.length === 0) {
    return (
      <EmptyState
        title="No open defects of yours"
        description="Open defects assigned to you or reported by you appear here."
      />
    )
  }
  return (
    <ul className="flex flex-col gap-2">
      {query.data.map((item) => (
        <DefectRow key={item.defect.id} item={item} />
      ))}
    </ul>
  )
}

function ReviewRow({ item }: { item: MyReview }) {
  return (
    <li>
      <Link to={`/test-cases/${item.id}`} className={ROW}>
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">
            {item.display_id && <span className="mr-2 font-mono text-xs text-[var(--muted-foreground)]">{item.display_id}</span>}
            {item.title}
          </span>
          <span className="truncate text-xs text-[var(--muted-foreground)]">
            {item.project_name} · submitted {formatWhen(item.created_at)}
          </span>
        </span>
        <LevelBadge tone={levelTone(item.priority)}>{item.priority}</LevelBadge>
      </Link>
    </li>
  )
}

function ReviewsPanel({ query }: { query: ReturnType<typeof useReviewsQuery> }) {
  if (query.isPending) return <ListSkeleton label="Loading your reviews" />
  if (query.isError)
    return <ErrorState message="Your reviews could not be loaded." error={query.error} onRetry={() => query.refetch()} />
  if (query.data.items.length === 0) {
    return (
      <EmptyState
        title="Nothing waiting for your review"
        description="Test cases submitted for review with you as the reviewer appear here."
      />
    )
  }
  return (
    <ul className="flex flex-col gap-2">
      {query.data.items.map((item) => (
        <ReviewRow key={item.id} item={item} />
      ))}
    </ul>
  )
}

function useRunCasesQuery(enabled: boolean) {
  const { user } = useAuth()
  return useQuery({ queryKey: ['my-work', 'run-cases', user?.user_id], queryFn: () => listMyRunCases(), enabled })
}

function useTasksQuery(enabled: boolean) {
  const { user } = useAuth()
  return useQuery({ queryKey: ['my-work', 'tasks', user?.user_id], queryFn: listMyTasks, enabled })
}

function useReviewsQuery(enabled: boolean) {
  const { user } = useAuth()
  return useQuery({ queryKey: ['my-work', 'reviews', user?.user_id], queryFn: listMyReviews, enabled })
}

// Defects reuse the list endpoint's own filters: assigned to me, and reported by me.
function useMyDefectsQuery(enabled: boolean) {
  const { user } = useAuth()
  const me = user?.user_id
  return useQuery({
    queryKey: ['my-work', 'defects', me],
    enabled: enabled && !!me,
    queryFn: async () => {
      const [assigned, reported] = await Promise.all([
        listDefectsPage({ assignee_id: me, status: OPEN_STATUSES, page_size: PAGE_SIZE }),
        listDefectsPage({ reported_by: me, status: OPEN_STATUSES, page_size: PAGE_SIZE }),
      ])
      return mergeMyDefects(assigned.items, reported.items)
    },
  })
}

/**
 * My Work (ADR-121): one read-only page of what is waiting on the signed-in user, built
 * from existing data. Nothing is stored for it. Visibility follows the same rules as the
 * lists it links to (project access, Tester case scope).
 */
export function MyWork() {
  const [params] = useSearchParams()
  const runCases = useRunCasesQuery(true)
  const tasks = useTasksQuery(true)
  const defects = useMyDefectsQuery(true)
  const reviews = useReviewsQuery(true)

  const requested = params.get('tab')
  const defaultKey =
    requested === 'tasks' || requested === 'defects' || requested === 'reviews' ? requested : 'run-cases'

  const countOf = (loaded: boolean, value: number | undefined) => (loaded ? value : undefined)
  const tabs: { key: string; label: string; count?: number; content: ReactNode }[] = [
    {
      key: 'run-cases',
      label: 'Run cases',
      count: countOf(runCases.isSuccess, runCases.data?.total),
      content: <RunCasesPanel query={runCases} />,
    },
    {
      key: 'tasks',
      label: 'Tasks',
      count: countOf(tasks.isSuccess, tasks.data?.total),
      content: <TasksPanel query={tasks} />,
    },
    {
      key: 'defects',
      label: 'Defects',
      count: countOf(defects.isSuccess, defects.data?.length),
      content: <DefectsPanel query={defects} />,
    },
    {
      key: 'reviews',
      label: 'Reviews',
      count: countOf(reviews.isSuccess, reviews.data?.total),
      content: <ReviewsPanel query={reviews} />,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="My Work"
        description="What is waiting on you: your run cases, tasks and open defects, and test cases to review."
      />
      <Card>
        <CardContent className="pt-4">
          <Tabs items={tabs} defaultKey={defaultKey} />
        </CardContent>
      </Card>
    </div>
  )
}
