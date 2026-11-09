import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { createTestRun, listTestRuns, type RunType, type TestRunCreateRequest } from '@/api/execution'
import { getProject } from '@/api/projects'
import { listTestCases } from '@/api/testCases'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'

const RUN_TYPES: RunType[] = ['Regression', 'Sanity', 'Smoke']

export function TestRunsList() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [runType, setRunType] = useState<RunType>('Regression')
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([])

  const projectQuery = useQuery({
    queryKey: ['projects', projectId],
    queryFn: () => getProject(projectId!),
    enabled: !!projectId,
  })
  const runsQuery = useQuery({
    queryKey: ['test-runs', projectId],
    queryFn: () => listTestRuns(projectId!),
    enabled: !!projectId,
  })
  const testCasesQuery = useQuery({
    queryKey: ['test-cases', projectId, 'all-for-run-picker'],
    queryFn: () => listTestCases(projectId!, { page_size: 100, sort: 'title' }),
    enabled: !!projectId && createOpen,
  })
  const approvedCases = (testCasesQuery.data?.items ?? []).filter((tc) => tc.status === 'approved')

  const createMutation = useMutation({
    mutationFn: (req: TestRunCreateRequest) => createTestRun(projectId!, req),
    onSuccess: (run) => {
      queryClient.invalidateQueries({ queryKey: ['test-runs', projectId] })
      navigate(`/test-runs/${run.id}`)
    },
  })

  function toggleCase(id: string) {
    setSelectedCaseIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]))
  }

  function submitCreate() {
    createMutation.mutate({ name, run_type: runType, test_case_ids: selectedCaseIds })
  }

  const createError = createMutation.error instanceof ApiError ? createMutation.error.message : null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <Link to={`/projects/${projectId}`} className="text-xs text-[var(--muted-foreground)] hover:underline">
            ← {projectQuery.data?.name ?? 'Project'}
          </Link>
          <h1 className="text-lg font-semibold">Test Runs</h1>
        </div>
        <Button onClick={() => setCreateOpen(true)}>New Test Run</Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--muted)] text-left text-xs text-[var(--muted-foreground)]">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium">Cases</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {runsQuery.data?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-[var(--muted-foreground)]">
                  No test runs yet.
                </td>
              </tr>
            )}
            {runsQuery.data?.map((run) => (
              <tr key={run.id} className="border-t border-[var(--border)] hover:bg-[var(--muted)]">
                <td className="px-4 py-2">
                  <Link to={`/test-runs/${run.id}`} className="font-medium underline-offset-2 hover:underline">
                    {run.name}
                  </Link>
                </td>
                <td className="px-4 py-2">{run.run_type}</td>
                <td className="px-4 py-2">{run.case_count}</td>
                <td className="px-4 py-2">
                  <Badge tone={run.finished_at ? 'neutral' : 'positive'}>
                    {run.finished_at ? 'Finished' : 'Active'}
                  </Badge>
                </td>
                <td className="px-4 py-2">{new Date(run.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="New Test Run" className="max-w-xl">
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="run-name">Name</Label>
            <Input id="run-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="run-type">Type</Label>
            <Select id="run-type" value={runType} onChange={(e) => setRunType(e.target.value as RunType)}>
              {RUN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Approved Test Cases</Label>
            {approvedCases.length === 0 && (
              <p className="text-xs text-[var(--muted-foreground)]">
                No approved test cases in this project yet — only approved cases can be bundled into a run.
              </p>
            )}
            <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border border-[var(--border)] p-2">
              {approvedCases.map((tc) => (
                <li key={tc.id}>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedCaseIds.includes(tc.id)}
                      onChange={() => toggleCase(tc.id)}
                    />
                    {tc.title}
                  </label>
                </li>
              ))}
            </ul>
          </div>
          {createError && <p className="text-xs text-[var(--destructive)]">{createError}</p>}
          <Button
            disabled={!name || selectedCaseIds.length === 0 || createMutation.isPending}
            onClick={submitCreate}
          >
            {createMutation.isPending ? 'Creating…' : 'Create Test Run'}
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
