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

// Phase 7 (ADR-126): wait until every finite animation and transition has finished and no more
// than `maxDialogs` dialogs are open, so axe never measures colour through a fading backdrop.
// Looping animations (spinners, skeleton pulses) never finish and are ignored.
export async function settle(page: Page, maxDialogs = 1) {
  await page
    .waitForFunction(
      (max) =>
        document.getAnimations().every((a) => a.effect?.getComputedTiming().iterations === Infinity) &&
        document.querySelectorAll('[role="dialog"]').length <= max,
      maxDialogs,
      { timeout: 10_000 },
    )
    .catch(() => undefined)
}

export interface SmallTarget {
  label: string
  width: number
  height: number
}

// Visible interactive elements whose box is smaller than `min` px in either direction. Inline
// links inside running text are exempt (WCAG 2.5.8), as are visually hidden helpers; a stretched
// link counts as its whole card.
export async function smallTargets(page: Page, min: number): Promise<SmallTarget[]> {
  return page.evaluate((limit) => {
    const sel =
      'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="switch"], [role="link"]'
    const out: { label: string; width: number; height: number }[] = []
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      let r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const cs = getComputedStyle(el)
      // A stretched link (an ::after pinned to every edge of its positioned card) is operated
      // through the whole card: measure the card.
      const after = getComputedStyle(el, '::after')
      if (after.position === 'absolute' && after.content !== 'none' && parseFloat(after.top) === 0 && parseFloat(after.left) === 0) {
        let host: HTMLElement | null = el.parentElement
        while (host && getComputedStyle(host).position === 'static') host = host.parentElement
        if (host) r = host.getBoundingClientRect()
      }
      if (cs.visibility === 'hidden' || cs.display === 'none') continue
      if (el.closest('[aria-hidden="true"], [inert]')) continue
      if (el.classList.contains('sr-only') || (r.width <= 1 && r.height <= 1)) continue
      if (el.tagName === 'A' && cs.display === 'inline') continue
      // A bare checkbox / radio inside a label is operated through the label's box.
      const lab = el.closest('label')
      if (lab && (el as HTMLInputElement).type && ['checkbox', 'radio'].includes((el as HTMLInputElement).type)) {
        const lr = lab.getBoundingClientRect()
        if (lr.width >= limit && lr.height >= limit) continue
      }
      if (r.width < limit || r.height < limit) {
        out.push({
          label: `${el.tagName.toLowerCase()}[${(el.getAttribute('aria-label') || el.textContent || el.getAttribute('name') || '').trim().slice(0, 30)}]`,
          width: Math.round(r.width),
          height: Math.round(r.height),
        })
      }
    }
    return out
  }, min)
}
