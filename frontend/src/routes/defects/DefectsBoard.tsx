import { useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import { ApiError } from '@/api/client'
import { listDefectsPage, updateDefectStatus, type Defect, type DefectFieldCatalog, type DefectListFilters } from '@/api/defects'
import { BoardView, type BoardCardData, type MoveOutcome } from '@/components/list/BoardView'
import { useBoardColumns, type BoardColumnState } from '@/lib/board'
import { DEFECT_STATUSES, planTransition, transitionMenu } from '@/lib/defectWorkflow'
import { levelTone } from '@/lib/statusTones'
import { useDefectPermissions } from '@/lib/useDefectPermissions'
import { severityTone } from './statusDisplay'
import type { ActionDefect } from './DefectActionDialogs'

const PAGE_SIZE = 20
/** The workflow's own statuses; Open and Verified (legacy) get a column only when a defect is in them. */
const CORE_STATUSES: string[] = DEFECT_STATUSES.filter((s) => s !== 'Open' && s !== 'Verified')

const asAction = (d: Defect): ActionDefect => ({
  id: d.id,
  status: d.status,
  title: d.title,
  display_id: d.display_id,
  resolution: d.resolution,
  assigned_to: d.assigned_to,
  reported_by: d.reported_by,
  project_id: d.project_id,
})

/**
 * Defects by status (ADR-124). Each column is the list endpoint filtered to one status, so its count is
 * the server's. A move goes through the same rules as the Change status menu: the workflow table
 * decides which columns accept a card, a move that needs a resolution, a verification tick or a retest
 * run opens the same dialog instead of guessing, and every other move calls the status endpoint, whose
 * refusal (409 / 422 / 403) is shown and leaves the card where it was.
 */
export function DefectsBoard({
  scope,
  statuses,
  counts,
  catalog,
  onNeedStatusDialog,
  onNeedRetest,
}: {
  /** The list's filters except `status`. */
  scope: DefectListFilters
  /** Statuses chosen in the list's filter / tab; empty = every column. */
  statuses: string[]
  /** Per-status totals of the whole scope (decides whether a legacy column is shown). */
  counts: Record<string, number>
  catalog: DefectFieldCatalog | undefined
  onNeedStatusDialog: (defect: ActionDefect, target: string) => void
  onNeedRetest: (defect: ActionDefect) => void
}) {
  const perms = useDefectPermissions()
  const queryClient = useQueryClient()
  const columns = useMemo(
    () =>
      DEFECT_STATUSES.filter((s) => (statuses.length ? statuses.includes(s) : CORE_STATUSES.includes(s) || (counts[s] ?? 0) > 0)).map((s) => ({
        id: s,
        label: s,
      })),
    [statuses, counts],
  )
  const data = useBoardColumns<Defect>({
    rootKey: ['defects', 'board'],
    scope,
    columns,
    pageSize: PAGE_SIZE,
    fetchPage: (status, page, pageSize) => listDefectsPage({ ...scope, status: [status], sort: '-created_at', page, page_size: pageSize }),
  })

  const visible = new Set(columns.map((c) => c.id))
  const defects = new Map<string, Defect>()
  const cards: Record<string, BoardColumnState<BoardCardData>> = {}
  for (const column of columns) {
    const state = data[column.id]
    cards[column.id] = {
      ...state,
      items: state.items.map((d) => {
        defects.set(d.id, d)
        return toCard(d, perms, catalog, visible)
      }),
    }
  }

  async function onMove(card: BoardCardData, to: string): Promise<MoveOutcome> {
    const defect = defects.get(card.id)
    if (!defect) throw new Error('That defect is no longer on the board.')
    const plan = planTransition(defect.status, to as Defect['status'])
    if (to === 'Retest') {
      // The retest flow: it creates the Retest run (and moves a Fixed defect to Retest).
      onNeedRetest(asAction(defect))
      return 'deferred'
    }
    if (plan.needsResolution || plan.needsVerification || (plan.resolutionOptions.length > 0 && plan.defaultResolution === null)) {
      onNeedStatusDialog(asAction(defect), to)
      return 'deferred'
    }
    try {
      await updateDefectStatus(defect.id, { status: to as Defect['status'] })
    } catch (err) {
      throw new Error(err instanceof ApiError ? err.message : 'Could not change the status. Try again.')
    }
    void queryClient.invalidateQueries({ queryKey: ['defects'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    void queryClient.invalidateQueries({ queryKey: ['test-cases'] })
    return 'moved'
  }

  return (
    <BoardView
      label="Defects board"
      noun="defect"
      columns={columns}
      data={cards}
      onMove={perms.canChangeStatus || perms.canClose ? onMove : undefined}
      explainBlocked={(card, to) => {
        const defect = defects.get(card.id)
        if (!defect) return 'That defect is no longer on the board.'
        const next = transitionMenu(defect.status, perms, catalog)
          .filter((o) => !o.disabledReason)
          .map((o) => o.status)
        return `${card.displayId ?? card.title} cannot go from ${defect.status} to ${to}. From ${defect.status} it can move to: ${next.join(', ') || 'nowhere you may use'}.`
      }}
      emptyText={(c) => `No ${c.label} defects.`}
    />
  )
}

function toCard(
  d: Defect,
  perms: ReturnType<typeof useDefectPermissions>,
  catalog: DefectFieldCatalog | undefined,
  visible: Set<string>,
): BoardCardData {
  // Only columns on the board are targets: a card must not vanish into a column that is not shown.
  const options = transitionMenu(d.status, perms, catalog).filter((o) => visible.has(o.status))
  return {
    id: d.id,
    displayId: d.display_id,
    title: d.title,
    href: `/defects/${d.id}`,
    levels: [
      { label: `${d.severity} severity`, tone: severityTone(d.severity) },
      { label: `${d.priority} priority`, tone: levelTone(d.priority) },
    ],
    assignee: d.assigned_to_name,
    meta: `${d.project_name} · ${d.sla_breached ? 'SLA breached' : `${d.age_days}d old`}`,
    targets: options.map((o) => ({ column: o.status, label: o.status, disabledReason: o.disabledReason ? 'needs close permission' : undefined })),
  }
}
