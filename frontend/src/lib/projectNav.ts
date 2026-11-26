import { hasPermission, type MeResponse } from '@/api/auth'
import type { NavConfig } from '@/api/projects'
import { canAccessPath } from '@/lib/routeAccess'

/**
 * The project workspace tabs (ADR-122): the one definition of which tabs exist, which are
 * core, how they are labelled and where they go, plus the pure functions that turn a project's
 * saved `nav_config` into the tab strip. The key lists mirror `app/schemas/project.py`
 * (`CORE_NAV_KEYS`, `OPTIONAL_NAV_KEYS`); the API rejects anything outside them.
 */
export type ProjectTabKey =
  | 'overview'
  | 'tasks'
  | 'test-cases'
  | 'test-runs'
  | 'defects'
  | 'reports'
  | 'planning'
  | 'team'

export interface ProjectTabDef {
  key: ProjectTabKey
  label: string
  /** Core tabs can be reordered but never hidden. */
  core: boolean
  /** Whether the tab may be hidden in Settings. */
  hideable: boolean
  /** One line shown beside the tab in Project Settings. */
  description: string
  /** App-relative URL of the tab for a project. */
  to: (projectId: string) => string
}

export const PROJECT_TABS: readonly ProjectTabDef[] = [
  { key: 'overview', label: 'Overview', core: true, hideable: false, description: 'Health, trends and risk at a glance.', to: (id) => `/projects/${id}` },
  { key: 'tasks', label: 'Tasks', core: false, hideable: true, description: 'Tasks and sub-tasks that group requirements, test cases and defects.', to: (id) => `/projects/${id}/tasks` },
  { key: 'test-cases', label: 'Test Cases', core: true, hideable: false, description: 'The project test repository.', to: (id) => `/projects/${id}/test-cases` },
  { key: 'test-runs', label: 'Test Runs', core: true, hideable: false, description: 'Test execution cycles and results.', to: (id) => `/projects/${id}/test-runs` },
  { key: 'defects', label: 'Defects', core: true, hideable: false, description: 'Defects reported against the project.', to: (id) => `/defects?projectId=${id}` },
  { key: 'reports', label: 'Reports', core: true, hideable: false, description: 'Reports and release readiness.', to: (id) => `/reporting?project=${id}` },
  { key: 'planning', label: 'Planning', core: false, hideable: true, description: 'Test suites, test plans, releases and builds.', to: (id) => `/projects/${id}/test-plans` },
  { key: 'team', label: 'Team', core: false, hideable: true, description: 'Members and project roles.', to: (id) => `/projects/${id}/team` },
]

// ADR-131: pages of a project that are not tabs. Settings and Activity open from the project
// header; releases are a section of Planning.
export const projectSettingsPath = (projectId: string) => `/projects/${projectId}/settings`
export const projectActivityPath = (projectId: string) => `/projects/${projectId}/activity`
export const projectReleasesPath = (projectId: string) => `/projects/${projectId}/test-plans?section=releases`

/** Settings is only offered to people who can edit the project (the API enforces it). */
export const canEditProject = (user: MeResponse | null) => hasPermission(user, 'project.edit')

/** Share of a project's test cases that are approved, from the counts the project already
 * carries (nothing is estimated); null when there are no test cases yet. */
export function approvedProgress(project: { test_case_count: number; approved_test_case_count: number }): number | null {
  if (project.test_case_count <= 0) return null
  return Math.round((project.approved_test_case_count / project.test_case_count) * 100)
}

export const DEFAULT_TAB_ORDER: ProjectTabKey[] = PROJECT_TABS.map((t) => t.key)

const BY_KEY = new Map<string, ProjectTabDef>(PROJECT_TABS.map((t) => [t.key, t]))

export function tabDef(key: string): ProjectTabDef | undefined {
  return BY_KEY.get(key)
}

/**
 * The full tab order for a saved config: saved keys first (unknown ones dropped, repeats ignored),
 * then every tab the config does not mention in default order, so a tab added later still appears.
 */
export function fullOrder(config: NavConfig | null | undefined): ProjectTabKey[] {
  const seen = new Set<string>()
  const result: ProjectTabKey[] = []
  for (const key of config?.order ?? []) {
    if (BY_KEY.has(key) && !seen.has(key)) {
      seen.add(key)
      result.push(key as ProjectTabKey)
    }
  }
  for (const key of DEFAULT_TAB_ORDER) if (!seen.has(key)) result.push(key)
  return result
}

