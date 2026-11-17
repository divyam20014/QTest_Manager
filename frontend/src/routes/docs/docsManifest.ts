import type { MeResponse } from '@/api/auth'
import { isManagerOrAbove } from '@/api/auth'
import manifest from '@/content/docs/manifest.json'

// BRD gap Phase 4 / ADR-072 (FR-BRD-01/02): the in-app documentation viewer's
// curated document set. The Markdown text is bundled into the web build (one
// lazy chunk per document) -- nothing is read at runtime and no API is
// involved. `manifest.json` is the single list; `scripts/sync-docs.mjs` copies
// the files from the repo's docs/ folder.

export type DocAudience = 'everyone' | 'admin-manager'

export interface DocEntry {
  id: string
  title: string
  description: string
  audience: DocAudience
  group: string
  /** Path relative to the repo's docs/ folder. */
  source: string
}

export interface DocGroup {
  id: string
  title: string
}

export const DOC_GROUPS: DocGroup[] = manifest.groups
export const DOCUMENTS = manifest.documents as DocEntry[]

const loaders = import.meta.glob('/src/content/docs/*.md', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>

export function findDoc(id: string | undefined): DocEntry | undefined {
  return id ? DOCUMENTS.find((d) => d.id === id) : undefined
}

/** Whether this user may read the document. UI-level only: the text ships in
 * the web bundle, so the internal set is not secret from someone who inspects
 * the build -- it is a relevance/privacy filter, not an access control. */
export function canViewDoc(user: MeResponse | null, doc: DocEntry): boolean {
  return doc.audience === 'everyone' || isManagerOrAbove(user)
}

export function visibleDocs(user: MeResponse | null): DocEntry[] {
  return DOCUMENTS.filter((d) => canViewDoc(user, d))
}

export function loadDocText(doc: DocEntry): Promise<string> {
  const loader = loaders[`/src/content/docs/${doc.id}.md`]
  if (!loader) return Promise.reject(new Error(`Document "${doc.id}" is not bundled`))
  return loader()
}

/** The download file name: the original file's name, e.g. USER_GUIDE.md. */
export function docFileName(doc: DocEntry): string {
  return doc.source.split('/').pop() ?? `${doc.id}.md`
}

/** Resolves a relative link found inside a document (`ARCHITECTURE.md`,
 * `docs/architecture/SEQUENCE_DIAGRAMS.md#login`) to a bundled document. */
export function findDocBySourceLink(href: string): DocEntry | undefined {
  const path = href.split('#')[0].split('?')[0]
  const base = path.split('/').pop()
  if (!base || !base.toLowerCase().endsWith('.md')) return undefined
  return DOCUMENTS.find((d) => (d.source.split('/').pop() ?? '').toLowerCase() === base.toLowerCase())
}

export const DEFAULT_DOC_ID = 'user-guide'
