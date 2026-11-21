import { describe, expect, it } from 'vitest'

import { INITIAL_SCROLL_STATE, nextScrollState } from './scrollDirection'

describe('nextScrollState', () => {
  it('stays visible for small downward scrolls', () => {
    let s = INITIAL_SCROLL_STATE
    for (const y of [10, 30, 48]) s = nextScrollState(s, y)
    expect(s.hidden).toBe(false)
  })
  it('hides after scrolling down more than 48px in one run', () => {
    let s = INITIAL_SCROLL_STATE
    for (const y of [20, 40, 60, 80]) s = nextScrollState(s, y)
    expect(s.hidden).toBe(true)
  })
  it('reappears on scroll up and measures the next run from the reversal', () => {
    let s = INITIAL_SCROLL_STATE
    for (const y of [100, 160]) s = nextScrollState(s, y)
    expect(s.hidden).toBe(true)
    s = nextScrollState(s, 150)
    expect(s.hidden).toBe(false)
    s = nextScrollState(s, 180) // only 30px since the reversal
    expect(s.hidden).toBe(false)
    s = nextScrollState(s, 210)
    expect(s.hidden).toBe(true)
  })
  it('shows at the top and ignores negative overscroll', () => {
    let s = nextScrollState(nextScrollState(INITIAL_SCROLL_STATE, 100), 200)
    expect(s.hidden).toBe(true)
    s = nextScrollState(s, -5)
    expect(s.hidden).toBe(false)
  })
})
