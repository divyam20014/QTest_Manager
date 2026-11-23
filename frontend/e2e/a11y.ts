import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'

// Shared axe helper for the full-impact accessibility specs (GAP-22, ADR-090).
// Every impact level (minor, moderate, serious, critical) over WCAG 2.0/2.1
// A + AA and axe's best-practice rules. `allow` is the explicit, documented
// allowlist of known findings ("rule id" -> why); an allowlisted rule is still
// reported by the probe run but does not fail the gate. Keep it EMPTY unless a
// finding is recorded in docs/KNOWN_GAPS.md (GAP-22).
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']

export interface Finding {
  rule: string
  impact: string
  count: number
  target: string
}

export async function axeFindings(
  page: Page,
  allow: Readonly<Record<string, string>> = {},
  include?: string,
): Promise<Finding[]> {
  // `include` scopes the scan to one subtree, e.g. the top modal: the page behind a modal is
  // inert and dimmed by its backdrop(s), so measuring its contrast says nothing about users.
  const builder = new AxeBuilder({ page }).withTags(AXE_TAGS)
  if (include) builder.include(include)
  const results = await builder.analyze()
  return results.violations
    .filter((v) => !(v.id in allow))
    .map((v) => ({
      rule: v.id,
      impact: v.impact ?? 'unknown',
      count: v.nodes.length,
      target: v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(' '))
        .join(' | '),
    }))
}

export function formatFindings(label: string, findings: Finding[]): string[] {
  return findings.map(
    (f) => `${label}: axe ${f.rule} (${f.impact}) x${f.count}: ${f.target}`,
  )
}
