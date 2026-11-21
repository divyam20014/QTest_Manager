// Theme token derivation (ADR-100). A pure module with NO imports so a Node
// script can load it to generate the preset CSS blocks, and so the same code
// serves the three presets and the user's custom palette.
//
// From base mode + primary + accent + surface tint it derives the FULL token set
// and enforces WCAG AA: foregrounds are chosen per fill, link/ring/border colours
// have their lightness moved until they pass, and every change is reported.

export type Base = 'light' | 'dark'
export type Tint = 'neutral' | 'warm' | 'cool' | 'lavender' | 'charcoal'
export interface ThemeInput {
  base: Base
  primary: string
  accent: string
  tint: Tint
}
export interface Check {
  label: string
  ratio: number
  min: number
  pass: boolean
}
export interface Derived {
  scheme: Base
  tokens: Record<string, string>
  adjusted: string[]
  checks: Check[]
  allPass: boolean
}

export const TINTS: readonly Tint[] = ['neutral', 'warm', 'cool', 'lavender', 'charcoal']
export const HEX6 = /^#[0-9a-f]{6}$/

/** "#abc", "abc", "#AABBCC" -> "#aabbcc"; anything else -> null. */
export function normalizeHex(value: string): string | null {
  const v = value.trim().toLowerCase().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/.test(v)) return '#' + [...v].map((c) => c + c).join('')
  return /^[0-9a-f]{6}$/.test(v) ? '#' + v : null
}

type RGB = [number, number, number]
const toRgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB
const toHex = (rgb: RGB) =>
  '#' + rgb.map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('')

