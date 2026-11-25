import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { EXECUTION_STATUSES, listTestCases, type ExecutionStatus, type TestCase, type TestCaseListParams } from '@/api/testCases'
import { BoardView, type BoardCardData } from '@/components/list/BoardView'
import { useBoardColumns, type BoardColumnState } from '@/lib/board'
import { formatWhen } from '@/lib/formatWhen'
import { levelTone } from '@/lib/statusTones'
import { STATUS_DISPLAY } from './statusDisplay'
import { testCasePath } from '@/lib/entityRoutes'

const PAGE_SIZE = 20

const HINT: Record<ExecutionStatus, string> = {
  Pass: 'Latest result passed',
  Fail: 'Latest result failed',
  Blocked: 'Latest result was blocked',
  Skipped: 'Latest result was skipped',
  'Not Run': 'Never executed',
}

/**
 * Test cases by execution status (ADR-124). The status is derived (ADR-116) from each case's latest
 * executed run case, never stored on the case, so these columns take no drops: a result is recorded
 * by running the case. The cards say so, and open the case. A chosen "Execution status" filter
 * narrows the board to that column.
 */
export function TestCasesBoard({
  projectId,
  params,
  usersById,
}: {
  projectId: string
  /** The list's filters (without paging and sort); `execution_status` narrows the columns. */
  params: TestCaseListParams
  usersById: Map<string, string>
}) {
  const columns = useMemo(
    () =>
      EXECUTION_STATUSES.filter((s) => !params.execution_status || (params.execution_status === 'Executed' ? s !== 'Not Run' : params.execution_status === s)).map(
        (s) => ({ id: s, label: s, hint: HINT[s] }),
      ),
    [params.execution_status],
  )
  const scope = { projectId, ...params, execution_status: undefined }
  const data = useBoardColumns<TestCase>({
    rootKey: ['test-cases', 'board', projectId],
    scope,
    columns,
    pageSize: PAGE_SIZE,
    fetchPage: (status, page, pageSize) =>
      listTestCases(projectId, { ...params, execution_status: status, sort: '-created_at', page, page_size: pageSize }),
  })
  const cards: Record<string, BoardColumnState<BoardCardData>> = {}
  for (const c of columns) {
    cards[c.id] = {
      ...data[c.id],
      items: data[c.id].items.map((tc) => ({
        id: tc.id,
        displayId: tc.display_id,
        title: tc.title,
        href: testCasePath(tc.project_id, tc.id),
        levels: [{ label: `${tc.priority} priority`, tone: levelTone(tc.priority) }],
        badges: [{ label: STATUS_DISPLAY[tc.status].label, tone: STATUS_DISPLAY[tc.status].tone }],
        assignee: tc.assignee_id ? (usersById.get(tc.assignee_id) ?? 'Unknown') : null,
        meta: tc.last_executed_at ? `Last run ${formatWhen(tc.last_executed_at)}` : (tc.module_path ?? null),
      })),
    }
  }
  return (
    <BoardView
      label="Test cases board"
      noun="test case"
      columns={columns}
      data={cards}
      emptyText={(c) => `No ${c.label.toLowerCase()} test cases.`}
      note={
        <>
          Columns are each case&apos;s latest execution result, so cards cannot be moved here. Record a result by{' '}
          <Link to={`/projects/${projectId}/test-runs`} className="underline underline-offset-2">
            running the case in a test run
          </Link>
          . Deprecated cases are included; their review status is on the card.
        </>
      }
    />
  )
}
