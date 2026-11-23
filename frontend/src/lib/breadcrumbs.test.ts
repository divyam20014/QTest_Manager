import { describe, expect, it } from 'vitest'

import { buildCrumbs } from './breadcrumbs'

const PID = '3f2a9c1e-1111-4222-8333-444455556666'

describe('buildCrumbs', () => {
  it('shows nothing on the dashboard and on top-level pages', () => {
    expect(buildCrumbs('/')).toEqual([])
    expect(buildCrumbs('/defects')).toEqual([])
    expect(buildCrumbs('/test-repository')).toEqual([])
    expect(buildCrumbs('/dashboards').map((c) => c.label)).toEqual(['Dashboard', 'Manage'])
  })

  it('builds Dashboard > Projects > <project> > Test Cases with the current page last', () => {
    const crumbs = buildCrumbs(`/projects/${PID}/test-cases`, { project: 'Apollo' })
    expect(crumbs.map((c) => c.label)).toEqual(['Dashboard', 'Projects', 'Apollo', 'Test Cases'])
    expect(crumbs.map((c) => c.link)).toEqual([true, true, true, false])
    expect(crumbs.filter((c) => c.current).map((c) => c.label)).toEqual(['Test Cases'])
    expect(crumbs[0].path).toBe('/')
    expect(crumbs[2].path).toBe(`/projects/${PID}`)
  })

  it('falls back to a generic label until the project name has loaded', () => {
    expect(buildCrumbs(`/projects/${PID}/defects`).map((c) => c.label)).toContain('Project')
  })

  it('adds a current "Overview" crumb on a bare project page', () => {
    const crumbs = buildCrumbs(`/projects/${PID}`, { project: 'Apollo' })
    expect(crumbs.map((c) => c.label)).toEqual(['Dashboard', 'Projects', 'Apollo', 'Overview'])
    expect(crumbs[3].current).toBe(true)
  })

  it('labels the project workspace tabs with their tab names', () => {
    for (const [segment, label] of [
      ['test-plans', 'Planning'],
      ['releases', 'Releases'],
      ['team', 'Team'],
      ['activity', 'Activity'],
      ['settings', 'Settings'],
    ]) {
      const crumbs = buildCrumbs(`/projects/${PID}/${segment}`, { project: 'Apollo' })
      expect(crumbs.map((c) => c.label)).toEqual(['Dashboard', 'Projects', 'Apollo', label])
    }
  })

  it('keeps the project in the trail for Defects and Reports opened from a project tab', () => {
    const defects = buildCrumbs('/defects', { project: 'Apollo', search: `?projectId=${PID}` })
    expect(defects.map((c) => c.label)).toEqual(['Dashboard', 'Projects', 'Apollo', 'Defects'])
    expect(defects[2].path).toBe(`/projects/${PID}`)
    expect(defects[3].current).toBe(true)
    const reports = buildCrumbs('/reporting', { project: 'Apollo', search: `?project=${PID}` })
    expect(reports.map((c) => c.label)).toEqual(['Dashboard', 'Projects', 'Apollo', 'Reports'])
    // Without a project the pages stay top level.
    expect(buildCrumbs('/defects', { search: '?status=open' })).toEqual([])
  })

  it('does not link prefix-only segments that have no list page', () => {
    const crumbs = buildCrumbs(`/test-cases/${PID}`)
    expect(crumbs.map((c) => c.label)).toEqual(['Dashboard', 'Test Cases', 'Test Case'])
    expect(crumbs[1].link).toBe(false)
  })

  it('uses Test Cases, never the old Test Repository label', () => {
    const labels = buildCrumbs('/test-repository/anything').map((c) => c.label)
    expect(labels).toContain('Test Cases')
    expect(labels.join(' ')).not.toMatch(/Repository/)
  })

  it('resolves admin sub-pages and drops the /dashboards prefix', () => {
    expect(buildCrumbs('/admin/audit-logs').map((c) => c.label)).toEqual(['Dashboard', 'Admin', 'Audit Logs'])
    expect(buildCrumbs('/settings').map((c) => c.label)).toEqual(['Dashboard', 'Admin', 'Settings'])
    expect(buildCrumbs(`/dashboards/${PID}`, { dashboardName: 'Exec' }).map((c) => c.label)).toEqual([
      'Dashboard',
      'Exec',
    ])
  })
})