/** Hidden tabs of a saved config, restricted to tabs that may actually be hidden. */
export function hiddenTabs(config: NavConfig | null | undefined): Set<ProjectTabKey> {
  const hidden = new Set<ProjectTabKey>()
  for (const key of config?.hidden ?? []) {
    const def = BY_KEY.get(key)
    if (def?.hideable) hidden.add(def.key)
  }
  return hidden
}

/** Whether `config` is the same as the default (nothing reordered, nothing hidden). */
export function isDefaultConfig(order: readonly string[], hidden: readonly string[]): boolean {
  return hidden.length === 0 && order.every((key, i) => key === DEFAULT_TAB_ORDER[i])
}

/** A tab the signed-in user may be offered at all (before hiding): Reports follows the route
 * gate (a tenant can hide Reports from Testers). */
export function tabAllowed(key: ProjectTabKey, user: MeResponse | null): boolean {
  if (key === 'reports') return canAccessPath(user, '/reporting')
  return true
}

export interface ResolvedTab {
  key: ProjectTabKey
  label: string
  to: string
}

/** The tabs shown in the strip, in order: allowed for this user and not hidden. */
export function resolveProjectTabs(
  projectId: string,
  config: NavConfig | null | undefined,
  user: MeResponse | null,
): ResolvedTab[] {
  const hidden = hiddenTabs(config)
  return fullOrder(config)
    .filter((key) => tabAllowed(key, user) && !hidden.has(key))
    .map((key) => {
      const def = BY_KEY.get(key)!
      return { key, label: def.label, to: def.to(projectId) }
    })
}

/**
 * How much of the project header a page shows (ADR-133). A record's own page (or a form for one)
 * keeps the name and switcher only, so the record starts higher. On phones every page but the
 * Overview does the same; wider screens show the full header there.
 */
export function headerDensity(pathname: string): 'full' | 'phone-compact' | 'compact' {
  if (/^\/projects\/[^/]+\/(tasks|requirements|test-cases|test-runs|defects)\/[^/]+/.test(pathname)) return 'compact'
  return /^\/projects\/[^/]+\/?$/.test(pathname) ? 'full' : 'phone-compact'
}

/** Which tab a location belongs to, or null (for example a project sub-page that is not a tab). */
export function activeTabKey(pathname: string, search: string): ProjectTabKey | null {
  const clean = pathname.replace(/\/+$/, '') || '/'
  const params = new URLSearchParams(search)
  if (clean === '/defects') return params.get('projectId') ? 'defects' : null
  if (clean === '/reporting') return params.get('project') ? 'reports' : null
  const m = /^\/projects\/[^/]+(?:\/([^/]+))?/.exec(clean)
  if (!m) return null
  switch (m[1]) {
    case undefined:
      return 'overview'
    // ADR-128: requirements live in tasks, so a requirement page belongs to the Tasks tab; the
    // traceability matrix is a report.
    case 'requirements':
      return 'tasks'
    case 'traceability-matrix':
      return 'reports'
    case 'test-cases':
      return 'test-cases'
    case 'test-runs':
      return 'test-runs'
    case 'defects':
      return 'defects'
    case 'test-plans':
    case 'releases':
      return 'planning'
    case 'tasks':
    case 'team':
      return m[1]
    default:
      return null
  }
}

/**
 * Where the project switcher goes: the same tab in the target project when that tab is
 * available there (allowed for this user and not hidden by the target's own config), else the
 * target's Overview. Tabs without a tab key land on Overview too.
 */
export function switchTarget(
  currentKey: ProjectTabKey | null,
  target: { id: string; nav_config?: NavConfig | null },
  user: MeResponse | null,
  tenantDefault?: NavConfig | null,
): string {
  // A project without its own configuration follows the tenant default (ADR-125).
  const tabs = resolveProjectTabs(target.id, target.nav_config ?? tenantDefault, user)
  const match = currentKey ? tabs.find((t) => t.key === currentKey) : undefined
  return (match ?? tabs.find((t) => t.key === 'overview'))?.to ?? `/projects/${target.id}`
}
