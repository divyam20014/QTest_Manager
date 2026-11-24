import { useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import { hasPermission, isManagerOrAbove } from '@/api/auth'
import { ApiError } from '@/api/client'
import { finishTestRun, listAllTestRuns, pauseTestRun, reopenTestRun, resumeTestRun, type TestRunSummary } from '@/api/execution'
import { BoardView, type BoardCardData, type BoardTarget, type MoveOutcome } from '@/components/list/BoardView'
import { useAuth } from '@/lib/auth'
import { useBoardColumns, type BoardColumnState } from '@/lib/board'
import { RUN_STATUSES, RUN_STATUS_LABEL, runStatusOf, type RunStatus } from './runStatus'

const PAGE_SIZE = 20

const HINT: Record<RunStatus, string> = {
  in_progress: 'Being executed',
  paused: 'Put on hold',
  finished: 'Done; reopen to continue',
}

/** The moves the run actions allow: pause / resume / finish / reopen, the same as on the run page. */
const NEXT: Record<RunStatus, RunStatus[]> = {
  in_progress: ['paused', 'finished'],
  paused: ['in_progress', 'finished'],
  finished: ['in_progress'],
}

const ACTION: Record<string, (runId: string) => Promise<unknown>> = {
  'in_progress>paused': pauseTestRun,
  'paused>in_progress': resumeTestRun,
  'in_progress>finished': finishTestRun,
  'paused>finished': finishTestRun,
  'finished>in_progress': reopenTestRun,
}

/**
 * Test runs by status (ADR-124). A run's status is derived from its timestamps, so a move is one of the
 * run's own actions (pause, resume, finish, reopen), allowed to whoever may use them on the run page.
 * A refusal (for example finishing a run the server will not finish yet) is shown and the card stays.
 */
export function RunsBoard({
  projectId,
  search,
  runType,
  projectNames,
}: {
  projectId?: string
  search?: string
  runType?: string
  projectNames?: Map<string, string>
}) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const canMove = hasPermission(user, 'testrun.finish') && isManagerOrAbove(user)
  const columns = useMemo(() => RUN_STATUSES.map((s) => ({ id: s, label: RUN_STATUS_LABEL[s], hint: HINT[s] })), [])
  const scope = { projectId: projectId ?? '', search: search ?? '', runType: runType ?? '' }
  const data = useBoardColumns<TestRunSummary>({
    rootKey: ['test-runs', 'board'],
    scope,
    columns,
    pageSize: PAGE_SIZE,
    fetchPage: (status, page, pageSize) =>
      listAllTestRuns({ project_id: projectId || undefined, search: search || undefined, run_type: runType || undefined, status: status as RunStatus, page, page_size: pageSize }),
  })
  const runs = new Map<string, TestRunSummary>()
  const cards: Record<string, BoardColumnState<BoardCardData>> = {}
  for (const c of columns) {
    cards[c.id] = {
      ...data[c.id],
      items: data[c.id].items.map((r) => {
        runs.set(r.id, r)
        const status = runStatusOf(r)
        const targets: BoardTarget[] = canMove ? NEXT[status].map((s) => ({ column: s, label: RUN_STATUS_LABEL[s] })) : []
        return {
          id: r.id,
          title: r.name,
          href: `/test-runs/${r.id}`,
          badges: [{ label: r.run_type }, { label: `${r.case_count} case${r.case_count === 1 ? '' : 's'}` }],
          meta: [projectNames?.get(r.project_id), r.finished_at ? `Finished ${new Date(r.finished_at).toLocaleDateString()}` : `Started ${new Date(r.created_at).toLocaleDateString()}`]
            .filter(Boolean)
            .join(' · '),
          targets,
        }
      }),
    }
  }

  async function onMove(card: BoardCardData, to: string): Promise<MoveOutcome> {
    const run = runs.get(card.id)
    if (!run) throw new Error('That run is no longer on the board.')
    const action = ACTION[`${runStatusOf(run)}>${to}`]
    if (!action) throw new Error(`A run cannot go from ${RUN_STATUS_LABEL[runStatusOf(run)]} to ${RUN_STATUS_LABEL[to as RunStatus]}.`)
    try {
      await action(run.id)
    } catch (err) {
      throw new Error(err instanceof ApiError ? err.message : 'Could not change the run. Try again.')
    }
    void queryClient.invalidateQueries({ queryKey: ['test-runs'] })
    void queryClient.invalidateQueries({ queryKey: ['test-runs-overview'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    return 'moved'
  }

  return (
    <BoardView
      label="Test runs board"
      noun="run"
      columns={columns}
      data={cards}
      onMove={canMove ? onMove : undefined}
      explainBlocked={(card, to) => `${card.title} cannot be moved to ${RUN_STATUS_LABEL[to as RunStatus]} from here.`}
      emptyText={(c) => `No ${c.label.toLowerCase()} runs.`}
      note={
        canMove
          ? 'Moving a run pauses, resumes, finishes or reopens it, exactly as on the run page.'
          : 'You can open runs here; pausing, finishing and reopening need the run manager role.'
      }
    />
  )
}
