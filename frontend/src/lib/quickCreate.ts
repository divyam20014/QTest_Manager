import { hasPermission, isManagerOrAbove, type MeResponse } from '@/api/auth'
import { defectNewPath } from '@/lib/entityRoutes'

export type QuickCreateKind = 'test-case' | 'test-run' | 'defect' | 'project' | 'requirement'

export interface QuickCreateAction {
  kind: QuickCreateKind
  /** Menu label in the top bar's "+ New" menu. */
  label: string
  /** Label used by the command palette's "Quick actions". */
  paletteLabel: string
  path: string
}

/** Project id from a `/projects/:id/...` path, else undefined. */
export function projectIdFromPath(pathname: string): string | undefined {
  const m = /^\/projects\/([0-9a-f-]{8,})(?:\/|$)/i.exec(pathname)
  return m ? m[1] : undefined
}

/**
 * The one list of "create something" shortcuts, shared by the top bar's "+ New"
 * menu and the command palette. Each target is an existing list page that opens
 * its own create dialog on `?action=create`. Permissions mirror what those pages
 * themselves require, so nothing is offered that the page would then hide.
 * Test runs and requirements are created inside a project, so they are only
 * offered when a project is open (`projectId`).
 */
export function getQuickCreateActions(user: MeResponse | null, projectId?: string): QuickCreateAction[] {
  if (!user) return []
  const out: QuickCreateAction[] = []
  if (hasPermission(user, 'testcase.create')) {
    out.push({
      kind: 'test-case',
      label: 'New test case',
      paletteLabel: 'Create Test Case',
      path: projectId ? `/test-repository?projectId=${projectId}&action=create` : '/test-repository?action=create',
    })
  }
  if (projectId && hasPermission(user, 'testrun.create')) {
    out.push({
      kind: 'test-run',
      label: 'New test run',
      paletteLabel: 'Create Test Run',
      path: `/projects/${projectId}/test-runs?action=create`,
    })
  }
  out.push({
    kind: 'defect',
    label: 'New defect',
    paletteLabel: 'Create Defect',
    path: projectId ? defectNewPath(projectId) : '/defects/new',
  })
  if (isManagerOrAbove(user)) {
    out.push({ kind: 'project', label: 'New project', paletteLabel: 'Create Project', path: '/projects?action=create' })
    if (projectId) {
      out.push({
        kind: 'requirement',
        label: 'New requirement',
        paletteLabel: 'Create Requirement',
        path: `/projects/${projectId}/requirements?action=create`,
      })
    }
  }
  return out
}
