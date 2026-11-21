/// <reference types="node" />
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseCustomState, parseCustomTheme } from '@/lib/customThemes'
import {
  contrast,
  deriveTheme,
  DERIVED_TOKEN_NAMES,
  HEX6,
  normalizeHex,
  PRESET_INPUTS,
  TINTS,
  type ThemeInput,
} from '@/lib/themeDerive'

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

const rootTokens = block(':root {')
const darkTokens = { ...rootTokens, ...block(':root[data-theme="dark"] {') }
const THEMES: Record<string, Record<string, string>> = {
  light: rootTokens,
  dark: darkTokens,
  cobalt: block(':root[data-theme="cobalt"] {'),
  sage: block(':root[data-theme="sage"] {'),
  indigo: block(':root[data-theme="indigo"] {'),
}

const BODY: Array<[string, string, string]> = [
  ['--foreground', '--background', 'body text'],
  ['--foreground', '--tactile-surface', 'body text on surface'],
  ['--foreground', '--tactile-surface-raised', 'body text on raised'],
  ['--muted-foreground', '--background', 'muted text'],
  ['--muted-foreground', '--tactile-surface', 'muted text on surface'],
  ['--muted-foreground', '--muted', 'muted text on muted'],
  ['--primary-foreground', '--primary', 'primary button'],
  ['--accent-foreground', '--accent', 'accent button'],
  ['--link', '--background', 'link'],
  ['--link', '--tactile-surface-raised', 'link on raised'],
  ['--destructive-foreground', '--destructive', 'destructive button'],
  ['--success-solid-foreground', '--success-solid', 'success button'],
  ['--sidebar-foreground', '--sidebar-bg', 'sidebar text'],
  ['--sidebar-foreground-muted', '--sidebar-bg', 'sidebar muted text'],
  ['--sidebar-active-foreground', '--sidebar-active-bg', 'sidebar active'],
  ...['good', 'warning', 'serious', 'critical', 'neutral', 'info'].flatMap((s): Array<[string, string, string]> => [
    [`--status-${s}`, `--status-${s}-bg`, `status ${s} on tint`],
    [`--status-${s}`, '--background', `status ${s} on background`],
  ]),
]

