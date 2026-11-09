import type { AggregateRow } from '@/api/reporting'

export interface PivotedAggregate {
  data: Array<Record<string, string | number>>
  valueOrder: string[]
}

// Pivots the metric×group_by rows the backend returns (one row per
// group/value/count) into recharts' wide shape: one object per group,
// one key per distinct value. Both orderings are "first seen," not
// sorted, so re-running with the same filters always draws stable bars
// and a stable legend/color assignment.
export function pivotAggregateRows(rows: AggregateRow[]): PivotedAggregate {
  const groupOrder: string[] = []
  const valueOrder: string[] = []
  const byGroup = new Map<string, Record<string, string | number>>()

  for (const row of rows) {
    if (!byGroup.has(row.group_label)) {
      byGroup.set(row.group_label, { group_label: row.group_label })
      groupOrder.push(row.group_label)
    }
    if (!valueOrder.includes(row.value)) valueOrder.push(row.value)
    byGroup.get(row.group_label)![row.value] = row.count
  }

  return { data: groupOrder.map((g) => byGroup.get(g)!), valueOrder }
}
