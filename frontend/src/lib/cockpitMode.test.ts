import { afterEach, describe, expect, it, vi } from 'vitest'

import { COCKPIT_STORAGE_KEY, readCockpitPreference, writeCockpitPreference } from './cockpitMode'

describe('cockpit mode preference', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('defaults to off', () => {
    expect(readCockpitPreference()).toBe(false)
  })

  it('round-trips on and off', () => {
    writeCockpitPreference(true)
    expect(localStorage.getItem(COCKPIT_STORAGE_KEY)).toBe('on')
    expect(readCockpitPreference()).toBe(true)
    writeCockpitPreference(false)
    expect(localStorage.getItem(COCKPIT_STORAGE_KEY)).toBeNull()
    expect(readCockpitPreference()).toBe(false)
  })

  it('treats unknown stored values as off', () => {
    localStorage.setItem(COCKPIT_STORAGE_KEY, 'maybe')
    expect(readCockpitPreference()).toBe(false)
  })

  it('works without storage (read and write throw)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readCockpitPreference()).toBe(false)
    expect(() => writeCockpitPreference(true)).not.toThrow()
  })
})
