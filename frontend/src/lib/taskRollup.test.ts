import { describe, expect, it } from 'vitest'

import type { TaskRollup } from '@/api/tasks'

import { caseSource, coveragePercent, percent, resultLabel, resultTone, taskHealth } from './taskRollup'

const EMPTY: TaskRollup = {
  task_id: 't',
  include_sub_tasks: true,
  sub_tasks_total: 0,
  sub_tasks_todo: 0,
  sub_tasks_in_progress: 0,
  sub_tasks_done: 0,
  sub_tasks_overdue: 0,
  progress_percent: 0,
  requirements_total: 0,
  requirements_covered: 0,
  test_cases_total: 0,
  test_cases_passed: 0,
  test_cases_failed: 0,
  test_cases_blocked: 0,
  test_cases_not_run: 0,
  pass_rate: null,
  test_runs_total: 0,
  defects_total: 0,
  defects_open: 0,
  defects_critical_open: 0,
}
const r = (over: Partial<TaskRollup>): TaskRollup => ({ ...EMPTY, ...over })

describe('task roll-up helpers', () => {
  it('rounds percentages and never divides by zero', () => {
    expect(percent(1, 3)).toBe(33)
    expect(percent(2, 3)).toBe(67)
    expect(percent(0, 0)).toBe(0)
    expect(coveragePercent(EMPTY)).toBeNull()
    expect(coveragePercent(r({ requirements_total: 4, requirements_covered: 3 }))).toBe(75)
  })

  it('judges health only from the numbers', () => {
    expect(taskHealth(EMPTY)).toBe('idle')
    expect(taskHealth(r({ sub_tasks_total: 2, sub_tasks_done: 2 }))).toBe('good')
    expect(taskHealth(r({ requirements_total: 2, requirements_covered: 2, test_cases_total: 2, test_cases_passed: 2 }))).toBe('good')
    expect(taskHealth(r({ sub_tasks_total: 2, sub_tasks_overdue: 1 }))).toBe('warning')
    expect(taskHealth(r({ defects_total: 1, defects_open: 1 }))).toBe('warning')
    expect(taskHealth(r({ test_cases_total: 1, test_cases_blocked: 1 }))).toBe('warning')
    expect(taskHealth(r({ requirements_total: 2, requirements_covered: 1 }))).toBe('warning')
    expect(taskHealth(r({ test_cases_total: 2, test_cases_failed: 1 }))).toBe('critical')
    expect(taskHealth(r({ defects_total: 1, defects_open: 1, defects_critical_open: 1 }))).toBe('critical')
    // A critical problem outranks a warning.
    expect(taskHealth(r({ sub_tasks_overdue: 3, test_cases_failed: 1 }))).toBe('critical')
  })

  it('labels results and sources', () => {
    expect(resultLabel(null)).toBe('Not run')
    expect(resultLabel('failed')).toBe('Failed')
    expect(resultTone('passed')).toBe('positive')
    expect(resultTone('blocked')).toBe('warning')
    expect(resultTone(null)).toBe('neutral')
    expect(caseSource({ linked_directly: true, via_requirement: true })).toEqual(['Linked', 'Via requirement'])
    expect(caseSource({ linked_directly: false, via_requirement: true })).toEqual(['Via requirement'])
  })
})
