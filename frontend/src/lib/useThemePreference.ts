import { useSyncExternalStore } from 'react'

import { CUSTOM_CACHE_KEY, loadCustomState } from '@/lib/customThemes'
import { deriveTheme, DERIVED_TOKEN_NAMES, PRESET_INPUTS } from '@/lib/themeDerive'
import { isPreset, isThemeChoice, type ThemeChoice } from '@/lib/themes'

// One source of truth for the colour theme. The <html data-theme> attribute (plus,
// for Custom, inline custom properties) is the real state; this tiny
// module-level store lets every consumer read and write the same value.
//
// `useThemePreference` keeps its original contract (the resolved light/dark
// scheme, which charts and Mermaid need); `useThemeChoice` is the full choice
// (System, Light, Dark, a preset, Custom) used by the Appearance picker.

export type Theme = 'light' | 'dark'
export type { ThemeChoice }

// Also read by public/theme-init.js before first paint (a unit test keeps the two in sync).
export const STORAGE_KEY = 'qtesthub:theme'
const listeners = new Set<() => void>()

function prefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

function readStoredChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isThemeChoice(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

let choice: ThemeChoice | null = null
let scheme: Theme = 'light'

function clearInline(root: HTMLElement) {
  for (const name of DERIVED_TOKEN_NAMES) root.style.removeProperty(name)
  root.style.removeProperty('color-scheme')
}

/** Apply `next` to <html>. Returns the choice actually applied (Custom with no saved theme falls back to System). */
function apply(next: ThemeChoice): ThemeChoice {
  const root = document.documentElement
  clearInline(root)
  if (next === 'custom') {
    const state = loadCustomState()
    const active = state.themes.find((t) => t.id === state.activeId)
    if (active) {
      const d = deriveTheme(active)
      for (const [k, v] of Object.entries(d.tokens)) root.style.setProperty(k, v)
      root.style.setProperty('color-scheme', d.scheme)
      root.dataset.theme = 'custom'
      scheme = d.scheme
      try {
        localStorage.setItem(CUSTOM_CACHE_KEY, JSON.stringify({ v: 1, scheme: d.scheme, tokens: d.tokens }))
      } catch {
        // Blocked storage: still applied for this page view.
      }
      return 'custom'
    }
    next = 'system'
  }
  if (isPreset(next)) {
    root.dataset.theme = next
    scheme = PRESET_INPUTS[next].base
  } else {
    scheme = next === 'system' ? (prefersDark() ? 'dark' : 'light') : (next as Theme)
    root.dataset.theme = scheme
  }
  return next
}

function getChoice(): ThemeChoice {
  if (choice === null) choice = apply(readStoredChoice())
  return choice
}

function getScheme(): Theme {
  getChoice()
  return scheme
}

export function setThemeChoice(next: ThemeChoice) {
  choice = apply(next)
  try {
    if (choice === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, choice)
  } catch {
    // Private browsing / blocked storage -- still works for this page view.
  }
  listeners.forEach((l) => l())
}

/** Re-apply the current choice (after the active custom theme was edited). */
export function refreshTheme() {
  choice = apply(getChoice())
  listeners.forEach((l) => l())
}

export function setTheme(next: Theme) {
  setThemeChoice(next)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useThemePreference(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, getScheme, () => 'light' as Theme)
  return [theme, setTheme]
}

export function useThemeChoice(): [ThemeChoice, (next: ThemeChoice) => void] {
  const current = useSyncExternalStore(subscribe, getChoice, () => 'system' as ThemeChoice)
  return [current, setThemeChoice]
}
