import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'

import { OLD_SAVED_FILTERS_KEY, copySavedFilters } from './copySavedFilters'

const createSavedView = vi.fn()
vi.mock('@/api/savedViews', () => ({ createSavedView: (body: unknown) => createSavedView(body) }))

const OLD = {
  'My drafts': { search: '', status: 'draft', priority: '', projectId: '', showDeprecated: 'false', assignee: 'me' },
  'Old and new': { search: 'payout', status: '', priority: 'High', projectId: '', showDeprecated: 'true', assignee: '' },
}

beforeEach(() => {
  localStorage.clear()
  createSavedView.mockReset()
  createSavedView.mockResolvedValue({})
})

describe('copySavedFilters', () => {
  it('does nothing when the browser has no saved filters', async () => {
    expect(await copySavedFilters('u1')).toBe(0)
    expect(createSavedView).not.toHaveBeenCalled()
  })

  it('copies each one with only the filters that were set, and keeps the originals', async () => {
    const raw = JSON.stringify(OLD)
    localStorage.setItem(OLD_SAVED_FILTERS_KEY, raw)
    expect(await copySavedFilters('u1')).toBe(2)
    expect(createSavedView.mock.calls.map((c) => c[0])).toEqual([
      { list_key: 'test_repository', name: 'My drafts', filters: { status: 'draft', assignee: 'me' }, sort: null },
      {
        list_key: 'test_repository',
        name: 'Old and new',
        filters: { search: 'payout', priority: 'High', showDeprecated: 'true' },
        sort: null,
      },
    ])
    expect(localStorage.getItem(OLD_SAVED_FILTERS_KEY)).toBe(raw)
  })

  it('copies once per user: a later visit does not bring back a deleted view', async () => {
    localStorage.setItem(OLD_SAVED_FILTERS_KEY, JSON.stringify(OLD))
    await copySavedFilters('u1')
    createSavedView.mockClear()
    expect(await copySavedFilters('u1')).toBe(0)
    expect(createSavedView).not.toHaveBeenCalled()
    // Someone else on the same browser gets their own copy.
    expect(await copySavedFilters('u2')).toBe(2)
  })

  it('retries only what failed, and treats an existing name as done', async () => {
    localStorage.setItem(OLD_SAVED_FILTERS_KEY, JSON.stringify(OLD))
    createSavedView
      .mockRejectedValueOnce(new ApiError('You already have a view with this name', 'conflict', 409))
      .mockRejectedValueOnce(new Error('offline'))
    expect(await copySavedFilters('u1')).toBe(0)
    createSavedView.mockClear()
    createSavedView.mockResolvedValue({})
    expect(await copySavedFilters('u1')).toBe(1)
    expect(createSavedView.mock.calls.map((c) => (c[0] as { name: string }).name)).toEqual(['Old and new'])
  })

  it('ignores broken stored data', async () => {
    localStorage.setItem(OLD_SAVED_FILTERS_KEY, '{not json')
    expect(await copySavedFilters('u1')).toBe(0)
  })
})
