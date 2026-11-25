import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { listDefectsPage } from '@/api/defects'
import { listRequirements } from '@/api/requirements'
import {
  getTaskHistory,
  linkTaskTestCase,
  listTaskRuns,
  listTaskTestCases,
  unlinkTaskTestCase,
  type Task,
  type TaskDetail,
} from '@/api/tasks'
import { listTestCases } from '@/api/testCases'
import { ActivityTimelineCard } from '@/components/ActivityTimelineCard'
import { AttachmentsCard } from '@/components/AttachmentsCard'
import { CommentsPanel } from '@/components/CommentsCard'
import { TaskStatusBadge } from '@/components/TaskStatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Combobox } from '@/components/ui/combobox'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { FormError } from '@/components/ui/form-field'
import { useToast } from '@/lib/toast'
import { caseSource, resultLabel, resultTone } from '@/lib/taskRollup'
import { subTaskProgress } from '@/lib/taskTree'
import { DefectStatusBadge } from '@/routes/defects/DefectStatusBadge'
import { defectPath, requirementPath, testCasePath, testRunPath } from '@/lib/entityRoutes'

const LINK = 'underline-offset-2 hover:underline'
const TH = 'px-3 py-2 text-left text-xs font-medium text-[var(--muted-foreground)]'
const TD = 'px-3 py-2 align-top'
const taskUrl = (projectId: string, id: string) => `/projects/${projectId}/tasks/${id}`

function SectionTable({ label, head, children }: { label: string; head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
      <table aria-label={label} className="w-full text-sm">
        <thead className="border-b border-[var(--border)] bg-[var(--muted)]">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className={TH}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">{children}</tbody>
      </table>
    </div>
  )
}

function Loading({ what }: { what: string }) {
  return <p className="text-sm text-[var(--muted-foreground)]">Loading {what}…</p>
}

// --- overview ------------------------------------------------------------------------------

