import { describe, expect, it } from 'vitest'

import type { DocSummary } from '@/api/docs'
import { docFileName, findDocBySourceLink } from '@/routes/docs/docsManifest'

const doc = (slug: string, source: string): DocSummary => ({
  slug,
  title: slug,
  description: '',
  group: 'g',
  audience: 'everyone',
  min_level: 'everyone',
  source,
})

// The list the API returned for a non-admin: sensitive documents are absent.
const visible = [doc('user-guide', 'USER_GUIDE.md'), doc('sequence-diagrams', 'architecture/SEQUENCE_DIAGRAMS.md')]

describe('documentation link helpers (ADR-089)', () => {
  it('resolves relative links between documents the caller may open', () => {
    expect(findDocBySourceLink('USER_GUIDE.md', visible)?.slug).toBe('user-guide')
    expect(findDocBySourceLink('docs/architecture/SEQUENCE_DIAGRAMS.md#login', visible)?.slug).toBe('sequence-diagrams')
  })

  it('does not resolve links to documents the caller cannot open, or to repo files', () => {
    expect(findDocBySourceLink('DATABASE_SCHEMA.md', visible)).toBeUndefined()
    expect(findDocBySourceLink('../backend/app/main.py', visible)).toBeUndefined()
    expect(findDocBySourceLink('diagrams/seq-login-mfa.mmd', visible)).toBeUndefined()
  })

  it('names a download after the original file', () => {
    expect(docFileName(visible[1])).toBe('SEQUENCE_DIAGRAMS.md')
  })
})
