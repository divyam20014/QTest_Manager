import { HEX6, TINTS, type Base, type Tint } from '@/lib/themeDerive'

// Custom themes live in this browser only (localStorage), never in the account.
// Everything read back is validated strictly: hex colours, bounded lengths,
// known enums; invalid entries are dropped, never repaired.

export const CUSTOM_KEY = 'qtesthub:custom-themes'
export const CUSTOM_CACHE_KEY = 'qtesthub:theme-custom' // computed tokens, read by public/theme-init.js
export const MAX_CUSTOM_THEMES = 3
export const MAX_NAME = 24

export interface CustomTheme {
  id: string
  name: string
  base: Base
  primary: string
  accent: string
  tint: Tint
}
export interface CustomState {
  themes: CustomTheme[]
  activeId: string | null
}

export const DEFAULT_CUSTOM: Omit<CustomTheme, 'id' | 'name'> = {
  base: 'light',
  primary: '#2563eb',
  accent: '#f59e0b',
  tint: 'neutral',
}

export function cleanName(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, MAX_NAME)
}

export function parseCustomTheme(value: unknown): CustomTheme | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.id !== 'string' || !/^[a-z0-9]{1,12}$/.test(v.id)) return null
  if (typeof v.name !== 'string') return null
  const name = cleanName(v.name)
  if (name.length === 0 || name !== v.name) return null
  if (v.base !== 'light' && v.base !== 'dark') return null
  if (typeof v.primary !== 'string' || !HEX6.test(v.primary)) return null
  if (typeof v.accent !== 'string' || !HEX6.test(v.accent)) return null
  if (typeof v.tint !== 'string' || !TINTS.includes(v.tint as Tint)) return null
  return { id: v.id, name, base: v.base, primary: v.primary, accent: v.accent, tint: v.tint as Tint }
}

export function parseCustomState(raw: string | null): CustomState {
  const empty: CustomState = { themes: [], activeId: null }
  if (!raw || raw.length > 8000) return empty
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return empty
  }
  if (!data || typeof data !== 'object') return empty
  const d = data as Record<string, unknown>
  if (d.v !== 1 || !Array.isArray(d.themes)) return empty
  const seen = new Set<string>()
  const themes: CustomTheme[] = []
  for (const item of d.themes) {
    const t = parseCustomTheme(item)
    if (t && !seen.has(t.id) && themes.length < MAX_CUSTOM_THEMES) {
      seen.add(t.id)
      themes.push(t)
    }
  }
  const activeId = typeof d.activeId === 'string' && seen.has(d.activeId) ? d.activeId : (themes[0]?.id ?? null)
  return { themes, activeId }
}

export function loadCustomState(): CustomState {
  try {
    return parseCustomState(localStorage.getItem(CUSTOM_KEY))
  } catch {
    return { themes: [], activeId: null }
  }
}

export function saveCustomState(state: CustomState): void {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify({ v: 1, ...state }))
  } catch {
    // Blocked storage: the theme still applies for this page view.
  }
}

export function newThemeId(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(4, '0')
}

/** Selecting Custom for the first time seeds one editable theme so there is always something to apply. */
export function ensureCustomTheme(): void {
  const state = loadCustomState()
  if (state.themes.length > 0) return
  const theme: CustomTheme = { id: newThemeId(), name: 'My theme', ...DEFAULT_CUSTOM }
  saveCustomState({ themes: [theme], activeId: theme.id })
}
