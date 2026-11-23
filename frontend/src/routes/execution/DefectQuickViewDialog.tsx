import { Link } from 'react-router-dom'

import type { Defect } from '@/api/defects'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { DefectStatusBadge } from '@/routes/defects/DefectStatusBadge'
import { severityTone } from '@/routes/defects/statusDisplay'

// BRD FR-EXEC-04: a tester who sees a defect pill on a step can inspect the
// defect without leaving the Execution Console (and losing their place in
// the run). Read-only; everything shown comes from the defect list the
// console has already loaded for this run, so opening it costs no request.
// Triage (status changes, linking, comments) stays on the defect page.
export function DefectQuickViewDialog({ defect, onClose }: { defect: Defect | null; onClose: () => void }) {
  return (
    <Dialog open={defect !== null} onClose={onClose} title="Defect details">
      {defect && (
        <div className="flex flex-col gap-4 text-sm">
          <div className="flex flex-col gap-2">
            <p className="break-words text-base font-semibold">{defect.title}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge tone={severityTone(defect.severity)}>Severity: {defect.severity}</StatusBadge>
              <DefectStatusBadge status={defect.status} label={`Status: ${defect.status_label}`} />
            </div>
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <QuickViewRow label="Reported by" value={defect.reported_by_name ?? 'Unknown'} />
            <QuickViewRow label="Reported" value={new Date(defect.created_at).toLocaleString()} />
            <QuickViewRow label="Test case" value={defect.test_case_title ?? '—'} />
            <QuickViewRow
              label="Step"
              value={defect.step_number !== null ? `Step ${defect.step_number}` : 'Not tied to a step'}
            />
            <QuickViewRow label="Test run" value={defect.test_run_name ?? '—'} />
            <QuickViewRow label="Assigned to" value={defect.assigned_to_name ?? 'Unassigned'} />
          </dl>

          <div className="flex flex-col gap-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              Description
            </p>
            <p className="whitespace-pre-wrap break-words">
              {defect.description?.trim() ? defect.description : 'No description was entered.'}
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
            <Link to={`/defects/${defect.id}`} className={buttonVariants({ className: 'max-md:flex-1' })}>
              Open in Defects
            </Link>
          </DialogFooter>
        </div>
      )}
    </Dialog>
  )
}

function QuickViewRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-[var(--muted-foreground)]">{label}</dt>
      <dd className="min-w-0 break-words font-medium">{value}</dd>
    </>
  )
}