describe.each(Object.entries(THEMES))('theme %s meets WCAG AA', (name, t) => {
  it('text pairs reach 4.5:1', () => {
    for (const [fg, bg, label] of BODY) {
      expect(t[fg], `${name} ${fg}`).toMatch(HEX6)
      expect(contrast(t[fg], t[bg]), `${name}: ${label} (${fg} on ${bg})`).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('control borders and focus ring reach 3:1', () => {
    if (name === 'light' || name === 'dark') {
      // Default themes keep their soft --border; only the new strong border is asserted.
      expect(contrast(t['--border-strong'], t['--background'])).toBeGreaterThanOrEqual(3)
      expect(contrast(t['--border-strong'], t['--tactile-surface'])).toBeGreaterThanOrEqual(3)
      return
    }
    for (const surface of ['--background', '--tactile-surface', '--tactile-surface-raised', '--muted']) {
      expect(contrast(t['--control-border'], t[surface]), `control border on ${surface}`).toBeGreaterThanOrEqual(3)
      expect(contrast(t['--ring'], t[surface]), `ring on ${surface}`).toBeGreaterThanOrEqual(3)
      expect(contrast(t['--primary'], t[surface]), `primary on ${surface}`).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('colour theme blocks', () => {
  it('set every token the dark theme sets, so nothing leaks from the OS-dark block', () => {
    const dark = block(':root[data-theme="dark"] {')
    for (const id of ['cobalt', 'sage', 'indigo']) {
      for (const k of Object.keys(dark)) expect(THEMES[id][k], `${id} lacks ${k}`).toBeDefined()
    }
  })
  it('match what deriveTheme produces for the preset inputs (regenerate if this fails)', () => {
    for (const [id, input] of Object.entries(PRESET_INPUTS)) {
      const tokens = deriveTheme(input).tokens
      expect(Object.fromEntries(Object.keys(tokens).map((k) => [k, THEMES[id][k]])), id).toEqual(tokens)
    }
  })
  it('prints the contrast table', () => {
    const rows = Object.entries(THEMES).map(([id, t]) => {
      const r = (a: string, b: string) => contrast(t[a], t[b]).toFixed(1)
      return `${id}: body ${r('--foreground', '--background')} muted ${r('--muted-foreground', '--background')} primary-btn ${r('--primary-foreground', '--primary')} accent-btn ${r('--accent-foreground', '--accent')} link ${r('--link', '--background')}`
    })
    console.info(rows.join('\n'))
  })
})

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}
const hex = (n: number) => '#' + Math.floor(n * 0xffffff).toString(16).padStart(6, '0')

describe('deriveTheme', () => {
  const extremes = ['#ffff00', '#000000', '#ffffff', '#00ff00', '#0000ff', '#ff00ff', '#808080', '#fefefe', '#010101']
  const next = rng(42)
  const inputs: ThemeInput[] = []
  for (let i = 0; i < 200; i++) {
    inputs.push({
      base: next() < 0.5 ? 'light' : 'dark',
      primary: i < extremes.length * 2 ? extremes[i % extremes.length] : hex(next()),
      accent: i < extremes.length * 2 ? extremes[(i + 3) % extremes.length] : hex(next()),
      tint: TINTS[Math.floor(next() * TINTS.length)],
    })
  }

  it('guarantees AA for 200 random and extreme inputs', () => {
    for (const input of inputs) {
      const d = deriveTheme(input)
      expect(
        d.checks.filter((c) => !c.pass),
        JSON.stringify(input),
      ).toEqual([])
      expect(d.allPass).toBe(true)
      for (const [k, v] of Object.entries(d.tokens)) {
        expect(v, `${k} for ${JSON.stringify(input)}`).toMatch(
          /^(#[0-9a-f]{6}|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, [0-9.]+\))$/,
        )
      }
      // The reported ratios are real: recompute from the emitted tokens.
      expect(contrast(d.tokens['--primary-foreground'], d.tokens['--primary'])).toBeGreaterThanOrEqual(4.5)
      expect(contrast(d.tokens['--accent-foreground'], d.tokens['--accent'])).toBeGreaterThanOrEqual(4.5)
      expect(contrast(d.tokens['--link'], d.tokens['--background'])).toBeGreaterThanOrEqual(4.5)
      expect(contrast(d.tokens['--sidebar-foreground'], d.tokens['--sidebar-bg'])).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('never puts white text on yellow and reports an adjusted primary', () => {
    const d = deriveTheme({ base: 'light', primary: '#ffff00', accent: '#ffc93c', tint: 'neutral' })
    expect(d.tokens['--accent-foreground']).not.toBe('#ffffff')
    expect(d.tokens['--primary']).not.toBe('#ffff00')
    expect(d.adjusted.length).toBeGreaterThan(0)
  })

  it('sets every token the dark theme defines', () => {
    for (const k of Object.keys(block(':root[data-theme="dark"] {'))) expect(DERIVED_TOKEN_NAMES, k).toContain(k)
  })
})

describe('hex handling and storage validation', () => {
  it('normalises valid hex and rejects the rest', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc')
    expect(normalizeHex('12ab9f')).toBe('#12ab9f')
    for (const bad of ['', '#12345', '#1234567', 'red', '#gggggg', 'rgb(0,0,0)', 'url(x)', '#12 456']) {
      expect(normalizeHex(bad), bad).toBeNull()
    }
  })

  const good = { id: 'ab12', name: 'Mine', base: 'dark', primary: '#112233', accent: '#aabbcc', tint: 'warm' }
  it('accepts a valid theme and ignores invalid ones', () => {
    expect(parseCustomTheme(good)).toEqual(good)
    const bad = [
      { ...good, primary: 'red' },
      { ...good, primary: '#ABCDEF' },
      { ...good, accent: 'url(javascript:1)' },
      { ...good, name: '' },
      { ...good, name: 'x'.repeat(25) },
      { ...good, name: '<b>' },
      { ...good, base: 'blue' },
      { ...good, tint: 'neon' },
      { ...good, id: 'Not Valid!' },
      null,
      'x',
    ]
    for (const b of bad) expect(parseCustomTheme(b), JSON.stringify(b)).toBeNull()
  })
  it('parses state: drops invalid, caps at 3, tolerates garbage', () => {
    const many = [1, 2, 3, 4].map((n) => ({ ...good, id: `t${n}` }))
    const raw = JSON.stringify({ v: 1, activeId: 't2', themes: [...many, { ...good, id: 'bad', primary: 'x' }] })
    const state = parseCustomState(raw)
    expect(state.themes.map((t) => t.id)).toEqual(['t1', 't2', 't3'])
    expect(state.activeId).toBe('t2')
    expect(parseCustomState(JSON.stringify({ v: 1, activeId: 'gone', themes: [good] })).activeId).toBe('ab12')
    for (const junk of [null, '', '{', '[]', '"x"', JSON.stringify({ v: 2, themes: [good] }), 'x'.repeat(9000)]) {
      expect(parseCustomState(junk)).toEqual({ themes: [], activeId: null })
    }
  })
})
