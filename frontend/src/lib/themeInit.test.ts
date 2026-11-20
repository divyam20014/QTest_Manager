/// <reference types="node" />
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { STORAGE_KEY } from './useThemePreference'

// public/theme-init.js runs before first paint so public pages honour the saved
// light/dark choice. It must stay in step with the theme store.
const script = fs.readFileSync(path.resolve(import.meta.dirname, '../../public/theme-init.js'), 'utf8')

function run(stored: string | null, osDark: boolean) {
  localStorage.clear()
  if (stored !== null) localStorage.setItem(STORAGE_KEY, stored)
  vi.stubGlobal('matchMedia', () => ({ matches: osDark }))
  document.documentElement.removeAttribute('data-theme')
  new Function(script)()
  return document.documentElement.getAttribute('data-theme')
}

describe('theme-init.js', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('reads the same storage key as the theme store', () => {
    expect(script).toContain(`getItem('${STORAGE_KEY}')`)
  })

  it('the saved choice wins over the OS preference', () => {
    expect(run('dark', false)).toBe('dark')
    expect(run('light', true)).toBe('light')
  })

  it('follows the OS preference when nothing is saved', () => {
    expect(run(null, true)).toBe('dark')
    expect(run(null, false)).toBe('light')
  })

  it('ignores an unrecognised saved value', () => {
    expect(run('purple', true)).toBe('dark')
    expect(run('purple', false)).toBe('light')
  })

  it('falls back to the OS preference when storage is blocked', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    document.documentElement.removeAttribute('data-theme')
    new Function(script)()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    vi.restoreAllMocks()
  })
})
