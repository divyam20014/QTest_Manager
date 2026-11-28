import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useSearchParams } from 'react-router-dom'

import { isManagerOrAbove } from '@/api/auth'
import { ApiError } from '@/api/client'
import { listTestRuns } from '@/api/execution'
import { listTestCases } from '@/api/testCases'
import {
  createTestPlan,
  deleteTestPlan,
  getTestPlanRollup,
  listTestPlans,
} from '@/api/testPlans'
import {
  createRunFromSuite,
  createTestSuite,
  deleteTestSuite,
  listTestSuites,
} from '@/api/testSuites'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/PageHeader'
import { Tabs } from '@/components/ui/tabs'
import { useConfirm } from '@/components/ui/useConfirm'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'

import { MilestonesCard } from './ProjectMilestones'
import { BuildsReleasesCard } from './ProjectReleases'

// ADR-122 / ADR-131: the Planning tab, in two sections: test suites and plans, and the releases
// and builds that had a tab of their own. `?section=releases` opens the second.
export function ProjectPlanning() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const [params] = useSearchParams()
  const { user } = useAuth()
  const canManage = isManagerOrAbove(user)
  const asked = params.get('section')
  const section = asked === 'releases' || asked === 'milestones' ? asked : 'suites'
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Planning" description="Milestones, test suites and plans, and the releases and builds this project tracks." />
      {/* Keyed so that a link to the other section switches to it while the page is open. */}
      <Tabs
        key={section}
        defaultKey={section}
        items={[
          {
            key: 'suites',
            label: 'Suites & plans',
            content: (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <TestSuitesCard projectId={projectId} canManage={canManage} />
                <TestPlansCard projectId={projectId} canManage={canManage} />
              </div>
            ),
          },
          {
            key: 'milestones',
            label: 'Milestones',
            content: (
              <div className="max-w-3xl">
                <MilestonesCard projectId={projectId} />
              </div>
            ),
          },
          {
            key: 'releases',
            label: 'Releases & builds',
            content: (
              <div className="max-w-3xl">
                <BuildsReleasesCard projectId={projectId} canManage={canManage} />
              </div>
            ),
          },
        ]}
      />
    </div>
  )
}

