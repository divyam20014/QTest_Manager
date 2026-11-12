import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  addDataSetRow,
  createDataSet,
  deleteDataSet,
  deleteDataSetRow,
  listDataSets,
} from '@/api/testDataSets'
import { ApiError } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useToast } from '@/lib/toast'

// Pass 5 item 2 (parameterized execution): lets a test case be executed
// multiple times with different input data. Distinct from Tier 2's
// synthetic test-data generation/masking utility -- this is about
// *parameterized execution*, not seeding an environment.
export function TestDataSetsCard({ testCaseId }: { testCaseId: string }) {
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const queryKey = ['test-data-sets', testCaseId]
  const [newSetName, setNewSetName] = useState('')
  const [rowDrafts, setRowDrafts] = useState<Record<string, { name: string; json: string }>>({})

  const dataSetsQuery = useQuery({ queryKey, queryFn: () => listDataSets(testCaseId) })

  const createSetMutation = useMutation({
    mutationFn: (name: string) => createDataSet(testCaseId, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      setNewSetName('')
      showToast('success', 'Data set created.')
    },
    onError: (error) => {
      showToast('error', error instanceof ApiError ? error.message : 'Failed to create data set.')
    },
  })

  const deleteSetMutation = useMutation({
    mutationFn: (id: string) => deleteDataSet(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      showToast('success', 'Data set deleted.')
    },
  })

  const addRowMutation = useMutation({
    mutationFn: ({ setId, name, data }: { setId: string; name: string; data: Record<string, unknown> }) =>
      addDataSetRow(setId, name, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      showToast('success', 'Row added.')
    },
    onError: (error) => {
      showToast(
        'error',
        error instanceof ApiError ? error.message : 'Failed to add row (check JSON syntax).',
      )
    },
  })

  const deleteRowMutation = useMutation({
    mutationFn: (rowId: string) => deleteDataSetRow(rowId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Test Data Sets</CardTitle>
        <p className="text-xs text-[var(--muted-foreground)]">
          Run this test case repeatedly with different input data (e.g. valid vs. invalid
          credentials) &mdash; each selected row becomes its own execution when added to a run.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <div className="flex gap-2">
          <Input
            placeholder="New data set name (e.g. Login edge cases)"
            value={newSetName}
            onChange={(e) => setNewSetName(e.target.value)}
          />
          <Button
            size="sm"
            disabled={!newSetName.trim() || createSetMutation.isPending}
            onClick={() => createSetMutation.mutate(newSetName.trim())}
          >
            Add Set
          </Button>
        </div>

        {dataSetsQuery.data?.map((ds) => (
          <div key={ds.id} className="rounded-md border border-[var(--border)] p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-medium">{ds.name}</span>
              <Button variant="outline" size="sm" onClick={() => deleteSetMutation.mutate(ds.id)}>
                Delete Set
              </Button>
            </div>
            <ul className="mb-2 flex flex-col gap-1">
              {ds.rows.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-2 rounded bg-[var(--muted)] px-2 py-1"
                >
                  <span className="font-mono text-xs">
                    {row.name}: {JSON.stringify(row.data)}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => deleteRowMutation.mutate(row.id)}>
                    Remove
                  </Button>
                </li>
              ))}
              {ds.rows.length === 0 && (
                <li className="text-xs text-[var(--muted-foreground)]">No rows yet.</li>
              )}
            </ul>
            <div className="flex gap-2">
              <Input
                placeholder="Row name"
                className="w-32"
                value={rowDrafts[ds.id]?.name ?? ''}
                onChange={(e) =>
                  setRowDrafts((prev) => ({
                    ...prev,
                    [ds.id]: { name: e.target.value, json: prev[ds.id]?.json ?? '' },
                  }))
                }
              />
              <Input
                placeholder='{"username": "admin", "password": "wrong"}'
                value={rowDrafts[ds.id]?.json ?? ''}
                onChange={(e) =>
                  setRowDrafts((prev) => ({
                    ...prev,
                    [ds.id]: { name: prev[ds.id]?.name ?? '', json: e.target.value },
                  }))
                }
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!rowDrafts[ds.id]?.name || addRowMutation.isPending}
                onClick={() => {
                  const draft = rowDrafts[ds.id]
                  let data: Record<string, unknown> = {}
                  try {
                    data = draft.json ? JSON.parse(draft.json) : {}
                  } catch {
                    showToast('error', 'Row data must be valid JSON.')
                    return
                  }
                  addRowMutation.mutate({ setId: ds.id, name: draft.name, data })
                  setRowDrafts((prev) => ({ ...prev, [ds.id]: { name: '', json: '' } }))
                }}
              >
                Add Row
              </Button>
            </div>
          </div>
        ))}
        {dataSetsQuery.data?.length === 0 && (
          <p className="text-xs text-[var(--muted-foreground)]">
            No data sets yet &mdash; add one to run this test case with multiple input variations.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
