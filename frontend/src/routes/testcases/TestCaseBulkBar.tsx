import { useState } from 'react'

import { assignModule, bulkUpdateTestCases, quarantineTestCase, unquarantineTestCase } from '@/api/testCases'
import type { TestModule } from '@/api/modules'
import type { User } from '@/api/users'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { FormField } from '@/components/ui/form-field'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { failureReason, runLimited, summarizeOutcomes, type BulkItemOutcome } from '@/lib/bulkActions'
import { useToast } from '@/lib/toast'

// ADR-105: the Test Cases bulk action bar. Priority/assignee use the ADR-070
// bulk endpoint; module and quarantine call the existing per-item endpoints
// three at a time. There is deliberately no bulk delete.

export interface BulkSelectedCase {
  title: string
  quarantined: boolean
}

type Kind = 'assign' | 'priority' | 'module' | 'quarantine'

const DIALOG_TITLE: Record<Kind, string> = {
  assign: 'Assign selected test cases',
  priority: 'Change priority',
  module: 'Move to module',
  quarantine: 'Quarantine selected test cases',
}

export function TestCaseBulkBar({
  selected,
  priorities,
  users,
  modules,
  canEdit,
  canQuarantine,
  onClear,
  onFinished,
}: {
  selected: Map<string, BulkSelectedCase>
  priorities: { code: string; label: string }[]
  /** null when the viewer cannot list users (Assign is then hidden). */
  users: User[] | null
  modules: TestModule[]
  canEdit: boolean
  canQuarantine: boolean
  onClear: () => void
  /** Called with the ids that failed so they stay selected for a retry. */
  onFinished: (failedIds: string[]) => void
}) {
  const [kind, setKind] = useState<Kind | null>(null)
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const { show } = useToast()
  const count = selected.size
  const ids = [...selected.keys()]
  const quarantinedIds = ids.filter((id) => selected.get(id)?.quarantined)
  const activeIds = ids.filter((id) => !selected.get(id)?.quarantined)

  function open(next: Kind) {
    setValue('')
    setReason('')
    setKind(next)
  }

  function finish(outcomes: BulkItemOutcome[], verb: string) {
    const { message, failed } = summarizeOutcomes(outcomes, verb)
    show(failed > 0 ? 'error' : 'success', message)
    setKind(null)
    onFinished(outcomes.filter((o) => !o.ok).map((o) => o.id))
  }

  async function viaBulkEndpoint(body: { priority?: string; assignee_id?: string | null }) {
    try {
      const res = await bulkUpdateTestCases({ test_case_ids: ids, ...body })
      return res.results.map((r) => ({ id: r.test_case_id, ok: r.ok, error: r.error }))
    } catch (err) {
      return ids.map((id) => ({ id, ok: false, error: failureReason(err) }))
    }
  }

  async function apply() {
    if (!kind) return
    setBusy(true)
    try {
      if (kind === 'priority') finish(await viaBulkEndpoint({ priority: value }), 'updated')
      else if (kind === 'assign') finish(await viaBulkEndpoint({ assignee_id: value === '' ? null : value }), 'updated')
      else if (kind === 'module') finish(await runLimited(ids, (id) => assignModule(id, value || null)), 'moved')
      else finish(await runLimited(activeIds, (id) => quarantineTestCase(id, reason.trim())), 'quarantined')
    } finally {
      setBusy(false)
    }
  }

  async function unquarantine() {
    setBusy(true)
    try {
      finish(await runLimited(quarantinedIds, (id) => unquarantineTestCase(id)), 'unquarantined')
    } finally {
      setBusy(false)
    }
  }

  const btn = 'max-md:min-h-11'
  const dialogCount = kind === 'quarantine' ? activeIds.length : count
  const valid =
    kind === 'quarantine'
      ? reason.trim().length >= 3 && reason.trim().length <= 500 && activeIds.length > 0
      : kind === 'priority'
        ? value !== ''
        : true

  return (
    <>
      <div
        role="region"
        aria-label="Bulk actions"
        className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 flex flex-wrap items-center gap-2 border-t border-[var(--border)] bg-[var(--background)] px-4 py-2 shadow-lg md:sticky md:inset-x-auto md:bottom-4 md:rounded-lg md:border"
      >
        <span role="status" aria-live="polite" className="mr-auto text-sm font-medium">
          {count} selected
        </span>
        {canEdit && users && (
          <Button variant="outline" size="sm" className={btn} onClick={() => open('assign')}>
            Assign
          </Button>
        )}
        {canEdit && (
          <Button variant="outline" size="sm" className={btn} onClick={() => open('priority')}>
            Change priority
          </Button>
        )}
        {canEdit && (
          <Button variant="outline" size="sm" className={btn} onClick={() => open('module')}>
            Move to module
          </Button>
        )}
        {canQuarantine && activeIds.length > 0 && (
          <Button variant="outline" size="sm" className={btn} onClick={() => open('quarantine')}>
            Quarantine
          </Button>
        )}
        {canQuarantine && quarantinedIds.length > 0 && (
          <Button variant="outline" size="sm" className={btn} disabled={busy} onClick={unquarantine}>
            Unquarantine
          </Button>
        )}
        <Button variant="ghost" size="sm" className={btn} onClick={onClear}>
          Clear
        </Button>
      </div>

      <Dialog open={kind !== null} onClose={() => !busy && setKind(null)} title={kind ? DIALOG_TITLE[kind] : ''}>
        <div className="flex flex-col gap-4 text-sm">
          <p className="text-[var(--muted-foreground)]">
            Applies to {dialogCount} selected test case{dialogCount === 1 ? '' : 's'}. Each change is audited; cases you
            cannot change are reported afterwards and stay selected.
          </p>
          {kind === 'priority' && (
            <FormField id="bulk-priority" label="Priority" required>
              {(field) => (
                <Select {...field} value={value} onChange={(e) => setValue(e.target.value)}>
                  <option value="">Choose…</option>
                  {priorities.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          )}
          {kind === 'assign' && (
            <FormField id="bulk-assignee" label="Assignee">
              {(field) => (
                <Select {...field} value={value} onChange={(e) => setValue(e.target.value)}>
                  <option value="">Unassigned</option>
                  {(users ?? [])
                    .filter((u) => u.is_active)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                </Select>
              )}
            </FormField>
          )}
          {kind === 'module' && (
            <FormField id="bulk-module" label="Module">
              {(field) => (
                <Select {...field} value={value} onChange={(e) => setValue(e.target.value)}>
                  <option value="">Ungrouped</option>
                  {modules.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          )}
          {kind === 'quarantine' && (
            <FormField id="bulk-quarantine-reason" label="Reason (3 to 500 characters)" required>
              {(field) => (
                <Textarea
                  {...field}
                  value={reason}
                  maxLength={500}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Fails intermittently on the payment sandbox"
                />
              )}
            </FormField>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setKind(null)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={apply} disabled={!valid || busy}>
              {busy ? 'Applying…' : 'Apply'}
            </Button>
          </DialogFooter>
        </div>
      </Dialog>
    </>
  )
}
