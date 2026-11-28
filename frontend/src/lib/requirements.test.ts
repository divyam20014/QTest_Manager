import { describe, expect, it } from 'vitest'

import { approvalWillBeLost, requirementChanges, type RequirementForm } from '@/lib/requirements'

const saved: RequirementForm = {
  title: 'Claims are validated',
  description: 'Within two days',
  requirement_type: 'Functional',
  priority: 'Medium',
  status: 'approved',
  owner_id: 'u1',
  acceptance_criteria: ['Logged'],
}

describe('requirementChanges', () => {
  it('sends only what changed', () => {
    expect(requirementChanges(saved, saved)).toEqual({})
    expect(requirementChanges(saved, { ...saved, priority: 'High' })).toEqual({ priority: 'High' })
  })

  it('sends null to remove the owner', () => {
    expect(requirementChanges(saved, { ...saved, owner_id: '' })).toEqual({ owner_id: null })
  })
})

describe('acceptance criteria', () => {
  it('ignores empty rows and stray spaces', () => {
    expect(requirementChanges(saved, { ...saved, acceptance_criteria: ['  Logged ', '  '] })).toEqual({})
  })

  it('counts a changed list as new wording', () => {
    const values = { ...saved, acceptance_criteria: ['Logged', 'Answered'] }
    expect(requirementChanges(saved, values)).toEqual({ acceptance_criteria: ['Logged', 'Answered'] })
    expect(approvalWillBeLost(saved, values)).toBe(true)
  })
})

describe('approvalWillBeLost', () => {
  it('warns about new wording on an approved requirement only', () => {
    expect(approvalWillBeLost(saved, { ...saved, description: 'Within one day' })).toBe(true)
    expect(approvalWillBeLost(saved, { ...saved, priority: 'High' })).toBe(false)
    expect(approvalWillBeLost({ ...saved, status: 'draft' }, { ...saved, status: 'draft', title: 'New words' })).toBe(false)
  })

  it('says nothing when the requirement is being retired', () => {
    expect(approvalWillBeLost(saved, { ...saved, title: 'New words', status: 'retired' })).toBe(false)
  })
})
