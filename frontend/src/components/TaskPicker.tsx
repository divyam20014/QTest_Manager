import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { getProjectTaskTree } from '@/api/tasks'
import { Combobox } from '@/components/ui/combobox'
import { orderTree, taskLabel, validParents } from '@/lib/taskTree'

/**
 * Pick one of a project's tasks (ADR-127), shown as an indented tree so sub-tasks read under their
 * parents. Empty value = no task. For choosing a parent, pass `movingId` so the task itself, its
 * sub-tasks and parents that would nest it too deep are left out (the API checks the same rules).
 */
export function TaskPicker({
  id,
  projectId,
  value,
  onChange,
  movingId,
  forParent,
  clearable = true,
  disabled,
  placeholder = 'No task',
  'aria-label': ariaLabel,
  error,
}: {
  id?: string
  projectId: string
  value: string
  onChange: (taskId: string) => void
  /** The task being moved, when picking its new parent. */
  movingId?: string | null
  /** Picking a parent: hides tasks that cannot take another level. */
  forParent?: boolean
  /** Allow clearing the choice (default). A requirement always has a task, so its picker is not clearable. */
  clearable?: boolean
  disabled?: boolean
  placeholder?: string
  'aria-label'?: string
  error?: boolean
}) {
  const treeQuery = useQuery({
    queryKey: ['tasks', 'tree', projectId],
    queryFn: () => getProjectTaskTree(projectId),
    enabled: !!projectId,
  })

  const capped = (treeQuery.data?.total ?? 0) > (treeQuery.data?.items.length ?? 0)
  const options = useMemo(() => {
    const all = treeQuery.data?.items ?? []
    const allowed = forParent ? new Set(validParents(all, movingId ?? null).map((t) => t.id)) : null
    return orderTree(all)
      .filter((t) => allowed === null || allowed.has(t.id) || t.id === value)
      .map((t) => ({
        value: t.id,
        label: `${t.depth > 0 ? `${' '.repeat(t.depth - 1)}↳ ` : ''}${taskLabel(t)}`,
      }))
  }, [treeQuery.data, forParent, movingId, value])

  return (
    <Combobox
      id={id}
      value={value}
      onChange={onChange}
      options={options}
      placeholder={
        !projectId
          ? 'Choose a project first'
          : treeQuery.isLoading
            ? 'Loading tasks…'
            : capped
              ? `${placeholder} (first ${treeQuery.data?.items.length} tasks listed)`
              : placeholder
      }
      disabled={disabled || !projectId}
      clearable={clearable}
      error={error}
      aria-label={ariaLabel}
    />
  )
}
