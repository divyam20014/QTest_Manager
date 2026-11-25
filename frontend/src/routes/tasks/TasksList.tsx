import { ChevronDown, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'

import { hasPermission } from '@/api/auth'
import { getProject, listProjectMembers } from '@/api/projects'
import { getProjectTaskTree, listTasks, listTaskStatuses, type Task } from '@/api/tasks'
import { TaskStatusBadge } from '@/components/TaskStatusBadge'
import { useColumnPrefs, type TableColumnDef } from '@/components/table/tablePrefs'
import { ColumnVisibilityMenu } from '@/components/table/ColumnVisibilityMenu'
import { ResponsiveTable, type ResponsiveColumn } from '@/components/table/ResponsiveTable'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/PageHeader'
import { SegmentedToggle } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { useAuth } from '@/lib/auth'
import { orderTree, subTaskProgress, visibleRows } from '@/lib/taskTree'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { useUrlFilters } from '@/lib/useUrlFilters'
import { NewRequirementDialog } from '@/routes/requirements/NewRequirementDialog'
import { TaskDialog } from '@/routes/tasks/TaskDialog'
import { TasksBoard } from '@/routes/tasks/TasksBoard'

const PAGE_SIZE = 25

const TASK_COLUMNS: TableColumnDef[] = [
  { key: 'id', label: 'ID' },
  { key: 'title', label: 'Title', alwaysVisible: true },
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Priority' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'due', label: 'Due' },
  { key: 'progress', label: 'Sub-tasks' },
  { key: 'links', label: 'Linked items' },
]

const FILTER_DEFAULTS = { q: '', status: '', assignee: '', view: 'tree', page: '1', task: '', action: '' }

/** The project's Tasks tab (ADR-127): the hierarchy of tasks and sub-tasks, or a filtered flat list. */
export function TasksList() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const { user } = useAuth()
  const canManage = hasPermission(user, 'task.manage')
  const canTransition = hasPermission(user, 'task.transition')
  const canCreateRequirement = hasPermission(user, 'requirement.manage')
  const [newRequirement, setNewRequirement] = useState(false)
  const columnPrefs = useColumnPrefs('tasks-list', TASK_COLUMNS)
  const urlFilters = useUrlFilters(FILTER_DEFAULTS)
  const v = urlFilters.values
  const page = Number(v.page) || 1
  // The top bar's "+ New > Requirement" links here with ?action=new-requirement (ADR-128).
  const { setFilter } = urlFilters
  useEffect(() => {
    if (v.action === 'new-requirement') {
      if (canCreateRequirement) setNewRequirement(true)
      setFilter('action', '')
    }
  }, [v.action, canCreateRequirement, setFilter])
  const [searchText, setSearchText] = useState(v.q)
  const debouncedSearch = useDebouncedValue(searchText.trim(), 300)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  // Dialog state: editing the task named in the URL (so a link can open it), or creating.
  const [creating, setCreating] = useState<{ parentId: string | null } | null>(null)
  const editingId = v.task || null

  const projectQuery = useQuery({
    queryKey: ['projects', projectId],
    queryFn: () => getProject(projectId),
    enabled: !!projectId,
  })
  const statusesQuery = useQuery({ queryKey: ['task-statuses'], queryFn: listTaskStatuses })
  const membersQuery = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => listProjectMembers(projectId),
    enabled: !!projectId && canManage,
  })

  const board = v.view === 'board'
  // The board filters by search and assignee only: its columns are the statuses.
  const filtered = debouncedSearch !== '' || v.assignee !== '' || (!board && v.status !== '')
  const flat = !board && (filtered || v.view === 'flat')

  const treeQuery = useQuery({
    queryKey: ['tasks', 'tree', projectId],
    queryFn: () => getProjectTaskTree(projectId),
    enabled: !!projectId && !flat && !board,
  })
  const listQuery = useQuery({
    queryKey: ['tasks', 'list', projectId, debouncedSearch, v.status, v.assignee, page],
    queryFn: () =>
      listTasks(projectId, {
        page,
        page_size: PAGE_SIZE,
        q: debouncedSearch || undefined,
        status_id: v.status || undefined,
        assignee_id: v.assignee || undefined,
      }),
    enabled: !!projectId && flat && !board,
  })
  const query = flat ? listQuery : treeQuery

  const rows = useMemo(() => {
    if (flat) return listQuery.data?.items ?? []
    return visibleRows(orderTree(treeQuery.data?.items ?? []), collapsed)
  }, [flat, listQuery.data, treeQuery.data, collapsed])
  const total = flat ? (listQuery.data?.total ?? 0) : (treeQuery.data?.total ?? 0)
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  // The hierarchy holds the first tasks only when the project has more than the API sends in one go.
  const treeCapped = !flat && !board && (treeQuery.data?.total ?? 0) > (treeQuery.data?.items.length ?? 0)

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const columns: ResponsiveColumn<Task>[] = [
    {
      key: 'id',
      header: 'ID',
      card: 'meta',
      tdClassName: 'font-mono text-xs whitespace-nowrap',
      cell: (t) => t.display_id ?? '—',
    },
    {
      key: 'title',
      header: 'Title',
      card: 'title',
      tdClassName: 'font-medium',
      cell: (t) => (
        <div className="flex items-center gap-1" style={{ paddingLeft: flat ? 0 : t.depth * 20 }}>
          {!flat &&
            (t.sub_task_count > 0 ? (
              <button
                type="button"
                aria-expanded={!collapsed.has(t.id)}
                aria-label={`${collapsed.has(t.id) ? 'Expand' : 'Collapse'} sub-tasks of ${t.title}`}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-[var(--muted)]"
                onClick={() => toggle(t.id)}
              >
                {collapsed.has(t.id) ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
              </button>
            ) : (
              <span aria-hidden="true" className="inline-block size-6 shrink-0" />
            ))}
          <Link to={`/projects/${projectId}/tasks/${t.id}`} className="underline-offset-2 hover:underline">
            {t.title}
          </Link>
          {t.is_requirements_home && (
            <Badge tone="info" className="ml-1 shrink-0">
              Default for requirements
            </Badge>
          )}
        </div>
      ),
      cardCell: (t) => (
        <Link to={`/projects/${projectId}/tasks/${t.id}`} className="font-medium underline-offset-2 hover:underline">
          {t.depth > 0 ? '↳ ' : ''}
          {t.title}
        </Link>
      ),
    },
    { key: 'status', header: 'Status', card: 'badge', cell: (t) => <TaskStatusBadge status={t.status} /> },
    { key: 'priority', header: 'Priority', cell: (t) => t.priority },
    { key: 'assignee', header: 'Assignee', cell: (t) => t.assignee_name ?? '—' },
    {
      key: 'due',
      header: 'Due',
      cell: (t) =>
        t.due_date ? (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            {t.due_date}
            {t.is_overdue && <Badge tone="critical">Overdue</Badge>}
          </span>
        ) : (
          '—'
        ),
    },
    { key: 'progress', header: 'Sub-tasks', cell: (t) => subTaskProgress(t) ?? '—' },
    {
      key: 'links',
      header: 'Linked items',
      cell: (t) => (
        <span className="whitespace-nowrap text-xs text-[var(--muted-foreground)]">
          {t.requirement_count} req · {t.defect_count} defects · {t.test_case_count} tests
        </span>
      ),
    },
  ]

  const memberOptions = membersQuery.data ?? []

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={`Tasks ${projectQuery.data ? `— ${projectQuery.data.name}` : ''}`.trim()}
        description="Group requirements, test cases and defects under tasks, and break a task into sub-tasks."
        actions={
          <>
            <Link
              to={`/projects/${projectId}/traceability-matrix`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Traceability matrix
            </Link>
            {canCreateRequirement && (
              <Button variant="outline" size="sm" onClick={() => setNewRequirement(true)}>
                New Requirement
              </Button>
            )}
            {canManage && (
              <Button size="sm" onClick={() => setCreating({ parentId: null })}>
                New Task
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <label htmlFor="task-search" className="text-xs font-medium text-[var(--muted-foreground)]">
            Search
          </label>
          <Input
            id="task-search"
            placeholder="Title or ID"
            value={searchText}
            onChange={(e) => {
              setSearchText(e.target.value)
              urlFilters.setFilters({ q: e.target.value.trim(), page: '1' })
            }}
          />
        </div>
        {!board && (
        <div className="flex min-w-40 flex-col gap-1.5">
          <label htmlFor="task-filter-status" className="text-xs font-medium text-[var(--muted-foreground)]">
            Status
          </label>
          <Select id="task-filter-status" value={v.status} onChange={(e) => urlFilters.setFilters({ status: e.target.value, page: '1' })}>
            <option value="">All statuses</option>
            {(statusesQuery.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        )}
        {canManage && (
          <div className="flex min-w-40 flex-col gap-1.5">
            <label htmlFor="task-filter-assignee" className="text-xs font-medium text-[var(--muted-foreground)]">
              Assignee
            </label>
            <Select id="task-filter-assignee" value={v.assignee} onChange={(e) => urlFilters.setFilters({ assignee: e.target.value, page: '1' })}>
              <option value="">Anyone</option>
              {memberOptions.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        <SegmentedToggle
          label="Task view"
          value={v.view === 'flat' ? 'flat' : v.view === 'board' ? 'board' : 'tree'}
          onChange={(value) => urlFilters.setFilters({ view: value, page: '1' })}
          options={[
            { value: 'tree', label: 'Hierarchy' },
            { value: 'flat', label: 'Flat list' },
            { value: 'board', label: 'Board' },
          ]}
        />
        {!board && (
          <ColumnVisibilityMenu
            columns={TASK_COLUMNS}
            isVisible={columnPrefs.isVisible}
            toggleVisible={columnPrefs.toggleVisible}
            showAll={columnPrefs.showAll}
            density={columnPrefs.density}
            setDensity={columnPrefs.setDensity}
          />
        )}
      </div>
      {treeCapped && (
        <p role="note" className="text-xs text-[var(--muted-foreground)]">
          Showing the first {treeQuery.data?.items.length} of {treeQuery.data?.total} tasks. Search or filter to find the rest.
        </p>
      )}
      {filtered && !flat && !board && (
        <p className="text-xs text-[var(--muted-foreground)]">
          Filters show matching tasks as a flat list. Clear them to return to the hierarchy.
        </p>
      )}

      {board ? (
        <TasksBoard
          projectId={projectId}
          statuses={statusesQuery.data ?? []}
          scope={{ q: debouncedSearch || undefined, assignee_id: v.assignee || undefined }}
          canManage={canManage}
          canTransition={canTransition}
          userId={user?.user_id}
        />
      ) : (
      <ResponsiveTable
        label="Tasks"
        prefs={columnPrefs}
        rows={rows}
        rowKey={(t) => t.id}
        columns={columns}
        loading={query.isLoading}
        state={
          query.isError ? (
            <ErrorState error={query.error} onRetry={() => query.refetch()} />
          ) : !query.isLoading && rows.length === 0 ? (
            filtered ? (
              <EmptyState
                variant="filtered"
                title="No tasks match these filters"
                action={
                  <Button variant="outline" size="sm" onClick={() => { setSearchText(''); urlFilters.clearAll() }}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                title="No tasks yet"
                description="Create a task to group the requirements, test cases and defects of a piece of work."
                action={
                  canManage ? (
                    <Button size="sm" onClick={() => setCreating({ parentId: null })}>
                      New Task
                    </Button>
                  ) : undefined
                }
              />
            )
          ) : undefined
        }
      />
      )}

      {flat && totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => urlFilters.setFilter('page', String(page - 1))}>
            Previous
          </Button>
          <span className="text-[var(--muted-foreground)]">
            Page {page} of {totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => urlFilters.setFilter('page', String(page + 1))}>
            Next
          </Button>
        </div>
      )}

      <NewRequirementDialog open={newRequirement} onClose={() => setNewRequirement(false)} projectId={projectId} />
      <TaskDialog
        key={creating ? `new-${creating.parentId ?? 'root'}` : (editingId ?? 'closed')}
        projectId={projectId}
        open={creating !== null || editingId !== null}
        taskId={creating ? null : editingId}
        parentId={creating?.parentId ?? null}
        onClose={() => {
          setCreating(null)
          urlFilters.setFilter('task', '')
        }}
        onAddSubTask={(parentId) => {
          urlFilters.setFilter('task', '')
          setCreating({ parentId })
        }}
        onOpenTask={(id) => {
          setCreating(null)
          urlFilters.setFilter('task', id)
        }}
      />
    </div>
  )
}
