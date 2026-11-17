import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import manifest from '@/content/docs/manifest.json'
import { canViewDoc, DOCUMENTS, findDoc, findDocBySourceLink, visibleDocs } from '@/routes/docs/docsManifest'

const here = dirname(fileURLToPath(import.meta.url))
const contentDir = join(here, '..', '..', 'content', 'docs')
const sourceDocsDir = join(here, '..', '..', '..', '..', 'docs')
const normalize = (text: string) => text.replace(/\r\n/g, '\n')

// BRD gap Phase 4 / ADR-072: the in-app Documentation viewer ships these
// files inside the web bundle, so what goes in is checked here.
describe('in-app documentation content', () => {
  it('has a bundled copy for every manifest entry, with unique ids and a known audience and group', () => {
    const ids = new Set<string>()
    const groups = new Set(manifest.groups.map((g) => g.id))
    for (const doc of manifest.documents) {
      expect(ids.has(doc.id), `duplicate id ${doc.id}`).toBe(false)
      ids.add(doc.id)
      expect(['everyone', 'admin-manager']).toContain(doc.audience)
      expect(groups.has(doc.group), `unknown group for ${doc.id}`).toBe(true)
      expect(existsSync(join(contentDir, `${doc.id}.md`)), `${doc.id}.md is missing`).toBe(true)
    }
  })

  it('keeps each bundled copy identical to its source in docs/ (run `npm run docs:sync` if this fails)', () => {
    // docs/ is not part of the web image's build context, so this check only
    // runs where the repository's docs folder exists (local and CI checkouts).
    if (!existsSync(sourceDocsDir)) return
    for (const doc of manifest.documents) {
      const source = join(sourceDocsDir, doc.source)
      expect(existsSync(source), `docs/${doc.source} is missing`).toBe(true)
      const bundled = normalize(readFileSync(join(contentDir, `${doc.id}.md`), 'utf8'))
      expect(bundled, `${doc.id}.md is stale`).toBe(normalize(readFileSync(source, 'utf8')))
    }
  })

  it('contains no credentials, keys or private addresses', () => {
    const patterns: [string, RegExp][] = [
      ['private key block', /BEGIN [A-Z ]*PRIVATE KEY/],
      ['AWS access key', /AKIA[0-9A-Z]{16}/],
      ['API secret key', /\bsk-[A-Za-z0-9]{20,}/],
      ['connection string with a password', /postgres(ql)?(\+\w+)?:\/\/[^\s/:]+:[^\s@]+@/],
      ['assigned secret', /(SECRET|TOKEN|API_KEY|PASSWORD)[A-Z0-9_]*\s*=\s*['"]?[A-Za-z0-9/+_-]{8,}/],
      ['private network address', /\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/],
    ]
    for (const doc of manifest.documents) {
      const text = readFileSync(join(contentDir, `${doc.id}.md`), 'utf8')
      for (const [label, pattern] of patterns) {
        expect(pattern.test(text), `${doc.id}.md contains a ${label}`).toBe(false)
      }
    }
  })
})

describe('documentation visibility', () => {
  const tester = { user_id: 'u', tenant_id: 't', email: 'x', name: 'T', role: 'tester', permissions: [] }
  const manager = { ...tester, role: 'manager', permissions: ['project.view.all'] }
  const admin = { ...tester, role: 'admin', permissions: ['project.view.all'] }

  it('shows everyone only the user-facing documents, and Admin/Manager all of them', () => {
    const testerDocs = visibleDocs(tester)
    expect(testerDocs.length).toBeGreaterThan(0)
    expect(testerDocs.every((d) => d.audience === 'everyone')).toBe(true)
    expect(visibleDocs(manager)).toHaveLength(DOCUMENTS.length)
    expect(visibleDocs(admin)).toHaveLength(DOCUMENTS.length)
    expect(canViewDoc(null, findDoc('user-guide')!)).toBe(true)
    expect(canViewDoc(tester, findDoc('database-schema')!)).toBe(false)
    expect(canViewDoc(manager, findDoc('database-schema')!)).toBe(true)
  })

  it('keeps the user guide open to every role', () => {
    expect(findDoc('user-guide')?.audience).toBe('everyone')
  })

  it('resolves relative links between documents by file name', () => {
    expect(findDocBySourceLink('ARCHITECTURE.md')?.id).toBe('architecture')
    expect(findDocBySourceLink('docs/architecture/SEQUENCE_DIAGRAMS.md#login')?.id).toBe('sequence-diagrams')
    expect(findDocBySourceLink('../backend/app/main.py')).toBeUndefined()
    expect(findDocBySourceLink('diagrams/seq-login-mfa.mmd')).toBeUndefined()
  })
})
