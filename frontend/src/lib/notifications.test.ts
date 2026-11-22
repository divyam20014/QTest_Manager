import { describe, expect, it } from 'vitest'

import { navBadgeLabel, navBadgeText, openDefectCount } from './navBadges'
import { bellBadgeText, bellLabel, notificationHref, timeAgo } from './notifications'

describe('notification unread state', () => {
  it('hides the dot at zero and caps at 9+', () => {
    expect(bellBadgeText(0)).toBeNull()
    expect(bellBadgeText(-3)).toBeNull()
    expect(bellBadgeText(4)).toBe('4')
    expect(bellBadgeText(12)).toBe('9+')
  })

  it('announces the unread count in the bell name', () => {
    expect(bellLabel(0)).toBe('Notifications')
    expect(bellLabel(3)).toBe('Notifications, 3 unread')
  })

  it('links only entities that have a page', () => {
    expect(notificationHref({ entity_type: 'defect', entity_id: 'd1' })).toBe('/defects/d1')
    expect(notificationHref({ entity_type: 'test_case', entity_id: 'c1' })).toBe('/test-cases/c1')
    expect(notificationHref({ entity_type: 'execution_step', entity_id: 's1' })).toBeNull()
  })

  it('formats relative time', () => {
    const now = Date.parse('2026-01-01T12:00:00Z')
    expect(timeAgo('2026-01-01T11:59:50Z', now)).toBe('just now')
    expect(timeAgo('2026-01-01T11:55:00Z', now)).toBe('5m ago')
    expect(timeAgo('2026-01-01T09:00:00Z', now)).toBe('3h ago')
    expect(timeAgo('2025-12-30T12:00:00Z', now)).toBe('2d ago')
    expect(timeAgo('nope', now)).toBe('')
  })
})

describe('nav count badges', () => {
  it('counts everything not Closed as open', () => {
    expect(openDefectCount(undefined)).toBe(0)
    expect(openDefectCount({ counts: { New: 2, Open: 1, Closed: 5 }, total: 8 })).toBe(3)
  })

  it('hides at 0, caps at 99+, and names the count for screen readers', () => {
    expect(navBadgeText(0)).toBeNull()
    expect(navBadgeText(7)).toBe('7')
    expect(navBadgeText(100)).toBe('99+')
    expect(navBadgeLabel('Defects', 0)).toBe('Defects')
    expect(navBadgeLabel('Defects', 12)).toBe('Defects, 12 open')
  })
})
