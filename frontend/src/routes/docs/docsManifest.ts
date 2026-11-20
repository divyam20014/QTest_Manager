import type { DocSummary } from '@/api/docs'

// ADR-089 (supersedes the bundled copies of ADR-072): the document list and
// text come from the API (`/docs`), so this module only holds the pure helpers
// the viewer needs. Nothing here contains document text.

export const DEFAULT_DOC_ID = 'user-guide'

/** The download file name: the original file's name, e.g. USER_GUIDE.md. */
export function docFileName(doc: Pick<DocSummary, 'slug' | 'source'>): string {
  return doc.source.split('/').pop() ?? `${doc.slug}.md`
}

/** Resolves a relative link found inside a document (`ARCHITECTURE.md`,
 * `docs/architecture/SEQUENCE_DIAGRAMS.md#login`) to one of the documents the
 * caller may open (the list the API returned for them). */
export function findDocBySourceLink(href: string, docs: readonly DocSummary[]): DocSummary | undefined {
  const path = href.split('#')[0].split('?')[0]
  const base = path.split('/').pop()
  if (!base || !base.toLowerCase().endsWith('.md')) return undefined
  return docs.find((d) => (d.source.split('/').pop() ?? '').toLowerCase() === base.toLowerCase())
}
