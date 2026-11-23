// Pure breadcrumb derivation for the top bar (components/Breadcrumbs.tsx).

// Maps a static path segment to a readable label. Dynamic segments (ids) are
// labelled by the kind of record the preceding segment names (ID_LABELS)
// unless the caller resolved a real name for them.
export const SEGMENT_LABELS: Record<string, string> = {
  projects: 'Projects',
  requirements: 'Requirements',
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
  account: 'My Account',
  'user-guide': 'User Guide',
  dashboards: 'Manage',
  details: 'Details',
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
      return { path, label, link: hasPage, current: false }
    })
    .filter((_, index) => !(onDash && index === 0))
  if (projectId && segments.length === 2) {
    rest.push({ path: pathname + '#dashboard', label: 'Dashboard', link: false, current: false })
  }
  const crumbs: Crumb[] = [{ path: '/', label: 'Dashboard', link: true, current: false }, ...rest]
  const last = crumbs.length - 1
  return crumbs.map((c, i) => (i === last ? { ...c, link: false, current: true } : c))
}
