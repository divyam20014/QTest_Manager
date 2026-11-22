import type { Defect, Severity } from '@/api/defects'
import type { TestRunSummary } from '@/api/execution'

// Pure helpers for the Overview dashboard's KPI row and "Needs attention" list
// (ADR-110). Kept out of the component so the trend maths and ordering are
// unit-tested without rendering.

export type TrendDirection = 'up' | 'down' | 'flat' | 'none'
export type TrendTone = 'good' | 'bad' | 'neutral'

export interface Trend {
  direction: TrendDirection
  /** Shown text, e.g. "12% vs 30d ago", "+3.0 pts vs 30d ago" or "No trend yet". */
  text: string
  tone: TrendTone
}

const NO_TREND: Trend = { direction: 'none', text: 'No trend yet', tone: 'neutral' }

function toneFor(direction: TrendDirection, higherIsBetter: boolean): TrendTone {
  if (direction === 'flat' || direction === 'none') return 'neutral'
  return (direction === 'up') === higherIsBetter ? 'good' : 'bad'
}

/**
 * Relative change of a count against its baseline. A missing baseline (the
 * backend did not send `previous`) or a zero baseline gives no trend: a
 * percentage of zero is meaningless, and a made-up one is worse than none.
 */
export function countTrend(
  current: number,
  previous: number | undefined | null,
  days: number,
  higherIsBetter: boolean,
): Trend {
  if (previous == null || previous <= 0) return NO_TREND
  const pct = Math.round(((current - previous) / previous) * 100)
  if (pct === 0) return { direction: 'flat', text: `0% vs ${days}d ago`, tone: 'neutral' }
  const direction: TrendDirection = pct > 0 ? 'up' : 'down'
  return { direction, text: `${Math.abs(pct)}% vs ${days}d ago`, tone: toneFor(direction, higherIsBetter) }
}

/** Pass rate moves in percentage points (a % of a %) and needs executed steps on both sides. */
export function rateTrend(
  current: number,
  currentSample: number,
  previous: number | undefined | null,
  previousSample: number | undefined | null,
  days: number,
): Trend {
  if (previous == null || !previousSample || currentSample === 0) return NO_TREND
  const pts = Math.round((current - previous) * 1000) / 10
  if (pts === 0) return { direction: 'flat', text: `0 pts vs ${days}d ago`, tone: 'neutral' }
  const direction: TrendDirection = pts > 0 ? 'up' : 'down'
  return { direction, text: `${Math.abs(pts).toFixed(1)} pts vs ${days}d ago`, tone: toneFor(direction, true) }
}

export const TREND_ARROW: Record<TrendDirection, string> = { up: '▲', down: '▼', flat: '▬', none: '' }

/** Accessible name of a whole KPI card: label, value and trend in one sentence. */
export function kpiAriaLabel(label: string, value: string, trend: Trend): string {
  const arrow = trend.direction === 'up' ? 'up ' : trend.direction === 'down' ? 'down ' : ''
  return `${label}: ${value}. ${trend.direction === 'none' ? trend.text : `${arrow}${trend.text}`}`
}

export interface AttentionItem {
  kind: 'defect' | 'run'
  id: string
  title: string
  /** Severity for defects, "Paused" for runs. */
  badge: string
  href: string
}

const SEVERITY_RANK: Partial<Record<Severity, number>> = { Critical: 0, High: 1 }

/**
 * Open (not Closed) Critical/High defects worst-first then newest, followed by
 * paused unfinished runs (stalled work), newest first. Callers pass what the
 * role-scoped endpoints already returned, so this never widens visibility.
 */
export function buildNeedsAttention(defects: Defect[], runs: TestRunSummary[]): AttentionItem[] {
  const defectItems = defects
    .filter((d) => d.status !== 'Closed' && SEVERITY_RANK[d.severity] !== undefined)
    .sort(
      (a, b) =>
        (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99) ||
        b.created_at.localeCompare(a.created_at),
    )
    .map<AttentionItem>((d) => ({ kind: 'defect', id: d.id, title: d.title, badge: d.severity, href: `/defects/${d.id}` }))
  const runItems = runs
    .filter((r) => r.finished_at === null && r.paused_at !== null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map<AttentionItem>((r) => ({ kind: 'run', id: r.id, title: r.name, badge: 'Paused', href: `/test-runs/${r.id}` }))
  return [...defectItems, ...runItems]
}

/** Group a categorical breakdown to at most `max` slices, the tail folded into "Other". */
export function capCategories<T extends { count: number }>(
  rows: T[],
  max: number,
  other: (rest: T[], count: number) => T,
): T[] {
  if (rows.length <= max) return rows
  const sorted = [...rows].sort((a, b) => b.count - a.count)
  const head = sorted.slice(0, max - 1)
  const rest = sorted.slice(max - 1)
  return [...head, other(rest, rest.reduce((s, r) => s + r.count, 0))]
}
