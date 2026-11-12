import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import {
  addProjectMember,
  deleteProject,
  getProject,
  removeProjectMember,
  updateProject,
  type ProjectUpdateRequest,
} from '@/api/projects'
import {
  createBuild,
  createRelease,
  deleteBuild,
  deleteRelease,
  listBuilds,
  listReleases,
} from '@/api/testAssets'
import { listUsers } from '@/api/users'
import { listTestCases } from '@/api/testCases'
import { listTestRuns } from '@/api/execution'
import {
  createRunFromSuite,
  createTestSuite,
  deleteTestSuite,
  listTestSuites,
} from '@/api/testSuites'
import {
  createTestPlan,
  deleteTestPlan,
  getTestPlanRollup,
  listTestPlans,
} from '@/api/testPlans'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useAuth } from '@/lib/auth'
import { isManagerOrAbove } from '@/api/auth'
import { useToast } from '@/lib/toast'
import { ProjectForm, type ProjectFormValues } from './ProjectForm'
import { PRIORITY_TONE, STATUS_TONE } from './statusDisplay'

export function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [newMemberId, setNewMemberId] = useState('')
  const { show: showToast } = useToast()

  const projectQuery = useQuery({
    queryKey: ['projects', projectId],
    queryFn: () => getProject(projectId!),
    enabled: !!projectId,
  })

  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers, enabled: canManage() })

  function canManage() {
    return isManagerOrAbove(user)
  }

  const updateMutation = useMutation({
    mutationFn: (req: ProjectUpdateRequest) => updateProject(projectId!, req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] })
      showToast('success', 'Project updated')
    },
    // No onError toast -- `updateError` below already renders this inline.
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteProject(projectId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      navigate('/projects')
      showToast('success', 'Project deleted')
    },
    // No onError toast -- `deleteError` below already renders this inline.
  })

  const addMemberMutation = useMutation({
    mutationFn: (userId: string) => addProjectMember(projectId!, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] })
      setNewMemberId('')
      showToast('success', 'Member added')
    },
    onError: () => showToast('error', 'Could not add that member'),
  })

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => removeProjectMember(projectId!, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] })
      showToast('success', 'Member removed')
    },
    onError: () => showToast('error', 'Could not remove that member'),
  })

  const project = projectQuery.data
  if (projectQuery.isLoading) return <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>
  if (projectQuery.isError || !project) return <p className="text-sm text-[var(--destructive)]">Project not found.</p>

  const formValues: ProjectFormValues = {
    name: project.name,
    domain: project.domain,
    priority: project.priority,
    status: project.status,
    manager_name: project.manager_name,
    manager_user_id: project.manager_user_id ?? '',
    start_date: project.start_date,
    end_date: project.end_date,
    budget: project.budget,
    region: project.region,
  }

  const assignableUsers = (usersQuery.data ?? []).filter((u) => !project.assigned_user_ids.includes(u.id))
  const memberUsers = (usersQuery.data ?? []).filter((u) => project.assigned_user_ids.includes(u.id))

  const updateError = updateMutation.error instanceof ApiError ? updateMutation.error.message : null
  const deleteError = deleteMutation.error instanceof ApiError ? deleteMutation.error.message : null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">{project.name}</h1>
          <Badge tone={STATUS_TONE[project.status]}>{project.status}</Badge>
          <Badge tone={PRIORITY_TONE[project.priority]}>{project.priority}</Badge>
        </div>
        <div className="flex gap-2">
          <Link to={`/projects/${project.id}/requirements`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Requirements
          </Link>
          <Link to={`/projects/${project.id}/test-cases`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Test Cases
          </Link>
          <Link to={`/projects/${project.id}/test-runs`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Test Runs
          </Link>
          <Link
            to={`/reporting?project=${project.id}`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Release Readiness
          </Link>
          {canManage() && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              Delete Project
            </Button>
          )}
        </div>
      </div>
      {deleteError && <p className="text-xs text-[var(--destructive)]">{deleteError}</p>}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricTile label="Test Cases" value={project.test_case_count} />
        <MetricTile label="Approved" value={project.approved_test_case_count} />
        <MetricTile label="Test Runs" value={project.test_run_count} />
        <MetricTile label="Open Defects" value={project.open_defect_count} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            {canManage() ? (
              <ProjectForm
                defaultValues={formValues}
                submitLabel="Save Changes"
                isSubmitting={updateMutation.isPending}
                serverError={updateError}
                users={usersQuery.data ?? []}
                onSubmit={(values) => updateMutation.mutate(values)}
              />
            ) : (
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-[var(--muted-foreground)]">Domain</dt>
                <dd>{project.domain}</dd>
                <dt className="text-[var(--muted-foreground)]">Status</dt>
                <dd>{project.status}</dd>
                <dt className="text-[var(--muted-foreground)]">Priority</dt>
                <dd>{project.priority}</dd>
                <dt className="text-[var(--muted-foreground)]">Manager</dt>
                <dd>{project.manager_name}</dd>
                <dt className="text-[var(--muted-foreground)]">Dates</dt>
                <dd>
                  {project.start_date} → {project.end_date}
                </dd>
                <dt className="text-[var(--muted-foreground)]">Budget</dt>
                <dd>
                  {project.currency_code} {project.budget}
                </dd>
                <dt className="text-[var(--muted-foreground)]">Region</dt>
                <dd>{project.region}</dd>
              </dl>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Team Members</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ul className="flex flex-col gap-2 text-sm">
              {memberUsers.length === 0 && <li className="text-[var(--muted-foreground)]">No members assigned.</li>}
              {memberUsers.map((member) => (
                <li key={member.id} className="flex items-center justify-between">
                  <span>
                    {member.name} <span className="text-xs text-[var(--muted-foreground)]">({member.role})</span>
                  </span>
                  {canManage() && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeMemberMutation.mutate(member.id)}
                      disabled={removeMemberMutation.isPending}
                    >
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>

            {canManage() && assignableUsers.length > 0 && (
              <div className="flex gap-2 border-t border-[var(--border)] pt-3">
                <Select
                  id="add-member-select"
                  aria-label="Select a user to add to the project"
                  value={newMemberId}
                  onChange={(e) => setNewMemberId(e.target.value)}
                >
                  <option value="">Select a user…</option>
                  {assignableUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.role})
                    </option>
                  ))}
                </Select>
                <Button
                  size="sm"
                  disabled={!newMemberId || addMemberMutation.isPending}
                  onClick={() => addMemberMutation.mutate(newMemberId)}
                >
                  Add
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <BuildsReleasesCard projectId={projectId!} canManage={canManage()} />
        <TestSuitesCard projectId={projectId!} canManage={canManage()} />
        <TestPlansCard projectId={projectId!} canManage={canManage()} />
      </div>
    </div>
  )
}

function BuildsReleasesCard({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const queryClient = useQueryClient()
  const [buildName, setBuildName] = useState('')
  const [releaseName, setReleaseName] = useState('')
  const { show: showToast } = useToast()

  const buildsQuery = useQuery({
    queryKey: ['builds', projectId],
    queryFn: () => listBuilds(projectId),
  })
  const releasesQuery = useQuery({
    queryKey: ['releases', projectId],
    queryFn: () => listReleases(projectId),
  })

  const createBuildMutation = useMutation({
    mutationFn: () => createBuild(projectId, { name: buildName }),
    onSuccess: () => {
      setBuildName('')
      queryClient.invalidateQueries({ queryKey: ['builds', projectId] })
      showToast('success', 'Build added')
    },
    onError: () => showToast('error', 'Could not add that build'),
  })
  const deleteBuildMutation = useMutation({
    mutationFn: (id: string) => deleteBuild(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['builds', projectId] })
      showToast('success', 'Build removed')
    },
    onError: () => showToast('error', 'Could not remove that build'),
  })
  const createReleaseMutation = useMutation({
    mutationFn: () => createRelease(projectId, { name: releaseName }),
    onSuccess: () => {
      setReleaseName('')
      queryClient.invalidateQueries({ queryKey: ['releases', projectId] })
      showToast('success', 'Release added')
    },
    onError: () => showToast('error', 'Could not add that release'),
  })
  const deleteReleaseMutation = useMutation({
    mutationFn: (id: string) => deleteRelease(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['releases', projectId] })
      showToast('success', 'Release removed')
    },
    onError: () => showToast('error', 'Could not remove that release'),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Builds &amp; Releases</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <p className="mb-1.5 text-xs font-medium text-[var(--muted-foreground)]">Builds</p>
          <ul className="flex flex-col gap-1.5 text-sm">
            {(buildsQuery.data ?? []).length === 0 && (
              <li className="text-[var(--muted-foreground)]">No builds recorded.</li>
            )}
            {buildsQuery.data?.map((b) => (
              <li key={b.id} className="flex items-center justify-between">
                <span>{b.name}</span>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteBuildMutation.mutate(b.id)}
                    disabled={deleteBuildMutation.isPending}
                  >
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {canManage && (
            <div className="mt-2 flex gap-2">
              <Input
                className="flex-1"
                placeholder="New build name"
                value={buildName}
                onChange={(e) => setBuildName(e.target.value)}
              />
              <Button
                size="sm"
                disabled={!buildName || createBuildMutation.isPending}
                onClick={() => createBuildMutation.mutate()}
              >
                Add
              </Button>
            </div>
          )}
        </div>

        <div className="border-t border-[var(--border)] pt-3">
          <p className="mb-1.5 text-xs font-medium text-[var(--muted-foreground)]">Releases</p>
          <ul className="flex flex-col gap-1.5 text-sm">
            {(releasesQuery.data ?? []).length === 0 && (
              <li className="text-[var(--muted-foreground)]">No releases recorded.</li>
            )}
            {releasesQuery.data?.map((r) => (
              <li key={r.id} className="flex items-center justify-between">
                <span>{r.name}</span>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteReleaseMutation.mutate(r.id)}
                    disabled={deleteReleaseMutation.isPending}
                  >
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {canManage && (
            <div className="mt-2 flex gap-2">
              <Input
                className="flex-1"
                placeholder="New release name"
                value={releaseName}
                onChange={(e) => setReleaseName(e.target.value)}
              />
              <Button
                size="sm"
                disabled={!releaseName || createReleaseMutation.isPending}
                onClick={() => createReleaseMutation.mutate()}
              >
                Add
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function MetricTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <div className="text-xs text-[var(--muted-foreground)]">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  )
}

// Pass 5 item 3: a reusable, flat, cross-module selection of test cases --
// distinct from TestModule (where a case structurally lives). Meant to be
// repeatedly imported wholesale into new Test Runs.
function TestSuitesCard({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const [suiteName, setSuiteName] = useState('')
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([])

  const suitesQuery = useQuery({
    queryKey: ['test-suites', projectId],
    queryFn: () => listTestSuites(projectId),
  })
  const casesQuery = useQuery({
    queryKey: ['test-cases-for-suite', projectId],
    queryFn: () => listTestCases(projectId, { page_size: 200 }),
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
                  <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate(suite.id)}>
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
              placeholder="New suite name (e.g. Regression Suite - Critical Path)"
              value={suiteName}
              onChange={(e) => setSuiteName(e.target.value)}
            />
            <div className="max-h-32 overflow-y-auto rounded border border-[var(--border)] p-2">
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
function TestPlansCard({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
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
        <ul className="flex flex-col gap-2">
          {(plansQuery.data ?? []).length === 0 && (
            <li className="text-[var(--muted-foreground)]">No test plans yet.</li>
          )}
          {plansQuery.data?.map((plan) => (
            <PlanRow key={plan.id} plan={plan} canManage={canManage} onDelete={() => deleteMutation.mutate(plan.id)} />
          ))}
        </ul>
        {canManage && (
          <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-3">
            <Input
              placeholder="New plan name (e.g. Release 2.0 Test Plan)"
              value={planName}
              onChange={(e) => setPlanName(e.target.value)}
            />
            <div className="max-h-32 overflow-y-auto rounded border border-[var(--border)] p-2">
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
    <li className="rounded border border-[var(--border)] p-2">
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
          {rollupQuery.data.pass_percentage}% pass rate &middot;{' '}
          {Object.values(rollupQuery.data.open_defects_by_severity).reduce((a, b) => a + b, 0)}{' '}
          open defects
        </p>
      )}
    </li>
  )
}
