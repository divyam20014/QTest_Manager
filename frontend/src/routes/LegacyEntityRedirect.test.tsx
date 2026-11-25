import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'

import { EntityProjectGuard, LegacyDefectNew, LegacyEntityRedirect } from './LegacyEntityRedirect'

const P1 = '11111111-1111-1111-1111-111111111111'
const P2 = '22222222-2222-2222-2222-222222222222'
const ID = '33333333-3333-3333-3333-333333333333'

const getDefect = vi.fn()
const getTestCase = vi.fn()
const getRequirement = vi.fn()
const getTestRun = vi.fn()
vi.mock('@/api/defects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/defects')>()),
  getDefect: (...a: unknown[]) => getDefect(...a),
}))
vi.mock('@/api/testCases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/testCases')>()),
  getTestCase: (...a: unknown[]) => getTestCase(...a),
}))
vi.mock('@/api/requirements', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/requirements')>()),
  getRequirement: (...a: unknown[]) => getRequirement(...a),
}))
vi.mock('@/api/execution', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/execution')>()),
  getTestRun: (...a: unknown[]) => getTestRun(...a),
}))

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname + l.search + l.hash}</p>
}

function setup(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/requirements/:requirementId" element={<LegacyEntityRedirect kind="requirement" />} />
          <Route path="/test-cases/:testCaseId" element={<LegacyEntityRedirect kind="test-case" />} />
          <Route path="/test-cases/:testCaseId/edit" element={<LegacyEntityRedirect kind="test-case" suffix="/edit" />} />
          <Route path="/test-runs/:runId" element={<LegacyEntityRedirect kind="test-run" />} />
          <Route path="/defects/:defectId" element={<LegacyEntityRedirect kind="defect" />} />
          <Route
            path="/defects/new"
            element={
              <LegacyDefectNew>
                <p>global create page</p>
              </LegacyDefectNew>
            }
          />
          <Route
            path="/projects/:projectId/defects/:defectId"
            element={
              <EntityProjectGuard kind="defect">
                <p>defect page</p>
                <Where />
              </EntityProjectGuard>
            }
          />
          <Route path="/projects/:projectId/*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  for (const f of [getDefect, getTestCase, getRequirement, getTestRun]) {
    f.mockReset()
    f.mockResolvedValue({ id: ID, project_id: P1 })
  }
})

describe('legacy record URLs', () => {
  it.each([
    ['/requirements/' + ID, `/projects/${P1}/requirements/${ID}`],
    ['/test-cases/' + ID, `/projects/${P1}/test-cases/${ID}`],
    ['/test-cases/' + ID + '/edit', `/projects/${P1}/test-cases/${ID}/edit`],
    ['/test-runs/' + ID, `/projects/${P1}/test-runs/${ID}`],
    ['/defects/' + ID, `/projects/${P1}/defects/${ID}`],
  ])('%s redirects into the record’s project', async (from, to) => {
    setup(from)
    expect((await screen.findByTestId('where')).textContent).toBe(to)
  })

  it('keeps the query string and the hash', async () => {
    setup(`/defects/${ID}?tab=retests#notes`)
    expect((await screen.findByTestId('where')).textContent).toBe(`/projects/${P1}/defects/${ID}?tab=retests#notes`)
  })

  it('shows the error state instead of redirecting when the record cannot be read', async () => {
    getDefect.mockRejectedValue(new ApiError('Not found', 'not_found', 404))
    setup(`/defects/${ID}`)
    expect(await screen.findByText('Could not open this record.')).toBeInTheDocument()
    expect(screen.queryByTestId('where')).toBeNull()
  })

  it('moves /defects/new?projectId= into the project and keeps other parameters', async () => {
    setup(`/defects/new?projectId=${P1}&testCaseId=abc`)
    expect((await screen.findByTestId('where')).textContent).toBe(`/projects/${P1}/defects/new?testCaseId=abc`)
  })

  it('leaves /defects/new without a project where it is', async () => {
    setup('/defects/new')
    expect(await screen.findByText('global create page')).toBeInTheDocument()
  })
})

describe('project guard', () => {
  it('shows the record when the URL names its project', async () => {
    setup(`/projects/${P1}/defects/${ID}`)
    expect(await screen.findByText('defect page')).toBeInTheDocument()
    expect(screen.getByTestId('where').textContent).toBe(`/projects/${P1}/defects/${ID}`)
  })

  it('corrects a URL that names the wrong project', async () => {
    getDefect.mockResolvedValue({ id: ID, project_id: P2 })
    setup(`/projects/${P1}/defects/${ID}?tab=retests`)
    // The page renders at once and the guard moves it as soon as the record says which project it is in.
    await waitFor(() =>
      expect(screen.getByTestId('where').textContent).toBe(`/projects/${P2}/defects/${ID}?tab=retests`),
    )
  })
})
