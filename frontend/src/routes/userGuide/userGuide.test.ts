import { describe, expect, it } from 'vitest'

import { defaultSectionId, sectionFromHash } from '@/routes/userGuide/sections'

const ids = (...xs: string[]) => xs.map((id) => ({ id }))

describe('user guide section selection (ADR-114)', () => {
  it('opens the section that matches the role', () => {
    const all = ids('getting-started', 'tester', 'manager', 'admin')
    expect(defaultSectionId(all, 'admin')).toBe('admin')
    expect(defaultSectionId(all, 'manager')).toBe('manager')
    expect(defaultSectionId(all, 'tester')).toBe('tester')
  })

  it('falls back to the first section the user was sent', () => {
    expect(defaultSectionId(ids('getting-started'), 'admin')).toBe('getting-started')
    expect(defaultSectionId([], 'tester')).toBeUndefined()
  })

  it('honours a deep link only when the section was returned for this user', () => {
    const tester = ids('getting-started', 'tester')
    expect(sectionFromHash(tester, '#tester')).toBe('tester')
    expect(sectionFromHash(tester, '#admin')).toBeUndefined()
    expect(sectionFromHash(tester, '')).toBeUndefined()
  })
})
