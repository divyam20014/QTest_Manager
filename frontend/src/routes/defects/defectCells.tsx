import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import type { Defect } from '@/api/defects'
import { CARD_LINK_CLASS, type ResponsiveColumn } from '@/components/table/ResponsiveTable'
import { Badge } from '@/components/ui/badge'
import { LevelBadge } from '@/components/ui/LevelBadge'
import { formatDay } from '@/lib/formatWhen'
import { levelTone } from '@/lib/statusTones'
import { DefectStatusBadge } from './DefectStatusBadge'
import { ROOT_CAUSE_LABEL } from './statusDisplay'
import { defectPath, testCasePath } from '@/lib/entityRoutes'

const dash = <span className="text-[var(--muted-foreground)]">—</span>

function clamp(text: string | null | undefined): ReactNode {
  if (!text || !text.trim()) return dash
  return <span className="line-clamp-2 max-w-[22rem] whitespace-pre-wrap break-words text-xs">{text}</span>
}

export interface DefectCellContext {
  /** Sortable header builder (null when the column cannot be sorted). */
  header: (key: string, label: string) => ReactNode
  sortable: (key: string) => boolean
}

/** One list column per field key of the 22-field defect standard. */
export function buildDefectColumn(key: string, label: string, ctx: DefectCellContext): ResponsiveColumn<Defect> {
  const base = {
    key,
    header: label,
    headerCell: ctx.sortable(key) ? ctx.header(key, label) : undefined,
  }
  switch (key) {
    case 'display_id':
      return {
        ...base,
        card: 'meta',
        cell: (d) => (
          <Link to={defectPath(d.project_id, d.id)} className="whitespace-nowrap font-mono text-xs underline-offset-2 hover:underline">
            {d.display_id ?? d.id.slice(0, 8)}
          </Link>
        ),
      }
    case 'title':
      return {
        ...base,
        card: 'title',
        tdClassName: 'min-w-[5.5rem] max-w-[18rem]',
        cell: (d) => (
          <Link to={defectPath(d.project_id, d.id)} className="line-clamp-2 break-words font-medium underline-offset-2 hover:underline">
            {d.title}
          </Link>
        ),
        cardCell: (d) => (
          <>
            <Link to={defectPath(d.project_id, d.id)} className={CARD_LINK_CLASS}>
              {d.title}
            </Link>
            {d.step_number !== null && <span className="text-xs text-[var(--muted-foreground)]">Found at step {d.step_number}</span>}
          </>
        ),
      }
    case 'project':
      return { ...base, card: 'meta', cell: (d) => d.project_name }
    case 'sla':
      return {
        ...base,
        card: 'meta',
        cardLabel: 'Age',
        cell: (d) => (d.sla_breached ? <Badge tone="critical">SLA breached</Badge> : <span className="text-xs text-[var(--muted-foreground)]">{d.age_days}d</span>),
      }
    case 'module':
      return { ...base, card: 'meta', tdClassName: 'max-w-[5.5rem] truncate', cell: (d) => d.module_name ?? dash }
    case 'severity':
      return { ...base, card: 'badge', cell: (d) => <LevelBadge tone={levelTone(d.severity)}>{d.severity}</LevelBadge> }
    case 'priority':
      return { ...base, card: 'meta', cell: (d) => <LevelBadge tone={levelTone(d.priority)}>{d.priority}</LevelBadge> }
    case 'status':
      return { ...base, card: 'badge', cell: (d) => <DefectStatusBadge status={d.status} label={d.status_label} /> }
    case 'resolution':
      return { ...base, card: 'meta', cell: (d) => d.resolution ?? dash }
    case 'root_cause':
      return { ...base, card: 'meta', cell: (d) => (d.root_cause ? ROOT_CAUSE_LABEL[d.root_cause] : dash) }
    case 'reporter':
      return { ...base, card: 'meta', tdClassName: 'max-w-[5.5rem] truncate', cell: (d) => d.reported_by_name ?? dash }
    case 'assignee':
      return {
        ...base,
        card: 'meta',
        tdClassName: 'max-w-[7rem] truncate',
        cell: (d) => d.assigned_to_name ?? <span className="text-[var(--muted-foreground)]">Unassigned</span>,
      }
    case 'date_reported':
      return { ...base, card: 'meta', tdClassName: 'whitespace-nowrap', cell: (d) => formatDay(d.date_reported ?? d.created_at) }
    case 'fix_version':
      return { ...base, card: 'meta', tdClassName: 'max-w-[5.5rem] truncate', cell: (d) => d.fix_version ?? dash }
    case 'build_found':
      return { ...base, card: 'meta', cell: (d) => d.build_found ?? dash }
    case 'environment':
      return { ...base, card: 'meta', cell: (d) => d.environment ?? dash }
    case 'description':
      return { ...base, card: 'meta', cardFull: true, cell: (d) => clamp(d.description) }
    case 'preconditions':
      return { ...base, card: 'meta', cardFull: true, cell: (d) => clamp(d.preconditions) }
    case 'expected_result':
      return { ...base, card: 'meta', cardFull: true, cell: (d) => clamp(d.expected_result) }
    case 'actual_result':
      return { ...base, card: 'meta', cardFull: true, cell: (d) => clamp(d.actual_result) }
    case 'repro_steps':
      return {
        ...base,
        card: 'meta',
        cell: (d) => {
          const n = d.repro_steps?.length ?? 0
          return n === 0 ? dash : `${n} step${n === 1 ? '' : 's'}`
        },
      }
    case 'attachments':
      return {
        ...base,
        card: 'meta',
        cell: (d) => (d.attachment_count === 0 ? dash : `${d.attachment_count} file${d.attachment_count === 1 ? '' : 's'}`),
      }
    case 'linked_issues':
      return {
        ...base,
        card: 'meta',
        cell: (d) =>
          d.linked_test_cases.length === 0 ? (
            dash
          ) : (
            <span className="inline-flex max-w-[16rem] flex-wrap gap-x-1 text-xs">
              {d.linked_test_cases.map((t, i) => (
                <span key={t.id}>
                  <Link to={testCasePath(d.project_id, t.id)} className="underline underline-offset-2">
                    {t.display_id ?? t.title}
                  </Link>
                  {i < d.linked_test_cases.length - 1 ? ',' : ''}
                </span>
              ))}
            </span>
          ),
      }
    case 'labels':
      return {
        ...base,
        card: 'meta',
        cell: (d) =>
          d.labels.length === 0 ? (
            dash
          ) : (
            <span className="inline-flex max-w-[16rem] flex-wrap gap-1">
              {d.labels.map((l) => (
                <Badge key={l} tone="neutral">
                  {l}
                </Badge>
              ))}
            </span>
          ),
      }
    default:
      return { ...base, card: 'none', cell: () => dash }
  }
}
