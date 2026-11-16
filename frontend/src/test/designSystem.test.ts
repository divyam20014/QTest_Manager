/// <reference types="node" />
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC = path.resolve(import.meta.dirname, '..')
const css = fs.readFileSync(path.join(SRC, 'index.css'), 'utf8')

// Design-system guardrails (Phase B). Two cheap, dependency-free checks that
// stop the system from silently drifting:
//   1. Every theme-dependent token is defined in all three theme blocks.
//   2. Hard-coded colours in signed-in screens can only go DOWN (a ratchet).

// Raw source text of the signed-in screens (Vite-native glob).
const sources = import.meta.glob<string>(['../routes/**/*.tsx', '../components/**/*.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

function declaredProps(block: string): Set<string> {
  return new Set([...block.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((m) => m[1]))
}

function extractBlock(source: string, startMarker: string): string {
  const start = source.indexOf(startMarker)
  if (start < 0) throw new Error(`index.css: could not find "${startMarker}"`)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i)
  }
  throw new Error(`index.css: unterminated block for "${startMarker}"`)
}

describe('design tokens', () => {
  const root = declaredProps(extractBlock(css, ':root {'))
  const darkMedia = declaredProps(extractBlock(css, ':root:not([data-theme="light"]) {'))
  const darkAttr = declaredProps(extractBlock(css, ':root[data-theme="dark"] {'))

  it('keeps the OS-dark and forced-dark blocks identical', () => {
    expect([...darkMedia].sort()).toEqual([...darkAttr].sort())
  })

  it('only overrides tokens in dark mode that exist in :root', () => {
    for (const name of darkAttr) expect(root.has(name), `${name} missing from :root`).toBe(true)
  })

  it('defines a dark value for every status and chart colour token', () => {
    for (const name of root) {
      if (/^--(status|chart)-/.test(name)) {
        expect(darkAttr.has(name), `${name} has no dark-mode value`).toBe(true)
      }
    }
  })
})

// Ratchet: counts of hard-coded colours (#rrggbb and Tailwind palette classes
// such as text-red-700) per file as of design-system Phase B. Use the
// --status-*, --chart-* and brand tokens instead. These numbers may only
// shrink; when you remove some, lower the number (or delete the entry).
const HARD_CODED_COLOUR_BASELINE: Record<string, number> = {
  'routes/admin/Settings.tsx': 1,
  'routes/reporting/CompliancePrintView.tsx': 1,
}

const COLOUR_RE =
  /#[0-9a-fA-F]{6}\b|\b(?:bg|text|border|ring|from|to|via)-(?:red|green|blue|amber|emerald|yellow|orange|gray|slate|zinc|neutral|stone|purple|indigo|violet|rose|pink|sky|cyan|teal|lime|fuchsia)-\d{2,3}\b/g

function collect(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [file, text] of Object.entries(sources)) {
    // The marketing site has its own palette (marketing.css); tests and the
    // design catalogue are exempt.
    if (/\/marketing\/|\.test\.|_DesignPreview|MarketingRoute/.test(file)) continue
    const count = (text.match(COLOUR_RE) ?? []).length
    if (count) out[file.replace('../', '')] = count
  }
  return out
}

describe('hard-coded colours in signed-in screens', () => {
  const current = collect()

  it('never exceed the recorded baseline (use design tokens instead)', () => {
    for (const [file, count] of Object.entries(current)) {
      const allowed = HARD_CODED_COLOUR_BASELINE[file] ?? 0
      expect(count, `${file} has ${count} hard-coded colours (allowed ${allowed})`).toBeLessThanOrEqual(allowed)
    }
  })
})

// Phase F ratchet: radius and type scale. `rounded` / `rounded-sm` are 4px / 2px,
// which are not on the radius scale (control 6px, card 8px, panel 12px, sheet
// 16px, pill); 10px text is below the 11px floor. Both were normalised in
// Phase F and must stay at zero.
const OFF_SCALE_RE = /(?<![\w-])rounded(?:-sm)?(?![\w-])|text-\[10px\]/g

describe('radius and type scale in signed-in screens', () => {
  it('uses no off-scale radius (rounded, rounded-sm) and no 10px text', () => {
    const offenders: string[] = []
    for (const [file, text] of Object.entries(sources)) {
      if (/\/marketing\/|\.test\.|_DesignPreview|MarketingRoute/.test(file)) continue
      // Comments may mention the words; only look at class strings.
      const code = text
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n')
      const hits = code.match(OFF_SCALE_RE)
      if (hits) offenders.push(`${file.replace('../', '')}: ${hits.length}`)
    }
    expect(offenders, `off-scale radius/type found: ${offenders.join(', ')}`).toEqual([])
  })
})
