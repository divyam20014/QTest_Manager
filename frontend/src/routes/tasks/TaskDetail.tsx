import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'

import { hasPermission } from '@/api/auth'
import { getTask, getTaskRollup, type TaskRollup } from '@/api/tasks'
import { TaskStatusBadge } from '@/components/TaskStatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/PageHeader'
import { DetailSkeleton } from '@/components/ui/skeleton'
import { Tabs } from '@/components/ui/tabs'
import { useAuth } from '@/lib/auth'
import { coveragePercent, HEALTH_LABEL, HEALTH_TONE, taskHealth } from '@/lib/taskRollup'
import { taskLabel } from '@/lib/taskTree'
import { TaskDialog } from '@/routes/tasks/TaskDialog'
import {
  ActivitySection,
  DefectsSection,
  DiscussionSection,
  OverviewSection,
  RequirementsSection,
  RunsSection,
  TestCasesSection,
} from '@/routes/tasks/TaskSections'

/**
 * The task workspace (ADR-127): one task with the numbers that say how it is going and a tab for each
 * thing that belongs to it. The numbers cover the task and, unless switched off, its sub-tasks.
 */
export function TaskDetail() {
  const { projectId = '', taskId = '' } = useParams<{ projectId: string; taskId: string }>()
  const { user } = useAuth()
  const canManage = hasPermission(user, 'task.manage')
  const [includeSubTasks, setIncludeSubTasks] = useState(true)
  const [editing, setEditing] = useState(false)
  const [addingSubTask, setAddingSubTask] = useState(false)

  const taskQuery = useQuery({
    queryKey: ['tasks', 'detail', taskId],
    queryFn: () => getTask(taskId),
    enabled: !!taskId,
  })
  const rollupQuery = useQuery({
    queryKey: ['tasks', 'rollup', taskId, includeSubTasks],
    queryFn: () => getTaskRollup(taskId, includeSubTasks),
    enabled: !!taskId,
  })

  if (taskQuery.isLoading) return <DetailSkeleton />
  if (taskQuery.isError) {
    return <ErrorState message="Could not load this task." error={taskQuery.error} onRetry={() => taskQuery.refetch()} />
  }
  const task = taskQuery.data
  if (!task || task.project_id !== projectId) {
    return (
      <EmptyState
        title="Task not found"
        description="It may have been deleted, or you may not have access to it."
        action={
          <Link to={`/projects/${projectId}/tasks`} className="underline-offset-2 hover:underline">
            Back to Tasks
          </Link>
        }
      />
    )
  }
  const rollup = rollupQuery.data
  const health = rollup ? taskHealth(rollup) : null
  const parent = task.ancestors.at(-1)
  const scope = includeSubTasks && task.sub_task_count > 0 ? 'including sub-tasks' : 'this task only'

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        back={
          <Link
            to={parent ? `/projects/${projectId}/tasks/${parent.id}` : `/projects/${projectId}/tasks`}
            className="inline-flex text-sm text-[var(--muted-foreground)] underline-offset-2 hover:underline max-md:min-h-11 max-md:items-center"
          >
            ← {parent ? taskLabel(parent) : 'Tasks'}
          </Link>
        }
        title={task.title}
        meta={
          <>
            <span className="font-mono text-xs text-[var(--muted-foreground)]">{task.display_id}</span>
            <TaskStatusBadge status={task.status} />
            {task.is_overdue && <Badge tone="critical">Overdue</Badge>}
            {task.is_requirements_home && <Badge tone="info">Default for requirements</Badge>}
            {health && <Badge tone={HEALTH_TONE[health]}>{HEALTH_LABEL[health]}</Badge>}
          </>
        }
        actions={
          canManage && (
            <>
              {task.depth < 4 && !task.is_requirements_home && (
                <Button variant="outline" size="sm" onClick={() => setAddingSubTask(true)}>
                  Add sub-task
                </Button>
              )}
              <Button size="sm" onClick={() => setEditing(true)}>
                Edit
              </Button>
            </>
          )
        }
      />

      {task.ancestors.length > 0 && (
        <nav aria-label="Task path" className="text-xs text-[var(--muted-foreground)]">
          {task.ancestors.map((a) => (
            <span key={a.id}>
              <Link to={`/projects/${projectId}/tasks/${a.id}`} className="underline-offset-2 hover:underline">
                {taskLabel(a)}
              </Link>
              {' › '}
            </span>
          ))}
          <span aria-current="page">{taskLabel(task)}</span>
        </nav>
      )}

      <section aria-label="How this task is going" className="flex flex-col gap-2">
        {task.sub_task_count > 0 && (
          <label className="flex w-fit items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeSubTasks}
              onChange={(e) => setIncludeSubTasks(e.target.checked)}
            />
            Include sub-tasks in these numbers
          </label>
        )}
        {rollupQuery.isError ? (
          <ErrorState error={rollupQuery.error} onRetry={() => rollupQuery.refetch()} />
        ) : (
          <RollupCards rollup={rollup} scope={scope} />
        )}
      </section>

      <Tabs
        items={[
          { key: 'overview', label: 'Overview', content: <OverviewSection task={task} /> },
          {
            key: 'requirements',
            label: 'Requirements',
            count: rollup?.requirements_total,
            content: <RequirementsSection task={task} includeSubTasks={includeSubTasks} />,
          },
          {
            key: 'test-cases',
            label: 'Test Cases',
            count: rollup?.test_cases_total,
            content: <TestCasesSection task={task} includeSubTasks={includeSubTasks} canManage={canManage} />,
          },
          {
            key: 'defects',
            label: 'Defects',
            count: rollup?.defects_total,
            content: <DefectsSection task={task} includeSubTasks={includeSubTasks} />,
          },
          {
            key: 'runs',
            label: 'Test Runs',
            count: rollup?.test_runs_total,
            content: <RunsSection task={task} includeSubTasks={includeSubTasks} />,
          },
          { key: 'discussion', label: 'Discussion', content: <DiscussionSection task={task} /> },
          { key: 'activity', label: 'Activity', content: <ActivitySection task={task} /> },
        ]}
      />

      <TaskDialog
        key={`edit-${taskId}`}
        projectId={projectId}
        taskId={taskId}
        open={editing}
        onClose={() => setEditing(false)}
        onAddSubTask={() => {
          setEditing(false)
          setAddingSubTask(true)
        }}
        onOpenTask={() => setEditing(false)}
      />
      <TaskDialog
        key={`sub-${taskId}`}
        projectId={projectId}
        parentId={taskId}
        open={addingSubTask}
        onClose={() => setAddingSubTask(false)}
      />
    </div>
  )
}

