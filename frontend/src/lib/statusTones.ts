import type { BadgeTone } from '@/components/ui/badge'

/**
 * Single source of truth for the tone of the value sets that appear on many
 * screens (UX-011). Domain-only status sets (defect status, project status,
 * lead status ...) keep one map beside their module; anything shared lives
 * here so the same word is never two different colours.
 */

// Priority and severity share one scale. Tenants can add custom values
// (ADR-055); anything unrecognised is neutral.
const LEVEL_TONE: Record<string, BadgeTone> = {
  Low: 'neutral',
  Medium: 'warning',
  High: 'warning',
  Critical: 'critical',
}

export function levelTone(level: string): BadgeTone {
  return LEVEL_TONE[level] ?? 'neutral'
}

// Status of a test case inside a test run.
export const RUN_CASE_STATUS_TONE: Record<string, BadgeTone> = {
  pending: 'neutral',
  in_progress: 'warning',
  passed: 'positive',
  failed: 'critical',
  blocked: 'critical',
  ignored: 'neutral',
}

// A single step's verdict.
export const VERDICT_TONE: Record<string, BadgeTone> = {
  pass: 'positive',
  fail: 'critical',
  ignore: 'neutral',
}
