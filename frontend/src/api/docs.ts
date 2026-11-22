// ADR-089 / ADR-114: documentation text is served by the API, never bundled.
// Only the platform console reads it (`/platform/docs`, platform session); the
// tenant app has the role-filtered User Guide instead (api/userGuide.ts).
// `audience` is "everyone" or "admin" (a classification, not an access rule).
export type DocAudience = 'everyone' | 'admin'

export interface DocSummary {
  slug: string
  title: string
  description: string
  group: string
  audience: DocAudience
  min_level: DocAudience
  /** Path under the repo's docs/ folder, e.g. "architecture/SEQUENCE_DIAGRAMS.md". */
  source: string
}

export interface DocGroup {
  id: string
  title: string
}

export interface DocList {
  groups: DocGroup[]
  documents: DocSummary[]
}

export interface DocContent extends DocSummary {
  content: string
}

/** How a viewer loads documents; the platform console supplies its own. */
export interface DocFetchers {
  list: () => Promise<DocList>
  get: (slug: string) => Promise<DocContent>
}
