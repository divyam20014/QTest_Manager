import { describe, expect, it } from 'vitest'

import {
  canonicalUrl,
  defectEditPath,
  defectNewPath,
  defectPath,
  entityPath,
  parseLegacyPath,
  requirementPath,
  taskPath,
  testCaseEditPath,
  testCasePath,
  testRunPath,
} from './entityRoutes'

const P = '11111111-1111-1111-1111-111111111111'
const ID = '22222222-2222-2222-2222-222222222222'

describe('entity routes', () => {
  it('builds every record URL inside its project', () => {
    expect(requirementPath(P, ID)).toBe(`/projects/${P}/requirements/${ID}`)
    expect(testCasePath(P, ID)).toBe(`/projects/${P}/test-cases/${ID}`)
    expect(testCaseEditPath(P, ID)).toBe(`/projects/${P}/test-cases/${ID}/edit`)
    expect(testRunPath(P, ID)).toBe(`/projects/${P}/test-runs/${ID}`)
    expect(defectPath(P, ID)).toBe(`/projects/${P}/defects/${ID}`)
    expect(defectEditPath(P, ID)).toBe(`/projects/${P}/defects/${ID}/edit`)
    expect(defectNewPath(P)).toBe(`/projects/${P}/defects/new`)
    expect(taskPath(P, ID)).toBe(`/projects/${P}/tasks/${ID}`)
  })

  it('maps a kind and a suffix to the same URLs', () => {
    expect(entityPath('defect', P, ID, '/edit')).toBe(defectEditPath(P, ID))
    expect(entityPath('test-case', P, ID)).toBe(testCasePath(P, ID))
    expect(entityPath('requirement', P, ID, '/edit')).toBe(requirementPath(P, ID))
  })

  it('reads the old top-level record URLs', () => {
    expect(parseLegacyPath(`/requirements/${ID}`)).toEqual({ kind: 'requirement', id: ID, suffix: '' })
    expect(parseLegacyPath(`/test-cases/${ID}/edit`)).toEqual({ kind: 'test-case', id: ID, suffix: '/edit' })
    expect(parseLegacyPath(`/test-runs/${ID}/`)).toEqual({ kind: 'test-run', id: ID, suffix: '' })
    expect(parseLegacyPath(`/defects/${ID}/edit`)).toEqual({ kind: 'defect', id: ID, suffix: '/edit' })
  })

  it('does not mistake lists, creation pages, the console or new URLs for records', () => {
    for (const path of [
      '/defects',
      '/defects/new',
      '/test-runs',
      '/test-repository',
      `/test-run-cases/${ID}`,
      `/projects/${P}/defects/${ID}`,
      '/test-cases/not-an-id',
    ]) {
      expect(parseLegacyPath(path)).toBeNull()
    }
  })

  it('rewrites a stored link once the project is known and leaves everything else alone', () => {
    expect(canonicalUrl(`/defects/${ID}?tab=retests#notes`, P)).toBe(`/projects/${P}/defects/${ID}?tab=retests#notes`)
    expect(canonicalUrl(`/test-cases/${ID}/edit`, P)).toBe(`/projects/${P}/test-cases/${ID}/edit`)
    expect(canonicalUrl(`/defects/${ID}`, null)).toBe(`/defects/${ID}`)
    expect(canonicalUrl('/defects?projectId=abc', P)).toBe('/defects?projectId=abc')
    expect(canonicalUrl(`/projects/${P}/tasks/${ID}`, P)).toBe(`/projects/${P}/tasks/${ID}`)
  })
})
