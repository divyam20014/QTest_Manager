import type { TestRunSummary } from '@/api/execution'

export type RunStatus = 'in_progress' | 'paused' | 'finished'

export const RUN_STATUSES: RunStatus[] = ['in_progress', 'paused', 'finished']

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  in_progress: 'In progress',
  paused: 'Paused',
  finished: 'Finished',
}

export const RUN_STATUS_TONE: Record<RunStatus, 'positive' | 'warning' | 'neutral'> = {
  in_progress: 'positive',
  paused: 'warning',
  finished: 'neutral',
}

export function runStatusOf(run: Pick<TestRunSummary, 'finished_at' | 'paused_at'>): RunStatus {
  return run.finished_at ? 'finished' : run.paused_at ? 'paused' : 'in_progress'
}
