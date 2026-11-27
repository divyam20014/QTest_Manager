// Defect workflow rules shared by the status menu, the list tabs, the badges and the nav count
// (ADR-118 / ADR-119). The server stays the authority: `GET /defects/columns` returns the real
// transition table and the API refuses an invalid move with a 409, so this file is the
// fallback used before the catalogue loads and the one place the UI derives its rules from.
import type { DefectFieldCatalog, DefectRetest, DefectStatus, Resolution } from '@/api/defects'

/** All eleven codes in display order (Open and Verified are the legacy ones, listed last). */
export const DEFECT_STATUSES: DefectStatus[] = [
  'New',
  'Assigned',
  'In Progress',
  'Fixed',
  'Retest',
  'Reopened',
  'Closed',
  'Rejected',
  'Deferred',
  'Open',
  'Verified',
]

export const RESOLUTIONS: Resolution[] = ['Fixed', 'Duplicate', "Won't Fix", 'Cannot Reproduce', 'By Design', 'Not Applicable']

/** Mirror of `ALLOWED_TRANSITIONS` (core/field_standards.py). */
export const FALLBACK_TRANSITIONS: Record<string, DefectStatus[]> = {
  New: ['Assigned', 'In Progress', 'Rejected', 'Deferred', 'Open'],
  Open: ['Assigned', 'In Progress', 'Fixed', 'Rejected', 'Deferred'],
  Assigned: ['In Progress', 'Rejected', 'Deferred'],
  'In Progress': ['Fixed', 'Deferred', 'Assigned', 'Rejected'],
  Fixed: ['Retest', 'Reopened', 'Verified'],
  Retest: ['Closed', 'Reopened', 'Verified'],
  Reopened: ['Assigned', 'In Progress', 'Fixed'],
  Verified: ['Closed', 'Reopened'],
  Deferred: ['Assigned', 'In Progress', 'New', 'Closed'],
  Rejected: ['Reopened', 'Closed'],
  Closed: ['Reopened'],
}

/** Statuses a defect may move to from `current`, in display order. */
export function allowedNextStatuses(current: string, catalog?: DefectFieldCatalog): DefectStatus[] {
  const table = catalog?.transitions ?? FALLBACK_TRANSITIONS
  const allowed = new Set(table[current] ?? [])
  return DEFECT_STATUSES.filter((s) => allowed.has(s))
}

export interface ResolutionRule {
  required: boolean
  /** Empty: the defect must not carry a resolution in this status. */
  allowed: Resolution[]
}

const NONE: ResolutionRule = { required: false, allowed: [] }

/** Mirror of `RESOLUTION_RULES` (core/field_standards.py). */
export const RESOLUTION_RULES: Record<string, ResolutionRule> = {
  New: NONE,
  Open: NONE,
  Assigned: NONE,
  'In Progress': NONE,
  Retest: NONE,
  Reopened: NONE,
  Fixed: { required: true, allowed: ['Fixed'] },
  Verified: { required: false, allowed: ['Fixed'] },
  Rejected: { required: true, allowed: ['Duplicate', "Won't Fix", 'Cannot Reproduce', 'By Design', 'Not Applicable'] },
  Deferred: { required: false, allowed: ["Won't Fix", 'By Design', 'Not Applicable'] },
  Closed: { required: true, allowed: RESOLUTIONS },
}

export function resolutionRule(status: string): ResolutionRule {
  return RESOLUTION_RULES[status] ?? NONE
}

/** Why a status asks for (or forbids) a resolution; shown beside the field. */
export function resolutionExplanation(status: string): string {
  const rule = resolutionRule(status)
  if (rule.allowed.length === 0) return `A resolution is not used while a defect is ${status}; it is cleared on the move.`
  if (rule.required) return `A resolution is required to set a defect to ${status}.`
  return `A resolution is optional for ${status}.`
}

/** The resolution the server fills in when none is sent (null: the user must choose). */
export function defaultResolution(from: string, to: string): Resolution | null {
  if (to === 'Fixed') return 'Fixed'
  if (to === 'Closed' && (from === 'Fixed' || from === 'Retest' || from === 'Verified')) return 'Fixed'
  return null
}

/** What moving a defect from `from` to `to` involves, for the status dialog. */
export interface TransitionPlan {
  from: string
  to: DefectStatus
  /** The user must choose a resolution (the server would refuse without one). */
  needsResolution: boolean
  resolutionOptions: Resolution[]
  /** Pre-selected resolution (Fixed -> Closed keeps "Fixed"). */
  defaultResolution: Resolution | null
  /** Closing needs the explicit verification gesture. */
  needsVerification: boolean
  /** Closed / Reopened need `defect.close` (or the Admin / Manager tier). */
  needsClosePermission: boolean
}

export function planTransition(from: string, to: DefectStatus): TransitionPlan {
  const rule = resolutionRule(to)
  const fallback = defaultResolution(from, to)
  return {
    from,
    to,
    // A default means the server fills it in, so the user is not forced to pick; they still may.
    needsResolution: rule.required && fallback === null,
    resolutionOptions: rule.allowed,
    defaultResolution: fallback,
    needsVerification: to === 'Closed',
    needsClosePermission: to === 'Closed' || to === 'Reopened',
  }
}

export interface StatusPermissions {
  /** defect.change_status, defect.create or defect.close. */
  canChangeStatus: boolean
  /** defect.close or the Admin / Manager tier. */
  canClose: boolean
  /** `testcase.execute`; left out means not restricted here (the API still decides). */
  canVerify?: boolean
}

export interface TransitionOption {
  status: DefectStatus
  plan: TransitionPlan
  /** Why the option cannot be used by this user (shown disabled with the reason). */
  disabledReason?: string
  /** The same, in a few words for a menu item. */
  shortReason?: string
}

