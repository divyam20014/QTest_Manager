import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  createSharedStep,
  deleteSharedStep,
  listSharedSteps,
  updateSharedStep,
  type SharedStep,
} from '@/api/sharedSteps'
import { ApiError } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/lib/toast'

const EMPTY = { name: '', action: '', expected: '', category: '' }

// Pass 5: a reusable step-template library, scoped to the project.
// Deliberately copy-on-insert, not a live reference -- editing an entry
// here never retroactively changes a test case that already copied from
// it (see backend/app/models/shared_step.py for the full reasoning). This
// dialog manages the library itself; "Insert from library" in
// TestCaseForm is where a copy actually gets made.
export function SharedStepsDialog({
  open,
  onClose,
  projectId,
}: {
  open: boolean
  onClose: () => void
  projectId: string
}) {
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const [editing, setEditing] = useState<SharedStep | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [showForm, setShowForm] = useState(false)

  const stepsQuery = useQuery({
    queryKey: ['shared-steps', projectId],
    queryFn: () => listSharedSteps(projectId),
    enabled: open,
  })

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['shared-steps', projectId] })
  }

  const createMutation = useMutation({
    mutationFn: () =>
      createSharedStep(projectId, {
        name: form.name,
        action: form.action,
        expected: form.expected,
        category: form.category || null,
      }),
    onSuccess: () => {
      invalidate()
      setForm(EMPTY)
      setShowForm(false)
      showToast('success', 'Shared step created')
    },
    onError: () => showToast('error', 'Could not create shared step'),
  })

  const updateMutation = useMutation({
    mutationFn: () =>
      updateSharedStep(editing!.id, {
        name: form.name,
        action: form.action,
        expected: form.expected,
        category: form.category || null,
      }),
    onSuccess: () => {
      invalidate()
      setEditing(null)
      setForm(EMPTY)
      setShowForm(false)
      showToast('success', 'Shared step updated')
    },
    onError: () => showToast('error', 'Could not update shared step'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSharedStep(id),
    onSuccess: () => {
      invalidate()
      showToast('success', 'Shared step deleted')
    },
    onError: () => showToast('error', 'Could not delete shared step'),
  })

  const serverError =
    (createMutation.error instanceof ApiError && createMutation.error.message) ||
    (updateMutation.error instanceof ApiError && updateMutation.error.message) ||
    null

  function startEdit(step: SharedStep) {
    setEditing(step)
    setForm({
      name: step.name,
      action: step.action,
      expected: step.expected,
      category: step.category ?? '',
    })
    setShowForm(true)
  }

  function startCreate() {
    setEditing(null)
    setForm(EMPTY)
    setShowForm(true)
  }

  return (
    <Dialog open={open} onClose={onClose} title="Shared Steps Library" className="max-w-2xl">
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-xs text-[var(--muted-foreground)]">
          A reusable library of common steps for this project. Inserting a step into a test case
          copies its current text — editing an entry here later never changes a test case that
          already used it.
        </p>

        <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
          {(stepsQuery.data ?? []).map((step) => (
            <div
              key={step.id}
              className="flex items-start justify-between gap-2 rounded border border-[var(--border)] p-2"
            >
              <div>
                <p className="font-medium">
                  {step.name} {step.category && <Badge tone="neutral">{step.category}</Badge>}
                </p>
                <p className="text-xs text-[var(--muted-foreground)]">{step.action}</p>
                <p className="text-xs text-[var(--muted-foreground)]">→ {step.expected}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button type="button" variant="ghost" size="sm" onClick={() => startEdit(step)}>
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteMutation.mutate(step.id)}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
          {stepsQuery.data?.length === 0 && (
            <p className="text-xs text-[var(--muted-foreground)]">No shared steps yet.</p>
          )}
        </div>

        {showForm ? (
          <div className="flex flex-col gap-2 rounded border border-[var(--border)] p-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ss-name">Name</Label>
              <Input
                id="ss-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ss-category">Category (optional)</Label>
              <Input
                id="ss-category"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ss-action">Action</Label>
              <Textarea
                id="ss-action"
                value={form.action}
                onChange={(e) => setForm({ ...form, action: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ss-expected">Expected outcome</Label>
              <Textarea
                id="ss-expected"
                value={form.expected}
                onChange={(e) => setForm({ ...form, expected: e.target.value })}
              />
            </div>
            {serverError && <p className="text-xs text-[var(--destructive)]">{serverError}</p>}
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={
                  !form.name ||
                  !form.action ||
                  !form.expected ||
                  createMutation.isPending ||
                  updateMutation.isPending
                }
                onClick={() => (editing ? updateMutation.mutate() : createMutation.mutate())}
              >
                {editing ? 'Save' : 'Create'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowForm(false)
                  setEditing(null)
                  setForm(EMPTY)
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={startCreate}>
            New Shared Step
          </Button>
        )}
      </div>
    </Dialog>
  )
}