export function OverviewSection({ task }: { task: TaskDetail }) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Description</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm">{task.description || '—'}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            Sub-tasks ({task.sub_tasks_done} of {task.sub_task_count} done)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {task.sub_tasks.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">This task has no sub-tasks.</p>
          ) : (
            <SubTaskTable projectId={task.project_id} tasks={task.sub_tasks} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function SubTaskTable({ projectId, tasks }: { projectId: string; tasks: Task[] }) {
  return (
    <SectionTable label="Sub-tasks" head={['ID', 'Title', 'Status', 'Assignee', 'Due', 'Sub-tasks']}>
      {tasks.map((t) => (
        <tr key={t.id}>
          <td className={`${TD} font-mono text-xs`}>{t.display_id}</td>
          <td className={`${TD} font-medium`}>
            <Link to={taskUrl(projectId, t.id)} className={LINK}>
              {t.title}
            </Link>
          </td>
          <td className={TD}>
            <TaskStatusBadge status={t.status} />
          </td>
          <td className={TD}>{t.assignee_name ?? '—'}</td>
          <td className={TD}>
            {t.due_date ?? '—'} {t.is_overdue && <Badge tone="critical">Overdue</Badge>}
          </td>
          <td className={TD}>{subTaskProgress(t) ?? '—'}</td>
        </tr>
      ))}
    </SectionTable>
  )
}

// --- requirements --------------------------------------------------------------------------

export function RequirementsSection({ task, includeSubTasks }: { task: TaskDetail; includeSubTasks: boolean }) {
  const query = useQuery({
    queryKey: ['requirements', task.project_id, 'task', task.id, includeSubTasks],
    queryFn: () =>
      listRequirements(task.project_id, { task_id: task.id, include_sub_tasks: includeSubTasks, page_size: 100 }),
  })
  if (query.isLoading) return <Loading what="requirements" />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  const items = query.data?.items ?? []
  if (items.length === 0) {
    return (
      <EmptyState
        title="No requirements in this task"
        description="Choose this task when you create or edit a requirement."
        action={
          <Link to={`/projects/${task.project_id}/requirements`} className={LINK}>
            Open Requirements
          </Link>
        }
      />
    )
  }
  return (
    <SectionTable label="Requirements of this task" head={['Title', 'Task', 'Version', 'Linked test cases']}>
      {items.map((r) => (
        <tr key={r.id}>
          <td className={`${TD} font-medium`}>
            <Link to={requirementPath(task.project_id, r.id)} className={LINK}>
              {r.title}
            </Link>
          </td>
          <td className={`${TD} font-mono text-xs`}>{r.task_display_id ?? '—'}</td>
          <td className={TD}>v{r.version_number}</td>
          <td className={TD}>
            <Badge tone={r.linked_test_case_count > 0 ? 'positive' : 'warning'}>{r.linked_test_case_count}</Badge>
          </td>
        </tr>
      ))}
    </SectionTable>
  )
}

// --- test cases ----------------------------------------------------------------------------

export function TestCasesSection({
  task,
  includeSubTasks,
  canManage,
}: {
  task: TaskDetail
  includeSubTasks: boolean
  canManage: boolean
}) {
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const [pick, setPick] = useState('')
  const query = useQuery({
    queryKey: ['tasks', 'test-cases', task.id, includeSubTasks],
    queryFn: () => listTaskTestCases(task.id, includeSubTasks),
  })
  const projectCases = useQuery({
    queryKey: ['test-cases', task.project_id, 'for-task-link'],
    queryFn: () => listTestCases(task.project_id, { page_size: 100 }),
    enabled: canManage,
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['tasks'] })
  }
  const link = useMutation({
    mutationFn: (testCaseId: string) => linkTaskTestCase(task.id, testCaseId),
    onSuccess: () => {
      setPick('')
      refresh()
      showToast('success', 'Test case linked')
    },
  })
  const unlink = useMutation({
    mutationFn: (testCaseId: string) => unlinkTaskTestCase(task.id, testCaseId),
    onSuccess: () => {
      refresh()
      showToast('success', 'Test case unlinked')
    },
    onError: () => showToast('error', 'Could not unlink that test case'),
  })

  const rows = query.data ?? []
  const direct = new Set(rows.filter((r) => r.linked_directly && r.task_id === task.id).map((r) => r.test_case_id))
  const options = (projectCases.data?.items ?? [])
    .filter((c) => !direct.has(c.id))
    .map((c) => ({ value: c.id, label: c.display_id ? `${c.display_id} · ${c.title}` : c.title }))

  return (
    <div className="flex flex-col gap-3">
      {canManage && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-64 flex-1">
            <Combobox
              id="task-link-test-case"
              aria-label="Link a test case"
              value={pick}
              onChange={setPick}
              options={options}
              placeholder="Link a test case to this task…"
              searchable
            />
          </div>
          <Button size="sm" disabled={!pick || link.isPending} onClick={() => link.mutate(pick)}>
            Link
          </Button>
        </div>
      )}
      <FormError>{link.error instanceof ApiError ? link.error.message : null}</FormError>
      {query.isLoading ? (
        <Loading what="test cases" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No test cases yet"
          description="Link test cases to this task, or link them to its requirements — they count here too."
        />
      ) : (
        <SectionTable label="Test cases of this task" head={['ID', 'Title', 'Source', 'Latest result', '']}>
          {rows.map((c) => (
            <tr key={c.test_case_id}>
              <td className={`${TD} font-mono text-xs`}>{c.display_id}</td>
              <td className={`${TD} font-medium`}>
                <Link to={testCasePath(task.project_id, c.test_case_id)} className={LINK}>
                  {c.title}
                </Link>
              </td>
              <td className={TD}>
                <span className="flex flex-wrap gap-1">
                  {caseSource(c).map((s) => (
                    <Badge key={s} tone="neutral">
                      {s}
                    </Badge>
                  ))}
                  {c.task_id !== task.id && c.task_display_id && (
                    <span className="font-mono text-xs text-[var(--muted-foreground)]">{c.task_display_id}</span>
                  )}
                </span>
              </td>
              <td className={TD}>
                <Badge tone={resultTone(c.last_result)}>{resultLabel(c.last_result)}</Badge>
              </td>
              <td className={`${TD} text-right`}>
                {canManage && direct.has(c.test_case_id) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Unlink ${c.title}`}
                    disabled={unlink.isPending}
                    onClick={() => unlink.mutate(c.test_case_id)}
                  >
                    Unlink
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </SectionTable>
      )}
    </div>
  )
}

// --- defects -------------------------------------------------------------------------------

export function DefectsSection({ task, includeSubTasks }: { task: TaskDetail; includeSubTasks: boolean }) {
  const query = useQuery({
    queryKey: ['defects', 'task', task.id, includeSubTasks],
    queryFn: () =>
      listDefectsPage({
        project_id: task.project_id,
        task_id: task.id,
        include_sub_tasks: includeSubTasks,
        sort: '-created_at',
        page: 1,
        page_size: 100,
      }),
  })
  if (query.isLoading) return <Loading what="defects" />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  const items = query.data?.items ?? []
  if (items.length === 0) {
    return (
      <EmptyState
        title="No defects in this task"
        description="Choose this task when you report or edit a defect."
        action={
          <Link to={`/defects?projectId=${task.project_id}&taskId=${task.id}`} className={LINK}>
            Open Defects
          </Link>
        }
      />
    )
  }
  return (
    <SectionTable label="Defects of this task" head={['ID', 'Title', 'Task', 'Severity', 'Status', 'Assignee']}>
      {items.map((d) => (
        <tr key={d.id}>
          <td className={`${TD} font-mono text-xs`}>{d.display_id}</td>
          <td className={`${TD} font-medium`}>
            <Link to={defectPath(task.project_id, d.id)} className={LINK}>
              {d.title}
            </Link>
          </td>
          <td className={`${TD} font-mono text-xs`}>{d.task_display_id ?? '—'}</td>
          <td className={TD}>{d.severity}</td>
          <td className={TD}>
            <DefectStatusBadge status={d.status} label={d.status_label} />
          </td>
          <td className={TD}>{d.assigned_to_name ?? '—'}</td>
        </tr>
      ))}
    </SectionTable>
  )
}

// --- runs ----------------------------------------------------------------------------------

export function RunsSection({ task, includeSubTasks }: { task: TaskDetail; includeSubTasks: boolean }) {
  const query = useQuery({
    queryKey: ['tasks', 'runs', task.id, includeSubTasks],
    queryFn: () => listTaskRuns(task.id, includeSubTasks),
  })
  if (query.isLoading) return <Loading what="test runs" />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  const rows = query.data ?? []
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No test runs yet"
        description="A run appears here once it contains one of this task’s test cases."
      />
    )
  }
  return (
    <SectionTable label="Test runs of this task" head={['Run', 'Type', 'Started', 'State', 'This task’s cases']}>
      {rows.map((r) => (
        <tr key={r.run_id}>
          <td className={`${TD} font-medium`}>
            <Link to={testRunPath(task.project_id, r.run_id)} className={LINK}>
              {r.name}
            </Link>
          </td>
          <td className={TD}>{r.run_type}</td>
          <td className={TD}>{new Date(r.created_at).toLocaleDateString()}</td>
          <td className={TD}>
            <Badge tone={r.finished_at ? 'neutral' : 'info'}>{r.finished_at ? 'Finished' : 'Open'}</Badge>
          </td>
          <td className={TD}>
            {r.cases_passed} passed · {r.cases_failed} failed · {r.cases_blocked} blocked · {r.cases_total} in run
          </td>
        </tr>
      ))}
    </SectionTable>
  )
}

// --- discussion and activity ---------------------------------------------------------------

export function DiscussionSection({ task }: { task: TaskDetail }) {
  return (
    <div className="flex flex-col gap-4">
      <CommentsPanel ownerType="task" ownerId={task.id} />
      <AttachmentsCard ownerType="task" ownerId={task.id} />
    </div>
  )
}

const ACTION_LABELS: Record<string, string> = {
  'task.created': 'Created',
  'task.updated': 'Updated',
  'task.moved': 'Moved to another parent',
  'task.status_changed': 'Status changed',
  'task.deleted': 'Deleted',
  'task.test_case_linked': 'Test case linked',
  'task.test_case_unlinked': 'Test case unlinked',
  'comment.created': 'Comment added',
  'task.attachment_added': 'Attachment added',
  'task.attachment_removed': 'Attachment removed',
}

export function ActivitySection({ task }: { task: TaskDetail }) {
  const query = useQuery({ queryKey: ['tasks', 'history', task.id], queryFn: () => getTaskHistory(task.id) })
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  return <ActivityTimelineCard entries={query.data} actionLabels={ACTION_LABELS} />
}
