import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import type { TestCase } from '@/api/testCases'
import { LevelBadge } from '@/components/ui/LevelBadge'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { QuarantinedBadge } from '@/components/ui/QuarantinedBadge'
import { levelTone } from '@/lib/statusTones'
import { CARD_LINK_CLASS, type ResponsiveColumn } from '@/components/table/ResponsiveTable'
import { ExecutionStatusBadge } from './ExecutionStatusBadge'
import { STATUS_DISPLAY } from './statusDisplay'

import { formatWhen } from '@/lib/formatWhen'

function clamp(text: string | null | undefined): ReactNode {
  if (!text || !text.trim()) return <span className="text-[var(--muted-foreground)]">—</span>
  return <span className="line-clamp-2 max-w-[22rem] whitespace-pre-wrap break-words text-xs">{text}</span>
}

const dash = <span className="text-[var(--muted-foreground)]">—</span>

export interface CellContext {
  usersById: Map<string, string>
  /** Sortable header builder (null when the column cannot be sorted). */
  header: (key: string, label: string) => ReactNode
  sortable: (key: string) => boolean
}

/** One list column per field key of the 22-field standard (plus the optional extras). */
export function buildTestCaseColumn(key: string, label: string, ctx: CellContext): ResponsiveColumn<TestCase> {
  const sortKey = key === 'review_status' ? 'status' : key
  const base = {
    key,
    header: label,
    headerCell: ctx.sortable(sortKey) ? ctx.header(sortKey, label) : undefined,
  }
  switch (key) {
    case 'display_id':
      return {
        ...base,
        card: 'meta',
        cell: (tc) => (
          <Link to={`/test-cases/${tc.id}`} className="font-mono text-xs underline-offset-2 hover:underline">
            {tc.display_id ?? tc.id.slice(0, 8)}
          </Link>
        ),
      }
    case 'title':
      return {
        ...base,
        card: 'title',
        tdClassName: 'min-w-[11rem] max-w-[22rem]',
        cell: (tc) => (
          <span className="inline-flex flex-wrap items-center gap-1">
            <Link to={`/test-cases/${tc.id}`} className="font-medium underline-offset-2 hover:underline">
              {tc.title}
            </Link>
            {tc.quarantined && <QuarantinedBadge title={tc.quarantine_reason} />}
          </span>
        ),
        cardCell: (tc) => (
          <Link to={`/test-cases/${tc.id}`} className={CARD_LINK_CLASS}>
            {tc.title}
          </Link>
        ),
      }
    case 'module':
      return { ...base, card: 'meta', cell: (tc) => tc.module_path ?? tc.module_name ?? dash }
    case 'priority':
      return { ...base, card: 'badge', cell: (tc) => <LevelBadge tone={levelTone(tc.priority)}>{tc.priority}</LevelBadge> }
    case 'severity':
      return {
        ...base,
        card: 'meta',
        cell: (tc) => (tc.severity ? <LevelBadge tone={levelTone(tc.severity)}>{tc.severity}</LevelBadge> : dash),
      }
    case 'test_type':
      return { ...base, card: 'meta', cell: (tc) => tc.test_type ?? dash }
    case 'automation_status':
      return { ...base, card: 'meta', cell: (tc) => tc.automation_status ?? dash }
    case 'execution_status':
      return { ...base, card: 'badge', cell: (tc) => <ExecutionStatusBadge status={tc.execution_status} /> }
    case 'executed_by':
      return { ...base, card: 'meta', cell: (tc) => tc.last_executed_by ?? dash }
    case 'last_executed_at':
      return { ...base, card: 'meta', cell: (tc) => formatWhen(tc.last_executed_at) }
    case 'review_status':
      return {
        ...base,
        header: 'Review Status',
        card: 'badge',
        cell: (tc) => (
          <StatusBadge tone={STATUS_DISPLAY[tc.status].tone}>{tc.review_status_label ?? tc.status_label}</StatusBadge>
        ),
      }
    case 'assignee':
      return {
        ...base,
        card: 'meta',
        cell: (tc) => (tc.assignee_id ? (ctx.usersById.get(tc.assignee_id) ?? 'Unknown') : dash),
      }
    case 'requirement_ref':
      return { ...base, card: 'meta', cell: (tc) => tc.requirement_ref ?? dash }
    case 'environment':
      return { ...base, card: 'meta', cell: (tc) => tc.environment ?? dash }
    case 'description':
      return { ...base, card: 'meta', cardFull: true, cell: (tc) => clamp(tc.description) }
    case 'preconditions':
      return { ...base, card: 'meta', cardFull: true, cell: (tc) => clamp(tc.preconditions ?? tc.prerequisite) }
    case 'test_data':
      return { ...base, card: 'meta', cardFull: true, cell: (tc) => clamp(tc.test_data) }
    case 'steps':
      return { ...base, card: 'meta', cell: (tc) => `${tc.steps.length} step${tc.steps.length === 1 ? '' : 's'}` }
    case 'expected_result':
      return { ...base, card: 'meta', cardFull: true, cell: (tc) => clamp(tc.expected_result) }
    case 'postconditions':
      return { ...base, card: 'meta', cardFull: true, cell: (tc) => clamp(tc.postconditions) }
    case 'actual_result':
      return { ...base, card: 'meta', cardFull: true, cell: (tc) => clamp(tc.last_actual_result) }
    case 'linked_defects':
      return {
        ...base,
        card: 'meta',
        cell: (tc) =>
          tc.linked_defects.length === 0 ? (
            dash
          ) : (
            <span className="inline-flex max-w-[16rem] flex-wrap gap-x-1 text-xs">
              {tc.linked_defects.map((d, i) => (
                <span key={d.id}>
                  <Link to={`/defects/${d.id}`} className="underline underline-offset-2">
                    {d.display_id ?? d.title}
                  </Link>
                  {i < tc.linked_defects.length - 1 ? ',' : ''}
                </span>
              ))}
              {tc.linked_defect_count > tc.linked_defects.length && <span>+{tc.linked_defect_count - tc.linked_defects.length}</span>}
            </span>
          ),
      }
    case 'created_by':
      return { ...base, card: 'meta', cell: (tc) => tc.created_by_name ?? ctx.usersById.get(tc.created_by) ?? dash }
    case 'attachments':
      return {
        ...base,
        card: 'meta',
        cell: (tc) => (
          <span className="text-xs">
            {tc.attachment_count} file{tc.attachment_count === 1 ? '' : 's'} · {tc.comment_count} comment
            {tc.comment_count === 1 ? '' : 's'}
          </span>
        ),
      }
    default:
      return { ...base, card: 'none', cell: () => dash }
  }
}
