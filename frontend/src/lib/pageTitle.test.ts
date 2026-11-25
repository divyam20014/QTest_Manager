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

describe('record page titles inside a project (ADR-127)', () => {
  const P = '3f2a9c1e-1111-4222-8333-444455556666'
  const ID = '9a8b7c6d-1111-4222-8333-444455556666'

  it('titles detail, edit and new pages', () => {
    expect(getPageTitle(`/projects/${P}/requirements/${ID}`)).toBe('Requirement Detail')
    expect(getPageTitle(`/projects/${P}/test-cases/${ID}`)).toBe('Test Case Detail')
    expect(getPageTitle(`/projects/${P}/test-cases/${ID}/edit`)).toBe('Edit Test Case')
    expect(getPageTitle(`/projects/${P}/test-cases/new`)).toBe('New Test Case')
    expect(getPageTitle(`/projects/${P}/test-runs/${ID}`)).toBe('Test Run Detail')
    expect(getPageTitle(`/projects/${P}/defects/${ID}`)).toBe('Defect Detail')
    expect(getPageTitle(`/projects/${P}/defects/${ID}/edit`)).toBe('Edit Defect')
    expect(getPageTitle(`/projects/${P}/defects/new`)).toBe('New Defect')
    expect(getPageTitle(`/projects/${P}/tasks/${ID}`)).toBe('Task Detail')
    expect(getPageTitle(`/projects/${P}/tasks`)).toBe('Project Tasks')
  })
})
