import { apiFetch } from '@/api/client'

// ADR-089: the in-app documentation is served by the API behind a session; the
// web bundle carries no document text. `audience` is "everyone" (any signed-in
// user) or "admin"; the list only ever contains what the caller may open.
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

export function listDocs(): Promise<DocList> {
  return apiFetch<DocList>('/docs')
}

export function getDoc(slug: string): Promise<DocContent> {
  return apiFetch<DocContent>(`/docs/${encodeURIComponent(slug)}`)
}
