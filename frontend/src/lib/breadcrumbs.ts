// Pure breadcrumb derivation for the top bar (components/Breadcrumbs.tsx).

// Maps a static path segment to a readable label. Dynamic segments (ids) are
// labelled by the kind of record the preceding segment names (ID_LABELS)
// unless the caller resolved a real name for them.
export const SEGMENT_LABELS: Record<string, string> = {
  projects: 'Projects',
  'my-work': 'My Work',
  requirements: 'Requirements',
  tasks: 'Tasks',
  'task-statuses': 'Task Statuses',
  'test-cases': 'Test Cases',
  'test-repository': 'Test Cases',
  'test-runs': 'Test Runs',
  'test-run-cases': 'Execution Console',
  execution: 'Execution Console',
  defects: 'Defects',
  reporting: 'Reporting',
  'traceability-matrix': 'Traceability Matrix',
  admin: 'Admin',
  users: 'Users & Roles',
  roles: 'Roles & Permissions',
  environments: 'Environments',
  'access-rules': 'Access Rules',
  'audit-logs': 'Audit Logs',
  settings: 'Settings',
  workspace: 'Workspace',
  account: 'My Account',
  'user-guide': 'User Guide',
  dashboards: 'Manage',
  'test-plans': 'Planning',
  releases: 'Releases',
  team: 'Team',
  activity: 'Activity',
  new: 'New',
  edit: 'Edit',
}

const ID_LABELS: Record<string, string> = {
  projects: 'Project',
  requirements: 'Requirement',
  'test-cases': 'Test Case',
  'test-runs': 'Test Run',
  'test-run-cases': 'Test Case',
  defects: 'Defect',
  tasks: 'Task',
}

// Top-level segments that only exist as a prefix for a detail route
// (/test-cases/:id): there is no list page at that path, so the crumb is plain
// text rather than a link to a 404.
const NO_LIST_PAGE = new Set(['test-cases', 'requirements', 'test-run-cases'])

export function isIdSegment(segment: string): boolean {
  return /^[0-9a-f-]{8,}$/i.test(segment)
}

export interface Crumb {
  path: string
  label: string
  /** False for the current page and for prefix-only segments with no page. */
  link: boolean
  current: boolean
}

export interface CrumbNames {
  project?: string
  dashboardName?: string
  /** Query string of the location (`?projectId=` on Defects, `?project=` on Reports). */
  search?: string
}

/** The project a top-level page is scoped to by its query string (Defects, Reports tabs). */
export function scopedProjectId(pathname: string, search = ''): string | undefined {
  const params = new URLSearchParams(search)
  const id = pathname === '/defects' ? params.get('projectId') : pathname === '/reporting' ? params.get('project') : null
  return id && isIdSegment(id) ? id : undefined
}

/**
 * The trail for `pathname`, starting with the Dashboard root. Returns [] for
 * top-level pages (a single section, or the dashboard itself): the page's own
 * title already says where you are, so a one-crumb trail would only repeat it.
 */
export function buildCrumbs(pathname: string, names: CrumbNames = {}): Crumb[] {
  const segments = pathname.split('/').filter(Boolean)
  // /dashboards (Manage) is a child of the Dashboard home, so it keeps its trail.
  // /settings is a section of the Admin area (ADR-112): Admin > Settings.
  if (segments.length === 1 && segments[0] === 'settings') {
    return [
      { path: '/', label: 'Dashboard', link: true, current: false },
      { path: '/admin', label: 'Admin', link: true, current: false },
      { path: '/settings', label: 'Settings', link: false, current: true },
    ]
  }
  // ADR-122: Defects and Reports opened from a project's tab keep the project in the trail.
  const scoped = scopedProjectId(pathname, names.search)
  if (scoped) {
    return [
      { path: '/', label: 'Dashboard', link: true, current: false },
      { path: '/projects', label: 'Projects', link: true, current: false },
      { path: `/projects/${scoped}`, label: names.project ?? 'Project', link: true, current: false },
      { path: pathname, label: SEGMENT_LABELS[segments[0]] === 'Reporting' ? 'Reports' : SEGMENT_LABELS[segments[0]], link: false, current: true },
    ]
  }
  if (segments.length <= 1 && segments[0] !== 'dashboards') return []
  const onDash = segments[0] === 'dashboards' && segments.length > 1
  const projectId = segments[0] === 'projects' && isIdSegment(segments[1] ?? '') ? segments[1] : undefined

  const rest: Crumb[] = segments
    .map((segment, index) => {
      const path = '/' + segments.slice(0, index + 1).join('/')
      const label =
        (projectId && index === 1 ? names.project : undefined) ??
        (onDash && index === 1 ? names.dashboardName : undefined) ??
        (isIdSegment(segment) ? (ID_LABELS[segments[index - 1]] ?? 'Detail') : (SEGMENT_LABELS[segment] ?? segment))
      const hasPage = !(index === 0 && NO_LIST_PAGE.has(segments[0]))
      // ADR-128: requirements live in tasks; there is no Requirements list to link to.
      if (projectId && index === 2 && segment === 'requirements') {
        return { path: `/projects/${projectId}/tasks`, label: 'Tasks', link: true, current: false }
      }
      // The project's Defects tab is the project-filtered list at /defects.
      if (projectId && index === 2 && segment === 'defects') {
        return { path: `/defects?projectId=${projectId}`, label, link: true, current: false }
      }
      return { path, label, link: hasPage, current: false }
    })
    .filter((_, index) => !(onDash && index === 0))
  if (projectId && segments.length === 2) {
    rest.push({ path: pathname + '#dashboard', label: 'Overview', link: false, current: false })
  }
  const crumbs: Crumb[] = [{ path: '/', label: 'Dashboard', link: true, current: false }, ...rest]
  const last = crumbs.length - 1
  return crumbs.map((c, i) => (i === last ? { ...c, link: false, current: true } : c))
}