/**
 * The status menu of a defect: only the allowed next statuses, each with what it involves.
 * Without permission to change status the menu is empty; Closed and Reopened stay visible but
 * disabled (with the reason) for a user who may change status but not close.
 */
export function transitionMenu(current: string, perms: StatusPermissions, catalog?: DefectFieldCatalog): TransitionOption[] {
  if (!perms.canChangeStatus && !perms.canClose) return []
  return allowedNextStatuses(current, catalog).map((status) => {
    const plan = planTransition(current, status)
    if (plan.needsClosePermission && !perms.canClose) {
      return {
        status,
        plan,
        disabledReason: `Only a manager or someone who can close defects can set ${status}`,
        shortReason: 'needs close permission',
      }
    }
    // ADR-143: verifying a fix is a test result.
    if (status === 'Verified' && perms.canVerify === false) {
      return {
        status,
        plan,
        disabledReason: 'Only someone who can run tests can mark a defect Verified',
        shortReason: 'needs permission to run tests',
      }
    }
    return { status, plan }
  })
}

// ---- status groups (Closed = Closed + Rejected; Deferred is parked, not closed) --------------

export const CLOSED_STATUSES: DefectStatus[] = ['Closed', 'Rejected']
export const RETEST_STATUSES: DefectStatus[] = ['Retest']

/** Every status that is not finished: the "open defects" of the nav badge and the dashboard KPI. */
export const OPEN_STATUSES: DefectStatus[] = DEFECT_STATUSES.filter((s) => !CLOSED_STATUSES.includes(s))

/** Deep link to the list narrowed to the open defects (the dashboard KPI, the nav badge's group). */
export const OPEN_DEFECTS_HREF = `/defects?${new URLSearchParams({ status: OPEN_STATUSES.join(',') }).toString()}`

export function isClosedStatus(status: string): boolean {
  return (CLOSED_STATUSES as string[]).includes(status)
}

export interface StatusTabDef {
  key: string
  label: string
  statuses: DefectStatus[]
  /** What the tab holds, for its tooltip. */
  hint: string
}

/** The status tabs of the list. Tabs may overlap: Open is everything not yet Closed or Rejected. */
export const STATUS_TABS: StatusTabDef[] = [
  { key: 'open', label: 'Open', statuses: OPEN_STATUSES, hint: 'Everything not yet Closed or Rejected' },
  { key: 'fixed', label: 'Fixed', statuses: ['Fixed', 'Verified'], hint: 'Fixed, awaiting verification' },
  { key: 'retest', label: 'Retest', statuses: ['Retest'], hint: 'Being retested' },
  { key: 'reopened', label: 'Reopened', statuses: ['Reopened'], hint: 'Came back after a fix' },
  { key: 'deferred', label: 'Deferred', statuses: ['Deferred'], hint: 'Parked for later' },
  { key: 'closed', label: 'Closed', statuses: CLOSED_STATUSES, hint: 'Closed or Rejected' },
]

function sameStatuses(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((s) => b.includes(s))
}

/** The tab whose statuses are exactly `statuses`; '' when empty (All); null for a custom selection. */
export function tabKeyForStatuses(statuses: string[]): string | null {
  if (statuses.length === 0) return ''
  return STATUS_TABS.find((t) => sameStatuses(t.statuses, statuses))?.key ?? null
}

/** The URL value (`status=` comma list) a tab sets; '' for All. */
export function statusesForTab(key: string): DefectStatus[] {
  return STATUS_TABS.find((t) => t.key === key)?.statuses ?? []
}

/** Sum of the per-status counts over a group of statuses. */
export function sumStatusCounts(counts: Record<string, number>, statuses: readonly string[]): number {
  return statuses.reduce((n, s) => n + (counts[s] ?? 0), 0)
}

/** "Showing the whole set" parse of the `status` URL value. */
export function parseList(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
}

// ---- quick actions of the detail page ---------------------------------------------------------

export interface QuickActions {
  /** "Start retest": creates the Retest run (a Fixed or Retest defect). */
  startRetest: boolean
  /** "Reopen": the defect may move to Reopened and the user may reopen. */
  reopen: boolean
  /** "Close": the defect may move to Closed and the user may close. */
  close: boolean
  /** The transition menu has at least one entry. */
  changeStatus: boolean
}

/** Which workflow buttons the detail header shows for a defect in `status` (the API still decides). */
export function quickActions(status: string, perms: StatusPermissions, catalog?: DefectFieldCatalog): QuickActions {
  const next = allowedNextStatuses(status, catalog)
  return {
    startRetest: perms.canChangeStatus && (status === 'Fixed' || status === 'Retest'),
    reopen: perms.canClose && next.includes('Reopened'),
    close: perms.canClose && next.includes('Closed'),
    changeStatus: transitionMenu(status, perms, catalog).length > 0,
  }
}

/** What an executed retest run case says: passed / failed, or null while it is still to be run (or blocked / ignored). */
export function retestOutcome(runCaseStatus: string): 'pass' | 'fail' | null {
  if (runCaseStatus === 'passed') return 'pass'
  if (runCaseStatus === 'failed') return 'fail'
  return null
}

/**
 * Retest run cases that have been executed but whose result has not yet been recorded on the
 * defect. Only a defect in Retest takes a result; recording one moves it (pass: Closed or Verified,
 * fail: Reopened) and the run case itself is never changed.
 */
export function retestsAwaitingResult(status: string, retests: DefectRetest[]): DefectRetest[] {
  if (status !== 'Retest') return []
  return retests.filter((r) => r.result == null && retestOutcome(r.run_case_status) !== null)
}
