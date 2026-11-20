import { useCallback, useState } from 'react'

// Issue 45 (ADR-094): opt-in dark "cockpit" mode for the Execution Console.
// Independent of the app light/dark theme; remembered per browser. Storage is
// optional: a blocked or throwing localStorage just means "off, not remembered".

export const COCKPIT_STORAGE_KEY = 'qtesthub:cockpit'

export function readCockpitPreference(): boolean {
  try {
    return localStorage.getItem(COCKPIT_STORAGE_KEY) === 'on'
  } catch {
    return false
  }
}

export function writeCockpitPreference(on: boolean): void {
  try {
    if (on) localStorage.setItem(COCKPIT_STORAGE_KEY, 'on')
    else localStorage.removeItem(COCKPIT_STORAGE_KEY)
  } catch {
    // Private window / blocked storage: the toggle still works for this page view.
  }
}

export function useCockpitMode(): [boolean, (next: boolean) => void] {
  const [on, setOn] = useState<boolean>(readCockpitPreference)
  const set = useCallback((next: boolean) => {
    setOn(next)
    writeCockpitPreference(next)
  }, [])
  return [on, set]
}
