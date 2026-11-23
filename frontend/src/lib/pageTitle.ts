// Every tab showed the bare Vite default "frontend" before this -- a
// single route -> title map (used by both the browser tab title and the
// breadcrumb trail's own labels) rather than a per-page hook duplicated
// across ~25 route components.
const EXACT_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/login': 'Sign In',
  '/signup': 'Start Your Trial',
  '/platform-admin': 'Platform Administration',
  '/test-repository': 'Test Cases',
  '/test-runs': 'Test Runs',
  '/execution': 'Execution',
  '/defects': 'Defects',
  '/defects/new': 'New Defect',
  '/dashboards': 'Manage Dashboards',
  '/reporting': 'Reporting',
  '/reporting/builder': 'Report builder',
  '/reporting/print': 'Compliance Report',
  '/admin/users': 'Admin › Users & Roles',
  '/admin/roles': 'Admin › Access Control',
  '/admin/audit-logs': 'Admin › Audit Logs',
  '/admin/environments': 'Admin › Environments',
  '/admin/access-rules': 'Admin › Access Control',
  '/settings': 'Admin › Settings',
  '/account': 'My Account',
}

const SEGMENT_TITLES: Record<string, string> = {
  projects: 'Project',
  requirements: 'Requirement',
  'test-cases': 'Test Case',
  'test-runs': 'Test Run',
  'test-run-cases': 'Execution Console',
  defects: 'Defect',
}

function isId(segment: string) {
  return /^[0-9a-f-]{8,}$/i.test(segment)
}

export function getPageTitle(pathname: string): string {
  if (pathname.startsWith('/accept-invite')) return 'Accept Invitation'
  if (pathname === '/user-guide') return 'User Guide'
  if (EXACT_TITLES[pathname]) return EXACT_TITLES[pathname]
  if (/^\/defects\/[^/]+\/edit$/.test(pathname)) return 'Edit Defect'
  if (pathname.startsWith('/dashboards/')) return 'Dashboard'
  if (/^\/projects\/[^/]+$/.test(pathname)) return 'Project Dashboard'
  if (/^\/projects\/[^/]+\/details$/.test(pathname)) return 'Project Details'

  const segments = pathname.split('/').filter(Boolean)
  // Walk backwards: the most specific recognizable segment wins (e.g.
  // /test-cases/:id -> the "test-cases" segment, not its trailing id).
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i]
    if (isId(segment)) continue
    if (SEGMENT_TITLES[segment]) {
      // If the id directly follows this segment, it's a detail view.
      const isDetail = i < segments.length - 1 && isId(segments[i + 1])
      return isDetail ? `${SEGMENT_TITLES[segment]} Detail` : `${SEGMENT_TITLES[segment]}s`
    }
  }
  return 'QTestHub'
}
