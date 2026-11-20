import { useSyncExternalStore } from 'react'

// Mobile redesign Phase 2: one source of truth for the light/dark choice.
// Phase 1 left each <ThemeToggle> with its own useState, so the desktop header
// toggle and the More-sheet toggle could disagree after a resize. A tiny
// module-level store (the <html data-theme> attribute is the real state) lets
// every toggle read and write the same value.

export type Theme = 'light' | 'dark'

// Also read by public/theme-init.js before first paint (a unit test keeps the two in sync).
export const STORAGE_KEY = 'qtesthub:theme'
const listeners = new Set<() => void>()

function prefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

function readStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : null
  } catch {
    return null
  }
}

let current: Theme | null = null

function getTheme(): Theme {
  if (current === null) {
    current = readStoredTheme() ?? (prefersDark() ? 'dark' : 'light')
    document.documentElement.dataset.theme = current
  }
  return current
}

export function setTheme(next: Theme) {
  current = next
  document.documentElement.dataset.theme = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Private browsing / blocked storage -- still works for this page view.
  }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useThemePreference(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, getTheme, () => 'light' as Theme)
  return [theme, setTheme]
}
