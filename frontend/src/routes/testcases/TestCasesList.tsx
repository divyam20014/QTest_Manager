import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { exportUrl } from '@/api/csvImport'
import { getProject } from '@/api/projects'
import { createTestCase, listTestCases, type TestCaseCreateRequest } from '@/api/testCases'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { ImportDialog } from './ImportDialog'
import { TestCaseForm, type TestCaseFormValues } from './TestCaseForm'
import { STATUS_DISPLAY } from './statusDisplay'

const DEFAULT_VALUES: TestCaseFormValues = {
  title: '',
  priority: 'Medium',
  steps: [{ action: '', expected: '' }],
}

export function TestCasesList() {
  const { projectId } = useParams<{ projectId: string }>()
  const [createOpen, setCreateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const queryClient = useQueryClient()

  const projectQuery = useQuery({
    queryKey: ['projects', projectId],
    queryFn: () => getProject(projectId!),
    enabled: !!projectId,
  })
  const testCasesQuery = useQuery({
    queryKey: ['test-cases', projectId],
    queryFn: () => listTestCases(projectId!),
    enabled: !!projectId,
  })

  const createMutation = useMutation({
    mutationFn: (req: TestCaseCreateRequest) => createTestCase(projectId!, req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-cases', projectId] })
      setCreateOpen(false)
    },
  })

  const createError = createMutation.error instanceof ApiError ? createMutation.error.message : null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <Link to={`/projects/${projectId}`} className="text-xs text-[var(--muted-foreground)] hover:underline">
            ← {projectQuery.data?.name ?? 'Project'}
          </Link>
          <h1 className="text-lg font-semibold">Test Cases</h1>
        </div>
        <div className="flex gap-2">
          <a
            href={exportUrl(projectId!)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center rounded-md border border-[var(--border)] px-3 text-sm hover:bg-[var(--muted)]"
          >
            Export CSV
          </a>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            Import CSV
          </Button>
          <Button onClick={() => setCreateOpen(true)}>New Test Case</Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--muted)] text-left text-xs text-[var(--muted-foreground)]">
            <tr>
              <th className="px-4 py-2 font-medium">Title</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Priority</th>
              <th className="px-4 py-2 font-medium">Version</th>
              <th className="px-4 py-2 font-medium">Steps</th>
            </tr>
          </thead>
          <tbody>
            {testCasesQuery.data?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-[var(--muted-foreground)]">
                  No test cases yet.
                </td>
              </tr>
            )}
            {testCasesQuery.data?.map((tc) => (
              <tr key={tc.id} className="border-t border-[var(--border)] hover:bg-[var(--muted)]">
                <td className="px-4 py-2">
                  <Link to={`/test-cases/${tc.id}`} className="font-medium underline-offset-2 hover:underline">
                    {tc.title}
                  </Link>
                </td>
                <td className="px-4 py-2">
                  <Badge tone={STATUS_DISPLAY[tc.status].tone}>{STATUS_DISPLAY[tc.status].label}</Badge>
                </td>
                <td className="px-4 py-2">{tc.priority}</td>
                <td className="px-4 py-2">v{tc.version_number}</td>
                <td className="px-4 py-2">{tc.steps.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="New Test Case" className="max-w-2xl">
        <TestCaseForm
          defaultValues={DEFAULT_VALUES}
          submitLabel="Create Test Case"
          isSubmitting={createMutation.isPending}
          serverError={createError}
          onSubmit={(values) => createMutation.mutate(values)}
        />
      </Dialog>

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} projectId={projectId!} />
    </div>
  )
}
