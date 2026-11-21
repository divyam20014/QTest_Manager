/// <reference types="node" />
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { contrast } from '@/lib/themeDerive'

// ADR-101: the marketing site maps its colours onto the semantic theme tokens
// (marketing.css `.qth-landing`), so the landing page is only as accessible as
// these token pairs in each of the five built-in themes.
const css = fs.readFileSync(path.resolve(import.meta.dirname, '../index.css'), 'utf8')

function block(marker: string): Record<string, string> {
  const start = css.indexOf(marker)
  if (start < 0) throw new Error(`no block ${marker}`)
  const open = css.indexOf('{', start)
  const out: Record<string, string> = {}
  let depth = 0
  let end = open
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) {
      end = i
      break
    }
  }
  for (const m of css.slice(open + 1, end).matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm)) out[m[1]] = m[2].trim()
  return out
}

const root = block(':root {')
const THEMES: Record<string, Record<string, string>> = {
  light: root,
  dark: { ...root, ...block(':root[data-theme="dark"] {') },
  cobalt: { ...root, ...block(':root[data-theme="cobalt"] {') },
  sage: { ...root, ...block(':root[data-theme="sage"] {') },
  indigo: { ...root, ...block(':root[data-theme="indigo"] {') },
}

// [foreground token, background token, what it is, minimum ratio]
const PAIRS: Array<[string, string, string, number]> = [
  ['--foreground', '--background', 'body text', 4.5],
  ['--muted-foreground', '--background', 'secondary text', 4.5],
  ['--muted-foreground', '--muted', 'secondary text on soft sections', 4.5],
  ['--foreground', '--muted', 'body text on soft sections', 4.5],
  ['--primary', '--background', 'eyebrow / check icon', 4.5],
  ['--primary', '--muted', 'eyebrow on soft sections', 4.5],
  ['--primary', '--brand-muted', 'tinted badge', 4.5],
  ['--link', '--background', 'text link', 4.5],
  ['--primary-foreground', '--primary', 'primary button', 4.5],
  ['--accent-foreground', '--accent', 'hero CTA (dark text on sunshine)', 4.5],
  ['--sidebar-active-foreground', '--sidebar-bg', 'headings on dark bands', 4.5],
  ['--sidebar-foreground', '--sidebar-bg', 'body on dark bands', 4.5],
  ['--sidebar-foreground-muted', '--sidebar-bg', 'captions on dark bands', 4.5],
  ['--sidebar-accent', '--sidebar-bg', 'eyebrow / link on dark bands', 4.5],
  ['--status-good', '--status-good-bg', 'available badge', 4.5],
  ['--status-info', '--status-info-bg', 'partial badge', 4.5],
  ['--status-warning', '--status-warning-bg', 'planned badge', 4.5],
  ['--accent', '--sidebar-bg', 'CTA button edge against the band (UI)', 3],
  ['--link', '--background', 'focus ring on light sections (UI)', 3],
  ['--sidebar-accent', '--sidebar-bg', 'focus ring on dark bands (UI)', 3],
  ['--control-border', '--background', 'form control border (UI)', 3],
]

describe('marketing landing page contrast (all five themes)', () => {
  for (const [name, tokens] of Object.entries(THEMES)) {
    describe(name, () => {
      for (const [fg, bg, what, min] of PAIRS) {
        it(`${what}: ${fg} on ${bg} >= ${min}`, () => {
          const f = tokens[fg] ?? (fg === '--control-border' ? tokens['--muted-foreground'] : undefined)
          const b = tokens[bg] ?? (bg === '--brand-muted' ? tokens['--muted'] : undefined)
          expect(f, `${name} defines ${fg}`).toMatch(/^#[0-9a-f]{6}$/i)
          expect(b, `${name} defines ${bg}`).toMatch(/^#[0-9a-f]{6}$/i)
          expect(contrast(f, b)).toBeGreaterThanOrEqual(min)
        })
      }
    })
  }
})
