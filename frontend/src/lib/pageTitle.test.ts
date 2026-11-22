import { describe, expect, it } from 'vitest'

import { getPageTitle } from '@/lib/pageTitle'

describe('page titles (ADR-114)', () => {
  it('titles the User Guide', () => {
    expect(getPageTitle('/user-guide')).toBe('User Guide')
  })

  it('no longer has a Documentation title in the tenant app', () => {
    expect(getPageTitle('/brd')).not.toBe('Documentation')
    expect(getPageTitle('/brd/user-guide')).not.toBe('Documentation')
  })
})