export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = toRgb(hex).map((c) => c / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l * 100]
  const s = d / (1 - Math.abs(2 * l - 1))
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h = (h * 60 + 360) % 360
  return [h, s, l * 100]
}
function hsl(h: number, s: number, l: number): string {
  const L = Math.max(0, Math.min(100, l)) / 100
  const a = s * Math.min(L, 1 - L)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return L - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return toHex([f(0) * 255, f(8) * 255, f(4) * 255])
}
function mix(a: string, b: string, t: number): string {
  const [x, y] = [toRgb(a), toRgb(b)]
  return toHex(x.map((c, i) => c + (y[i] - c) * t) as RGB)
}
const rgba = (hex: string, alpha: number) => {
  const [r, g, b] = toRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** Move the colour's lightness (darker/lighter) until it reaches `min` against every `against`. */
function fit(hex: string, against: string[], min: number, dir: 'darker' | 'lighter'): string {
  const ok = (c: string) => against.every((bg) => contrast(c, bg) >= min)
  if (ok(hex)) return hex
  const [h, s, l] = toHsl(hex)
  const step = dir === 'darker' ? -0.5 : 0.5
  for (let v = l + step; v >= 0 && v <= 100; v += step) {
    const c = hsl(h, s, v)
    if (ok(c)) return c
  }
  return dir === 'darker' ? '#000000' : '#ffffff'
}

/** Text colour for a fill: white or a tinted near-black, whichever reads better (always >= 4.5:1). */
function onColor(fill: string, hue: number): string {
  const dark = hsl(hue, 0.25, 7)
  const best = contrast('#ffffff', fill) >= contrast(dark, fill) ? '#ffffff' : dark
  if (contrast(best, fill) >= 4.5) return best
  return contrast('#ffffff', fill) >= contrast('#000000', fill) ? '#ffffff' : '#000000'
}

const TINT: Record<Tint, { h: number; s: number }> = {
  neutral: { h: 220, s: 0.04 },
  warm: { h: 38, s: 0.45 },
  cool: { h: 215, s: 0.45 },
  lavender: { h: 255, s: 0.55 },
  charcoal: { h: 205, s: 0.1 },
}

// Semantic status colours stay the same hue family in every theme so a status
// reads the same everywhere (and is always paired with an icon + label).
const STATUS = {
  light: {
    good: ['#0a7050', '#e6f6ef'],
    warning: ['#b45309', '#fef3e2'],
    serious: ['#b91c1c', '#fde8e8'],
    critical: ['#7c1d6f', '#f7e6f4'],
    neutral: ['#52525b', '#f1f1f3'],
    info: ['#1d4ed8', '#e8f0fe'],
  },
  dark: {
    good: ['#3dd68c', '#0f2a20'],
    warning: ['#f5a623', '#332308'],
    serious: ['#f87171', '#3a1414'],
    critical: ['#e391d6', '#321830'],
    neutral: ['#a1a1aa', '#232326'],
    info: ['#8ab8f5', '#12233d'],
  },
} as const

/** Every custom property a derived theme sets (kept in sync with index.css by a unit test). */
export function deriveTheme(input: ThemeInput): Derived {
  const { base } = input
  const light = base === 'light'
  const dir = light ? 'darker' : 'lighter'
  const { h, s } = TINT[input.tint]
  const adjusted: string[] = []
  const checks: Check[] = []
  const check = (label: string, fg: string, bg: string, min: number) => {
    const ratio = Math.round(contrast(fg, bg) * 100) / 100
    checks.push({ label, ratio, min, pass: ratio >= min })
  }

  const background = light ? hsl(h, s, 98) : hsl(h, s, 11.5)
  const surface = light ? hsl(h, s, 94.5) : hsl(h, s, 14)
  const raised = light ? hsl(h, s, 97.5) : hsl(h, s, 18.5)
  const muted = light ? hsl(h, s, 93.5) : hsl(h, s, 17)
  const border = light ? hsl(h, s * 0.8, 87) : hsl(h, s * 0.8, 27)
  const surfaces = [background, surface, raised, muted]
  const foreground = light ? hsl(h, Math.min(s, 0.3), 8) : hsl(h, Math.min(s, 0.2), 95)
  const mutedForeground = fit(light ? hsl(h, 0.1, 40) : hsl(h, 0.1, 68), surfaces, 4.6, dir)
  const borderStrong = fit(hsl(h, s * 0.5, light ? 60 : 45), surfaces, 3, dir)

  // Primary is a fill AND a UI boundary, so it must reach 3:1 against the surfaces.
  const primary = fit(input.primary, surfaces, 3, dir)
  if (primary !== input.primary) adjusted.push(`Primary was ${light ? 'darkened' : 'lightened'} to stay visible on the surfaces.`)
  const primaryForeground = onColor(primary, h)
  const brandMuted = mix(background, primary, light ? 0.1 : 0.2)
  const link = fit(primary, [...surfaces, brandMuted], 4.6, dir)
  if (link !== primary) adjusted.push('Link colour was adjusted so link text reaches 4.5:1.')
  const ring = fit(primary, surfaces, 3, dir)
  const accent = input.accent
  const accentForeground = onColor(accent, h)

  const destructive = light ? '#dc2626' : '#f87171'
  const destructiveForeground = light ? '#ffffff' : '#0a0a0a'
  const successSolid = light ? '#047857' : '#3dd68c'
  const successSolidForeground = light ? '#ffffff' : '#0a0a0a'

  // Sidebar: always a dark panel. Light themes tint it from the primary hue.
  const sh = light ? toHsl(primary)[0] : h
  const ss = light ? 0.5 : Math.max(s, 0.1)
  const sidebarBg = hsl(sh, ss, light ? 13 : 8)
  const sidebarRaised = hsl(sh, ss, light ? 17 : 11)
  const sidebarActiveBg = hsl(sh, ss, light ? 23 : 19)
  const sidebarSurfaces = [sidebarBg, sidebarRaised, sidebarActiveBg]
  const sidebarForeground = fit(hsl(sh, 0.25, 80), sidebarSurfaces, 4.6, 'lighter')
  const sidebarMuted = fit(hsl(sh, 0.2, 62), sidebarSurfaces, 4.6, 'lighter')
  const sidebarAccent = fit(accent, sidebarSurfaces, 4.6, 'lighter')

  const st = STATUS[base]
  const tokens: Record<string, string> = {
    '--background': background,
    '--foreground': foreground,
    '--muted': muted,
    '--muted-foreground': mutedForeground,
    '--border': border,
    '--border-strong': borderStrong,
    '--control-border': borderStrong,
    '--primary': primary,
    '--primary-foreground': primaryForeground,
    '--accent': accent,
    '--accent-foreground': accentForeground,
    '--destructive': destructive,
    '--destructive-foreground': destructiveForeground,
    '--success-solid': successSolid,
    '--success-solid-foreground': successSolidForeground,
    '--ring': ring,
    '--brand': primary,
    '--brand-foreground': primaryForeground,
    '--brand-muted': brandMuted,
    '--link': link,
    '--sidebar-bg': sidebarBg,
    '--sidebar-bg-raised': sidebarRaised,
    '--sidebar-foreground': sidebarForeground,
    '--sidebar-foreground-muted': sidebarMuted,
    '--sidebar-border': hsl(sh, ss, light ? 24 : 20),
    '--sidebar-active-bg': sidebarActiveBg,
    '--sidebar-active-foreground': '#ffffff',
    '--sidebar-accent': sidebarAccent,
    '--status-good': st.good[0],
    '--status-good-bg': st.good[1],
    '--status-warning': st.warning[0],
    '--status-warning-bg': st.warning[1],
    '--status-serious': st.serious[0],
    '--status-serious-bg': st.serious[1],
    '--status-critical': st.critical[0],
    '--status-critical-bg': st.critical[1],
    '--status-neutral': st.neutral[0],
    '--status-neutral-bg': st.neutral[1],
    '--status-info': st.info[0],
    '--status-info-bg': st.info[1],
    '--chart-grid': border,
    '--chart-axis-text': mutedForeground,
    '--chart-axis-line': borderStrong,
    '--chart-tooltip-bg': raised,
    '--chart-tooltip-border': borderStrong,
    '--tactile-surface': surface,
    '--tactile-surface-raised': raised,
    '--tactile-highlight': light ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.06)',
    '--tactile-shadow-dark': light ? rgba(hsl(h, 0.25, 62), 0.55) : 'rgba(0, 0, 0, 0.65)',
    '--tactile-shadow-darker': light ? rgba(hsl(h, 0.25, 55), 0.45) : 'rgba(0, 0, 0, 0.8)',
  }

  check('Body text on background', foreground, background, 4.5)
  check('Muted text on surfaces', mutedForeground, fitWorst(mutedForeground, surfaces), 4.5)
  check('Primary button text', primaryForeground, primary, 4.5)
  check('Accent button text', accentForeground, accent, 4.5)
  check('Link text on surfaces', link, fitWorst(link, [...surfaces, brandMuted]), 4.5)
  check('Primary vs background', primary, fitWorst(primary, surfaces), 3)
  check('Focus ring vs surface', ring, fitWorst(ring, surfaces), 3)
  check('Control border vs surface', borderStrong, fitWorst(borderStrong, surfaces), 3)
  return { scheme: base, tokens, adjusted, checks, allPass: checks.every((c) => c.pass) }
}

/** The surface with the lowest contrast against `fg` (so a check reports the worst case). */
function fitWorst(fg: string, bgs: string[]): string {
  return bgs.reduce((w, b) => (contrast(fg, b) < contrast(fg, w) ? b : w))
}

/** Names of every token deriveTheme sets, for clearing inline overrides. */
export const DERIVED_TOKEN_NAMES: readonly string[] = Object.keys(
  deriveTheme({ base: 'light', primary: '#0047ab', accent: '#ffc93c', tint: 'neutral' }).tokens,
)

export const PRESET_INPUTS = {
  cobalt: { base: 'light', primary: '#0047ab', accent: '#ffc93c', tint: 'cool' },
  sage: { base: 'dark', primary: '#9caf88', accent: '#f28500', tint: 'charcoal' },
  indigo: { base: 'light', primary: '#4b3fb5', accent: '#2ec4b6', tint: 'lavender' },
} as const satisfies Record<string, ThemeInput>
