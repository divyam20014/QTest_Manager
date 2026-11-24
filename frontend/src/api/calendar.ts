import { apiFetch } from '@/api/client'

export interface CalendarRun {
  id: string
  name: string
  project_id: string
  project_name: string
  run_type: string
  status: 'in_progress' | 'paused' | 'finished'
  start_date: string
  end_date: string | null
}

export interface CalendarDue {
  due_date: string
  run_id: string
  run_name: string
  project_id: string
  project_name: string
  total_cases: number
  open_cases: number
  overdue: boolean
}

export interface CalendarRelease {
  id: string
  name: string
  project_id: string
  project_name: string
  release_date: string
  status: string | null
}

export interface CalendarData {
  from_date: string
  to_date: string
  runs: CalendarRun[]
  due: CalendarDue[]
  releases: CalendarRelease[]
  truncated: boolean
}

/** ADR-124: runs started / finished, run cases due and releases dated inside [from, to] (at most 62 days). */
export function getCalendar(params: { from: string; to: string; project_id?: string }): Promise<CalendarData> {
  const query = new URLSearchParams({ from: params.from, to: params.to })
  if (params.project_id) query.set('project_id', params.project_id)
  return apiFetch<CalendarData>(`/calendar?${query.toString()}`)
}
