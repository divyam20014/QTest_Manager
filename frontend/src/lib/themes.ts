import { deriveTheme, PRESET_INPUTS, type ThemeInput } from '@/lib/themeDerive'

// The list of colour themes offered in Appearance. Swatches are the three dots
// shown in the picker: surface, primary, accent. They live here (not in a
// component) because they are a preview of tokens, not styling.

export type ThemeChoice = 'system' | 'light' | 'dark' | 'cobalt' | 'sage' | 'indigo' | 'custom'
export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark', 'cobalt', 'sage', 'indigo', 'custom']

export function isThemeChoice(v: unknown): v is ThemeChoice {
  return typeof v === 'string' && (THEME_CHOICES as readonly string[]).includes(v)
}

export type PresetId = keyof typeof PRESET_INPUTS
export function isPreset(v: unknown): v is PresetId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PRESET_INPUTS, v)
}

export const THEME_LABELS: Record<ThemeChoice, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
  cobalt: 'Cobalt & Sunshine',
  sage: 'Sage & Tangerine',
  indigo: 'Indigo & Aqua',
  custom: 'Custom',
}

export function swatchFor(input: ThemeInput): [string, string, string] {
  const t = deriveTheme(input).tokens
  return [t['--tactile-surface-raised'], t['--primary'], t['--accent']]
}

export const BASE_SWATCHES: Record<'system' | 'light' | 'dark', [string, string, string]> = {
  system: ['#ffffff', '#0a0a0a', '#2a78d6'],
  light: ['#ffffff', '#111827', '#2a78d6'],
  dark: ['#0a0a0a', '#f4f4f5', '#5b9dee'],
}

/** Twelve ready-made colours for the custom palette picker. */
export const PALETTE_SWATCHES: readonly string[] = [
  '#0047ab', '#2563eb', '#0891b2', '#0d9488', '#16a34a', '#9caf88',
  '#ca8a04', '#f28500', '#dc2626', '#db2777', '#7c3aed', '#4b3fb5',
]
