import { apiFetch } from '@/api/client'

export type ReportCadence = 'daily' | 'weekly' | 'monthly'

export interface ReportSchedule {
  id: string
  report_type: string
  cadence: ReportCadence
  recipient_emails: string[]
  enabled: boolean
  last_run_at: string | null
  created_at: string
}

export function listReportSchedules(): Promise<ReportSchedule[]> {
  return apiFetch<ReportSchedule[]>('/report-schedules')
}

export function createReportSchedule(req: {
  cadence: ReportCadence
  recipient_emails: string[]
  enabled?: boolean
}): Promise<ReportSchedule> {
  return apiFetch<ReportSchedule>('/report-schedules', { method: 'POST', body: JSON.stringify(req) })
}

export function updateReportSchedule(
  id: string,
  req: Partial<{ cadence: ReportCadence; recipient_emails: string[]; enabled: boolean }>,
): Promise<ReportSchedule> {
  return apiFetch<ReportSchedule>(`/report-schedules/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(req),
  })
}

export function deleteReportSchedule(id: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/report-schedules/${id}`, { method: 'DELETE' })
}