function Stat({
  label,
  value,
  detail,
  bar,
}: {
  label: string
  value: ReactNode
  detail?: ReactNode
  /** 0-100 fill of a progress bar under the figure. */
  bar?: number | null
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-[var(--border)] px-4 py-3">
      <p className="text-xs font-medium text-[var(--muted-foreground)]">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {bar != null && (
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={bar}
          className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--muted)]"
        >
          <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${bar}%` }} />
        </div>
      )}
      {detail && <p className="text-xs text-[var(--muted-foreground)]">{detail}</p>}
    </div>
  )
}

function RollupCards({ rollup, scope }: { rollup: TaskRollup | undefined; scope: string }) {
  if (!rollup) {
    return <p className="text-sm text-[var(--muted-foreground)]">Loading numbers…</p>
  }
  const coverage = coveragePercent(rollup)
  return (
    <div role="list" aria-label={`Task numbers, ${scope}`} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <div role="listitem">
        <Stat
          label="Progress"
          value={`${rollup.progress_percent}%`}
          bar={rollup.progress_percent}
          detail={
            rollup.sub_tasks_total > 0
              ? `${rollup.sub_tasks_done} of ${rollup.sub_tasks_total} sub-tasks done${rollup.sub_tasks_overdue > 0 ? ` · ${rollup.sub_tasks_overdue} overdue` : ''}`
              : 'No sub-tasks'
          }
        />
      </div>
      <div role="listitem">
        <Stat
          label="Requirement coverage"
          value={coverage === null ? '—' : `${coverage}%`}
          bar={coverage}
          detail={
            rollup.requirements_total > 0
              ? `${rollup.requirements_covered} of ${rollup.requirements_total} have a test case`
              : 'No requirements'
          }
        />
      </div>
      <div role="listitem">
        <Stat
          label="Pass rate"
          value={rollup.pass_rate === null ? '—' : `${rollup.pass_rate}%`}
          bar={rollup.pass_rate}
          detail={
            rollup.test_cases_total > 0
              ? `${rollup.test_cases_passed} passed · ${rollup.test_cases_failed} failed · ${rollup.test_cases_blocked} blocked · ${rollup.test_cases_not_run} not run`
              : 'No test cases'
          }
        />
      </div>
      <div role="listitem">
        <Stat
          label="Open defects"
          value={rollup.defects_open}
          detail={`${rollup.defects_total} in total${rollup.defects_critical_open > 0 ? ` · ${rollup.defects_critical_open} critical` : ''}`}
        />
      </div>
      <div role="listitem">
        <Stat label="Test runs" value={rollup.test_runs_total} detail="Runs containing its test cases" />
      </div>
    </div>
  )
}
