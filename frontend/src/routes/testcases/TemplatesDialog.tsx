import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError } from '@/api/client'
import { importTemplates, listTemplates } from '@/api/templates'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { useToast } from '@/lib/toast'

// Tier 5 / ADR-055 / PV-10.1: Insurance QA Pack -- a small, generic
// template library (Claims/Underwriting/Policy Admin). Importing creates
// real TestCase rows via the same create path a hand-authored test case
// uses, organized into a same-named Module per category. Re-importing the
// same templates creates a fresh copy rather than being silently skipped.
export function TemplatesDialog({
  open,
  onClose,
  projectId,
}: {
  open: boolean
  onClose: () => void
  projectId: string
}) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const { show: showToast } = useToast()

  const templatesQuery = useQuery({
    queryKey: ['templates'],
    queryFn: listTemplates,
    enabled: open,
  })

  const importMutation = useMutation({
    mutationFn: () => importTemplates(projectId, Array.from(selected)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-cases', projectId] })
      queryClient.invalidateQueries({ queryKey: ['modules', projectId] })
      const count = selected.size
      setSelected(new Set())
      onClose()
      showToast('success', `${count} template${count === 1 ? '' : 's'} imported`)
    },
    // No onError toast -- `serverError` below already renders this inline.
  })

  const serverError = importMutation.error instanceof ApiError ? importMutation.error.message : null

  const byCategory = new Map<string, typeof templatesQuery.data>()
  for (const t of templatesQuery.data ?? []) {
    const list = byCategory.get(t.category) ?? []
    list.push(t)
    byCategory.set(t.category, list)
  }

  return (
    <Dialog open={open} onClose={onClose} title="Import Insurance QA Pack Templates" className="max-w-2xl">
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-xs text-[var(--muted-foreground)]">
          Generic starting-point test cases for common insurance QA scenarios. Select the ones you
          want — each becomes a real, editable test case in this project, grouped by category.
        </p>
        <div className="flex max-h-96 flex-col gap-4 overflow-y-auto">
          {Array.from(byCategory.entries()).map(([category, templates]) => (
            <div key={category} className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-[var(--muted-foreground)]">{category}</p>
              {templates?.map((t) => (
                <label key={t.id} className="flex items-start gap-2 rounded border border-[var(--border)] p-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selected.has(t.id)}
                    onChange={(e) => {
                      setSelected((prev) => {
                        const next = new Set(prev)
                        if (e.target.checked) next.add(t.id)
                        else next.delete(t.id)
                        return next
                      })
                    }}
                  />
                  <div>
                    <p className="font-medium">{t.title}</p>
                    <p className="text-xs text-[var(--muted-foreground)]">{t.description}</p>
                    <Badge tone="neutral">{t.priority}</Badge>
                  </div>
                </label>
              ))}
            </div>
          ))}
        </div>
        {serverError && <p className="text-xs text-[var(--destructive)]">{serverError}</p>}
        <div className="flex items-center gap-3">
          <Button
            type="button"
            disabled={selected.size === 0 || importMutation.isPending}
            onClick={() => importMutation.mutate()}
          >
            {importMutation.isPending ? 'Importing…' : `Import ${selected.size || ''} Template(s)`}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
