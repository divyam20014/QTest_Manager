import {
  Ban,
  BadgeCheck,
  CircleCheck,
  CircleDot,
  CirclePause,
  CirclePlus,
  Loader,
  RefreshCw,
  RotateCcw,
  UserCheck,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

import type { DefectStatus, RootCause, Severity } from '@/api/defects'
import type { BadgeTone } from '@/components/ui/badge'
import { DEFECT_STATUSES } from '@/lib/defectWorkflow'
import { levelTone } from '@/lib/statusTones'

/** Every status code, in the workflow's display order. */
export const STATUS_ORDER: DefectStatus[] = DEFECT_STATUSES

// ADR-119: tone and icon of each of the eleven statuses. A status is always shown as icon + label
// (never colour alone), so two statuses may share a tone and still be told apart.
export const STATUS_DISPLAY: Record<DefectStatus, { tone: BadgeTone; Icon: LucideIcon }> = {
  New: { tone: 'info', Icon: CirclePlus },
  Open: { tone: 'warning', Icon: CircleDot },
  Assigned: { tone: 'info', Icon: UserCheck },
  'In Progress': { tone: 'warning', Icon: Loader },
  Fixed: { tone: 'positive', Icon: Wrench },
  Retest: { tone: 'warning', Icon: RefreshCw },
  Reopened: { tone: 'critical', Icon: RotateCcw },
  Verified: { tone: 'positive', Icon: BadgeCheck },
  Closed: { tone: 'neutral', Icon: CircleCheck },
  Rejected: { tone: 'neutral', Icon: Ban },
  Deferred: { tone: 'neutral', Icon: CirclePause },
}

export const STATUS_TONE: Record<DefectStatus, BadgeTone> = Object.fromEntries(
  DEFECT_STATUSES.map((s) => [s, STATUS_DISPLAY[s].tone]),
) as Record<DefectStatus, BadgeTone>

/** Tone / icon for any status string; an unknown code (a future status) is neutral. */
export function statusDisplay(status: string): { tone: BadgeTone; Icon: LucideIcon } {
  return STATUS_DISPLAY[status as DefectStatus] ?? { tone: 'neutral', Icon: CircleDot }
}

// Severity shares the app-wide level scale (src/lib/statusTones.ts).
export function severityTone(severity: Severity): BadgeTone {
  return levelTone(severity)
}

export const ROOT_CAUSES: RootCause[] = [
  'requirements_gap',
  'code_defect',
  'design_flaw',
  'test_data_issue',
  'environment_issue',
  'third_party_integration',
  'other',
]

export const ROOT_CAUSE_LABEL: Record<RootCause, string> = {
  requirements_gap: 'Requirements Gap',
  code_defect: 'Code Defect',
  design_flaw: 'Design Flaw',
  test_data_issue: 'Test Data Issue',
  environment_issue: 'Environment Issue',
  third_party_integration: 'Third-Party Integration',
  other: 'Other',
}