// Pass 5 item 3: a reusable, flat, cross-module selection of test cases --
// distinct from TestModule (where a case structurally lives). Meant to be
// repeatedly imported wholesale into new Test Runs.
export function TestSuitesCard({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const { ask, dialog: confirmDialog } = useConfirm()
  const [suiteName, setSuiteName] = useState('')
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([])

  const suitesQuery = useQuery({
    queryKey: ['test-suites', projectId],
    queryFn: () => listTestSuites(projectId),
  })
  const casesQuery = useQuery({
    queryKey: ['test-cases-for-suite', projectId],
    // The API caps page_size at 100, so walk the pages until every case is
    // loaded (the suite picker needs the full list).
    queryFn: async () => {
      const first = await listTestCases(projectId, { page: 1, page_size: 100 })
      const items = [...first.items]
      for (let page = 2; items.length < first.total && page <= 50; page += 1) {
        const next = await listTestCases(projectId, { page, page_size: 100 })
        if (next.items.length === 0) break
        items.push(...next.items)
      }
      return { ...first, items }
    },
  })

  const createMutation = useMutation({
    mutationFn: () =>
      createTestSuite(projectId, {
        name: suiteName,
        test_case_ids: selectedCaseIds,
      }),
    onSuccess: () => {
      setSuiteName('')
      setSelectedCaseIds([])
      queryClient.invalidateQueries({ queryKey: ['test-suites', projectId] })
      showToast('success', 'Test suite created')
    },
    onError: () => showToast('error', 'Could not create that test suite'),
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTestSuite(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-suites', projectId] })
      showToast('success', 'Test suite deleted')
    },
    onError: () => showToast('error', 'Could not delete that test suite'),
  })
  const createRunMutation = useMutation({
    mutationFn: (suiteId: string) =>
      createRunFromSuite(suiteId, { name: `Run from suite ${Date.now()}`, run_type: 'Regression' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-runs', projectId] })
      showToast('success', 'Test run created from suite')
    },
    onError: (error) =>
      showToast('error', error instanceof ApiError ? error.message : 'Could not create a run'),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Test Suites</CardTitle>
        <p className="text-xs text-[var(--muted-foreground)]">
          A reusable, cross-module selection of test cases you can repeatedly import into new
          Test Runs.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {confirmDialog}
        <ul className="flex flex-col gap-1.5">
          {(suitesQuery.data ?? []).length === 0 && (
            <li className="text-[var(--muted-foreground)]">No test suites yet.</li>
          )}
          {suitesQuery.data?.map((suite) => (
            <li key={suite.id} className="flex items-center justify-between gap-2">
              <span>
                {suite.name}{' '}
                <span className="text-xs text-[var(--muted-foreground)]">
                  ({suite.test_case_ids.length} cases)
                </span>
              </span>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => createRunMutation.mutate(suite.id)}
                  disabled={createRunMutation.isPending}
                >
                  Create Run
                </Button>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={deleteMutation.isPending}
                    onClick={() =>
                      ask({
                        title: `Delete suite “${suite.name}”?`,
                        description:
                          'Only the suite (the saved selection) is deleted. The test cases in it, and runs already created from it, are not affected.',
                        confirmLabel: 'Delete suite',
                        run: () => deleteMutation.mutateAsync(suite.id),
                      })
                    }
                  >
                    Delete
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {canManage && (
          <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-3">
            <Input
              placeholder="New suite name (e.g. Regression Suite - Critical Path)" aria-label="New suite name"
              value={suiteName}
              onChange={(e) => setSuiteName(e.target.value)}
            />
            <div className="max-h-32 overflow-y-auto rounded-lg border border-[var(--border)] p-2">
              {casesQuery.data?.items.map((c) => (
                <label key={c.id} className="flex items-center gap-2 py-0.5 text-xs">
                  <input
                    type="checkbox"
                    checked={selectedCaseIds.includes(c.id)}
                    onChange={(e) =>
                      setSelectedCaseIds((prev) =>
                        e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id),
                      )
                    }
                  />
                  {c.title}
                </label>
              ))}
            </div>
            <Button
              size="sm"
              disabled={!suiteName || selectedCaseIds.length === 0 || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              Create Suite
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Pass 5 item 3: groups one or more Test Runs under a planning umbrella
// (e.g. "Release 2.0 Test Plan"), with a rollup view across its child
// runs. Distinct from Release (a version marker) and TestRun (a single
// execution cycle) -- a Plan's job is grouping runs for a combined view.
export function TestPlansCard({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const { ask, dialog: confirmDialog } = useConfirm()
  const [planName, setPlanName] = useState('')
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([])

  const plansQuery = useQuery({
    queryKey: ['test-plans', projectId],
    queryFn: () => listTestPlans(projectId),
  })
  const runsQuery = useQuery({
    queryKey: ['test-runs', projectId],
    queryFn: () => listTestRuns(projectId),
  })

  const createMutation = useMutation({
    mutationFn: () => createTestPlan(projectId, { name: planName, test_run_ids: selectedRunIds }),
    onSuccess: () => {
      setPlanName('')
      setSelectedRunIds([])
      queryClient.invalidateQueries({ queryKey: ['test-plans', projectId] })
      showToast('success', 'Test plan created')
    },
    onError: () => showToast('error', 'Could not create that test plan'),
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTestPlan(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-plans', projectId] })
      showToast('success', 'Test plan deleted')
    },
    onError: () => showToast('error', 'Could not delete that test plan'),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Test Plans</CardTitle>
        <p className="text-xs text-[var(--muted-foreground)]">
          Group multiple Test Runs under a release umbrella with a combined readiness rollup.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {confirmDialog}
        <ul className="flex flex-col gap-2">
          {(plansQuery.data ?? []).length === 0 && (
            <li className="text-[var(--muted-foreground)]">No test plans yet.</li>
          )}
          {plansQuery.data?.map((plan) => (
            <PlanRow
              key={plan.id}
              plan={plan}
              canManage={canManage}
              onDelete={() =>
                ask({
                  title: `Delete plan “${plan.name}”?`,
                  description:
                    'Only the plan (the grouping and its rollup) is deleted. The test runs inside it are not affected.',
                  confirmLabel: 'Delete plan',
                  run: () => deleteMutation.mutateAsync(plan.id),
                })
              }
            />
          ))}
        </ul>
        {canManage && (
          <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-3">
            <Input
              placeholder="New plan name (e.g. Release 2.0 Test Plan)" aria-label="New plan name"
              value={planName}
              onChange={(e) => setPlanName(e.target.value)}
            />
            <div className="max-h-32 overflow-y-auto rounded-lg border border-[var(--border)] p-2">
              {runsQuery.data?.map((r) => (
                <label key={r.id} className="flex items-center gap-2 py-0.5 text-xs">
                  <input
                    type="checkbox"
                    checked={selectedRunIds.includes(r.id)}
                    onChange={(e) =>
                      setSelectedRunIds((prev) =>
                        e.target.checked ? [...prev, r.id] : prev.filter((id) => id !== r.id),
                      )
                    }
                  />
                  {r.name} ({r.run_type})
                </label>
              ))}
            </div>
            <Button
              size="sm"
              disabled={!planName || selectedRunIds.length === 0 || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              Create Plan
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function PlanRow({
  plan,
  canManage,
  onDelete,
}: {
  plan: { id: string; name: string; test_run_ids: string[] }
  canManage: boolean
  onDelete: () => void
}) {
  const rollupQuery = useQuery({
    queryKey: ['test-plan-rollup', plan.id],
    queryFn: () => getTestPlanRollup(plan.id),
  })

  return (
    <li className="rounded-lg border border-[var(--border)] p-2">
      <div className="flex items-center justify-between">
        <span className="font-medium">
          {plan.name}{' '}
          <span className="text-xs text-[var(--muted-foreground)]">
            ({plan.test_run_ids.length} runs)
          </span>
        </span>
        {canManage && (
          <Button variant="ghost" size="sm" onClick={onDelete}>
            Delete
          </Button>
        )}
      </div>
      {rollupQuery.data && (
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          {rollupQuery.data.execution_completion_percentage}% complete &middot;{' '}
          {rollupQuery.data.pass_percentage}% run case pass rate &middot;{' '}
          {Object.values(rollupQuery.data.open_defects_by_severity).reduce((a, b) => a + b, 0)}{' '}
          open defects
        </p>
      )}
    </li>
  )
}
