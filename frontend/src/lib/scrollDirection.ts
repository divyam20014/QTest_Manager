// Pure scroll-direction state for the phone tab bar's hide-on-scroll (ADR-104).
// Hide after scrolling DOWN more than `threshold` px within one downward run;
// show again on any upward scroll or when back at the top.
export interface ScrollState {
  lastY: number
  /** scrollY where the current direction run started. */
  anchorY: number
  dir: 'up' | 'down' | null
  hidden: boolean
}

export const INITIAL_SCROLL_STATE: ScrollState = { lastY: 0, anchorY: 0, dir: null, hidden: false }

export function nextScrollState(prev: ScrollState, y: number, threshold = 48): ScrollState {
  // Rubber-banding can report negative offsets.
  const pos = Math.max(0, y)
  if (pos <= 0) return { lastY: 0, anchorY: 0, dir: null, hidden: false }
  if (pos === prev.lastY) return prev
  const dir = pos > prev.lastY ? 'down' : 'up'
  const anchorY = dir === prev.dir ? prev.anchorY : prev.lastY
  if (dir === 'up') return { lastY: pos, anchorY, dir, hidden: false }
  return { lastY: pos, anchorY, dir, hidden: prev.hidden || pos - anchorY > threshold }
}
