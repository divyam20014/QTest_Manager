/**
 * ADR-127: the canonical URLs of a project's records. Requirements, test cases, test runs, defects
 * and tasks all open inside their project (`/projects/:projectId/...`), so the project header and
 * tabs stay around them. The old top-level URLs (`/requirements/:id`, `/test-cases/:id`, ...) are
 * kept as redirects (routes/LegacyEntityRedirect.tsx), so bookmarks, pins, recents and notification
 * links made before keep working.
 *
 * Execution (`/test-run-cases/:id`) and the cross-project lists (`/defects`, `/test-runs`,
 * `/test-repository`) are deliberately not moved.
 */

export type EntityKind = 'requirement' | 'test-case' | 'test-run' | 'defect' | 'task'

const base = (projectId: string) => `/projects/${projectId}`

export const requirementPath = (projectId: string, id: string) => `${base(projectId)}/requirements/${id}`
export const testCasePath = (projectId: string, id: string) => `${base(projectId)}/test-cases/${id}`
export const testCaseEditPath = (projectId: string, id: string) => `${testCasePath(projectId, id)}/edit`
export const testRunPath = (projectId: string, id: string) => `${base(projectId)}/test-runs/${id}`
export const defectPath = (projectId: string, id: string) => `${base(projectId)}/defects/${id}`
export const defectEditPath = (projectId: string, id: string) => `${defectPath(projectId, id)}/edit`
export const defectNewPath = (projectId: string) => `${base(projectId)}/defects/new`
export const taskPath = (projectId: string, id: string) => `${base(projectId)}/tasks/${id}`

/** The canonical URL of a record of `kind` (`suffix` is "", "/edit"). */
export function entityPath(kind: EntityKind, projectId: string, id: string, suffix = ''): string {
  switch (kind) {
    case 'requirement':
      return requirementPath(projectId, id)
    case 'test-case':
      return testCasePath(projectId, id) + suffix
    case 'test-run':
      return testRunPath(projectId, id)
    case 'defect':
      return defectPath(projectId, id) + suffix
    case 'task':
      return taskPath(projectId, id)
  }
}

const LEGACY: { kind: EntityKind; pattern: RegExp }[] = [
  { kind: 'requirement', pattern: /^\/requirements\/([^/]+)$/ },
  { kind: 'test-case', pattern: /^\/test-cases\/([^/]+)(\/edit)?$/ },
  { kind: 'test-run', pattern: /^\/test-runs\/([^/]+)$/ },
  { kind: 'defect', pattern: /^\/defects\/([^/]+)(\/edit)?$/ },
]

const ID = /^[0-9a-f-]{8,}$/i

/**
 * Reads an old top-level record URL (as stored in a pin, a recent item or a notification). Returns
 * null for anything else, including `/defects/new` and the list pages.
 */
export function parseLegacyPath(pathname: string): { kind: EntityKind; id: string; suffix: string } | null {
  const clean = pathname.replace(/\/+$/, '')
  for (const { kind, pattern } of LEGACY) {
    const m = pattern.exec(clean)
    if (m && ID.test(m[1])) return { kind, id: m[1], suffix: m[2] ?? '' }
  }
  return null
}

/**
 * The canonical URL for a stored link when the record's project is known; the link itself when it is
 * not an old record URL (so it is safe to run over every stored URL).
 */
export function canonicalUrl(url: string, projectId: string | null | undefined): string {
  if (!projectId) return url
  const [pathAndQuery, hash = ''] = url.split('#')
  const [pathname, query = ''] = pathAndQuery.split('?')
  const legacy = parseLegacyPath(pathname)
  if (!legacy) return url
  return entityPath(legacy.kind, projectId, legacy.id, legacy.suffix) + (query ? `?${query}` : '') + (hash ? `#${hash}` : '')
}
