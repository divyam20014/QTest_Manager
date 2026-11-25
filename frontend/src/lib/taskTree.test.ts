import { describe, expect, it } from 'vitest'

import type { Task } from '@/api/tasks'

import {
  MAX_TASK_DEPTH,
  categoryTone,
  descendantIds,
  orderTree,
  subTaskProgress,
  subtreeHeight,
  taskLabel,
  validParents,
  visibleRows,
} from './taskTree'

function task(id: string, parent: string | null, depth: number, over: Partial<Task> = {}): Task {
  return {
    id,
    project_id: 'p',
    parent_task_id: parent,
    depth,
    display_id: `TASK_${id.padStart(6, '0')}`,
    title: `Task ${id}`,
    description: null,
    status: { id: 's', code: 'todo', label: 'To Do', category: 'todo', color: null },
    priority: 'Medium',
    assignee_id: null,
    assignee_name: null,
    release_id: null,
    start_date: null,
    due_date: null,
    completed_at: null,
    is_overdue: false,
    created_by: 'u',
    created_at: `2026-01-0${id}T00:00:00Z`,
    updated_at: `2026-01-0${id}T00:00:00Z`,
    sub_task_count: 0,
    sub_tasks_done: 0,
    requirement_count: 0,
    defect_count: 0,
    test_case_count: 0,
    ...over,
  }
}

// 1 ── 2 ── 4
//  └─ 3
// 5
const TASKS = [task('1', null, 0), task('5', null, 0), task('3', '1', 1), task('2', '1', 1), task('4', '2', 2)]

describe('task tree helpers', () => {
  it('orders depth first with every task right after its parent', () => {
    expect(orderTree(TASKS).map((t) => t.id)).toEqual(['1', '2', '4', '3', '5'])
  })

  it('treats a task whose parent is not in the set as a root of the view', () => {
    expect(orderTree([task('4', '2', 2), task('3', '1', 1)]).map((t) => t.id)).toEqual(['3', '4'])
  })

  it('hides the descendants of collapsed tasks only', () => {
    const ordered = orderTree(TASKS)
    expect(visibleRows(ordered, new Set()).map((t) => t.id)).toEqual(['1', '2', '4', '3', '5'])
    expect(visibleRows(ordered, new Set(['2'])).map((t) => t.id)).toEqual(['1', '2', '3', '5'])
    expect(visibleRows(ordered, new Set(['1'])).map((t) => t.id)).toEqual(['1', '5'])
    // A collapsed task nested inside a collapsed one changes nothing.
    expect(visibleRows(ordered, new Set(['1', '2'])).map((t) => t.id)).toEqual(['1', '5'])
  })

  it('finds descendants and subtree height', () => {
    expect([...descendantIds(TASKS, '1')].sort()).toEqual(['2', '3', '4'])
    expect([...descendantIds(TASKS, '5')]).toEqual([])
    expect(subtreeHeight(TASKS, '1')).toBe(2)
    expect(subtreeHeight(TASKS, '3')).toBe(0)
  })

  it('offers only parents that keep the hierarchy valid', () => {
    const ids = (moving: string | null) => validParents(TASKS, moving).map((t) => t.id).sort()
    expect(ids(null)).toEqual(['1', '2', '3', '4', '5'])
    // Not itself, not under itself.
    expect(ids('1')).toEqual(['5'])
    expect(ids('2')).toEqual(['1', '3', '5'])
  })

  it('refuses parents that would push the subtree past the depth limit', () => {
    const deep = [task('1', null, 0)]
    for (let level = 1; level <= MAX_TASK_DEPTH; level++) deep.push(task(String(level + 1), String(level), level))
    const extra = task('9', null, 0)
    const all = [...deep, extra, task('8', '9', 1)]
    // '9' has one level of sub-task, so it fits under depth 2 (2+1+1 = 4) but not under depth 3.
    const parents = validParents(all, '9').map((t) => t.id)
    expect(parents).toContain('3')
    expect(parents).not.toContain('4')
    expect(parents).not.toContain('5')
    // Nothing at the limit can take a new child.
    expect(validParents(all, null).map((t) => t.id)).not.toContain('5')
  })

  it('formats labels, tones and progress', () => {
    expect(taskLabel({ display_id: 'TASK_000001', title: 'Login' })).toBe('TASK_000001 · Login')
    expect(taskLabel({ display_id: null, title: 'Login' })).toBe('Login')
    expect(categoryTone('done')).toBe('positive')
    expect(categoryTone('in_progress')).toBe('info')
    expect(categoryTone('todo')).toBe('neutral')
    expect(subTaskProgress({ sub_task_count: 0, sub_tasks_done: 0 })).toBeNull()
    expect(subTaskProgress({ sub_task_count: 5, sub_tasks_done: 2 })).toBe('2 of 5')
  })
})
