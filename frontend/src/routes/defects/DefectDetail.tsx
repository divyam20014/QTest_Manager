import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bug, Building2, ChevronDown, ChevronRight, FileStack, ListChecks, PlayCircle, Unlink } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { suggestDefectRootCause, type RootCauseSuggestion } from '@/api/ai'
import { ApiError } from '@/api/client'
import {
  deleteDefect,
  getDefect,
  getDefectColumns,
  getDefectHistory,
  getPossibleDuplicates,
  linkTestCase,
  listDefectRetests,
  listDefectTestCases,
  recordRetestResult,
  unlinkTestCase,
  updateDefectRootCause,
  type Defect,
  type DefectStatus,
  type RootCause,
} from '@/api/defects'
import { AttachmentsCard } from '@/components/AttachmentsCard'
import { CommentsCard } from '@/components/CommentsCard'
import { CustomFieldsCard } from '@/components/CustomFieldsCard'
import { HistoryTimeline } from '@/components/HistoryTimeline'
import { MarkdownText } from '@/components/Markdown'
import { MoreActionsMenu } from '@/components/list/MoreActionsMenu'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DropdownMenu } from '@/components/ui/dropdown-menu'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { FormError } from '@/components/ui/form-field'
import { IconButton } from '@/components/ui/icon-button'
import { LevelBadge } from '@/components/ui/LevelBadge'
import { RecordPin } from '@/components/RecordPin'
import { PageHeader } from '@/components/ui/PageHeader'
import { DetailSkeleton } from '@/components/ui/skeleton'
import { Tabs, type TabItem } from '@/components/ui/tabs'
import { useConfirm } from '@/components/ui/useConfirm'
import { quickActions, retestOutcome, retestsAwaitingResult, transitionMenu } from '@/lib/defectWorkflow'
import { formatWhen } from '@/lib/formatWhen'
import { changesOf } from '@/lib/historyChanges'
import { levelTone } from '@/lib/statusTones'
import { useToast } from '@/lib/toast'
import { useCanListUsers } from '@/lib/useCanListUsers'
import { cn } from '@/lib/utils'
import { ExecutionStatusBadge } from '@/routes/testcases/ExecutionStatusBadge'
import { AssignDialog, RetestDialog, StatusChangeDialog,  type ActionDefect } from './DefectActionDialogs'
import { useDefectPermissions } from '@/lib/useDefectPermissions'
import { DefectStatusBadge } from './DefectStatusBadge'
import { TestCasePicker } from './pickers'
import { ROOT_CAUSE_LABEL, severityTone } from './statusDisplay'
import { defectEditPath, defectPath, testCasePath, testRunPath } from '@/lib/entityRoutes'

const HISTORY_ACTION_LABEL: Record<string, string> = {
  'defect.created': 'Defect created',
  'defect.updated': 'Fields updated',
  'defect.status_changed': 'Status changed',
  'defect.assigned': 'Assignee changed',
  'defect.link_added': 'Link added',
  'defect.link_removed': 'Link removed',
  'defect.root_cause_set': 'Root cause set',
  'defect.reopened': 'Reopened',
  'defect.environment_set': 'Environment set',
  'defect.build_release_set': 'Build/Release set',
  'defect.retest_started': 'Retest started',
  'defect.retest_result': 'Retest result recorded',
  'defect.attachment_added': 'Attachment added',
  'defect.attachment_removed': 'Attachment removed',
}

export function DefectDetail() {
  const { defectId } = useParams<{ defectId: string }>()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const navigate = useNavigate()
  const { ask, dialog: confirmDialog } = useConfirm()
  const perms = useDefectPermissions()
  const canListUsers = useCanListUsers()
  const [statusDialog, setStatusDialog] = useState<{ target?: DefectStatus } | null>(null)
  const [assignOpen, setAssignOpen] = useState(false)
  const [retestOpen, setRetestOpen] = useState(false)
  const onMutationError = (err: unknown, fallback: string) => showToast('error', err instanceof ApiError ? err.message : fallback)

  const defectQuery = useQuery({ queryKey: ['defects', 'detail', defectId], queryFn: () => getDefect(defectId!), enabled: !!defectId })
  const catalogQuery = useQuery({ queryKey: ['defects', 'columns'], queryFn: getDefectColumns, staleTime: 5 * 60_000 })
  const historyQuery = useQuery({ queryKey: ['defects', 'history', defectId], queryFn: () => getDefectHistory(defectId!), enabled: !!defectId })
  const duplicatesQuery = useQuery({
    queryKey: ['defects', 'possible-duplicates', defectId],
    queryFn: () => getPossibleDuplicates(defectId!),
    enabled: !!defectId,
  })
  const casesQuery = useQuery({ queryKey: ['defects', 'test-cases', defectId], queryFn: () => listDefectTestCases(defectId!), enabled: !!defectId })
  const retestsQuery = useQuery({ queryKey: ['defects', 'retests', defectId], queryFn: () => listDefectRetests(defectId!), enabled: !!defectId })

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['defects'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    void queryClient.invalidateQueries({ queryKey: ['test-cases'] })
  }

  // ADR-070: soft delete -- leaves every list/report; the record is retained.
  const deleteMutation = useMutation({
    mutationFn: () => deleteDefect(defectId!),
    onSuccess: () => {
      refresh()
      showToast('success', 'Defect deleted')
      navigate('/defects', { replace: true })
    },
    onError: (err) => onMutationError(err, 'Could not delete this defect'),
  })

  const rootCauseMutation = useMutation({
    mutationFn: (rootCause: RootCause | null) => updateDefectRootCause(defectId!, rootCause),
    onSuccess: () => {
      refresh()
      showToast('success', 'Root cause updated')
    },
    onError: (err) => onMutationError(err, 'Could not update root cause'),
  })

  const [aiSuggestion, setAiSuggestion] = useState<RootCauseSuggestion | null>(null)
  const aiSuggestMutation = useMutation({
    mutationFn: () => suggestDefectRootCause(defectId!),
    onSuccess: (data) => setAiSuggestion(data),
  })

  const linkMutation = useMutation({
    mutationFn: (testCaseId: string) => linkTestCase(defectId!, testCaseId),
    onSuccess: () => {
      refresh()
      showToast('success', 'Test case linked')
    },
    onError: (err) => onMutationError(err, 'Could not link the test case'),
  })
  const unlinkMutation = useMutation({
    mutationFn: (testCaseId: string) => unlinkTestCase(defectId!, testCaseId),
    onSuccess: () => {
      refresh()
      showToast('success', 'Test case unlinked')
    },
    onError: (err) => onMutationError(err, 'Could not unlink the test case'),
  })

  const resultMutation = useMutation({
    mutationFn: (v: { result: 'pass' | 'fail'; runCaseId: string }) => recordRetestResult(defectId!, { result: v.result, run_case_id: v.runCaseId }),
    onSuccess: (r) => {
      refresh()
      showToast('success', r.result === 'pass' ? (r.closed ? 'Retest passed: defect closed' : 'Retest passed: defect verified') : 'Retest failed: defect reopened')
    },
    onError: (err) => onMutationError(err, 'Could not record the retest result'),
  })

  const defect = defectQuery.data
  if (defectQuery.isLoading) return <DetailSkeleton />
  if (defectQuery.isError) return <ErrorState message="Could not load this defect." error={defectQuery.error} onRetry={() => defectQuery.refetch()} />
  if (!defect) return <EmptyState title="Defect not found" description="It may have been deleted, or you may not have access to it." />

  const actionDefect: ActionDefect = {
    id: defect.id,
    status: defect.status,
    title: defect.title,
    display_id: defect.display_id,
    resolution: defect.resolution,
    assigned_to: defect.assigned_to,
    reported_by: defect.reported_by,
    project_id: defect.project_id,
  }
  const actions = quickActions(defect.status, perms, catalogQuery.data)
  const menu = transitionMenu(defect.status, perms, catalogQuery.data)
  const retests = retestsQuery.data ?? []
  const awaiting = retestsAwaitingResult(defect.status, retests)
  const locked = defect.status === 'Closed'

  const executionConsoleUrl =
    defect.test_run_case_id && defect.test_run_id ? `/test-run-cases/${defect.test_run_case_id}?runId=${defect.test_run_id}` : null

  const tabs: TabItem[] = [
    {
      key: 'details',
      label: 'Details',
      content: (
        <div className="flex flex-col gap-6">
          <DetailsCard defect={defect} />
          <TraceabilityCard defect={defect} executionConsoleUrl={executionConsoleUrl} />
          {defect.execution_evidence && <EvidenceCard defect={defect} />}
          <RootCauseCard
            defect={defect}
            suggestion={aiSuggestion}
            pending={aiSuggestMutation.isPending}
            error={aiSuggestMutation.isError ? (aiSuggestMutation.error instanceof ApiError ? aiSuggestMutation.error.message : 'The assistant is unavailable.') : null}
            onSuggest={() => aiSuggestMutation.mutate()}
            applying={rootCauseMutation.isPending}
            onApply={(category) => rootCauseMutation.mutate(category as RootCause)}
            canEdit={perms.canEdit}
          />
          <CustomFieldsCard ownerType="defect" ownerId={defect.id} />
        </div>
      ),
    },
    { key: 'steps', label: 'Steps', count: defect.repro_steps?.length ?? 0, content: <StepsCard defect={defect} /> },
    {
      key: 'test-cases',
      label: 'Linked Test Cases',
      count: casesQuery.data?.length ?? defect.linked_test_case_count,
      content: (
        <LinkedCasesTab
          defect={defect}
          cases={casesQuery.data ?? []}
          loading={casesQuery.isLoading}
          canEdit={perms.canEdit}
          busy={linkMutation.isPending || unlinkMutation.isPending}
          onLink={(id) => linkMutation.mutate(id)}
          onUnlink={(tc) =>
            ask({
              title: `Unlink ${tc.display_id ?? 'this test case'}?`,
              description: `The defect and the test case stay as they are; only the link between them is removed. You can link it again later.`,
              confirmLabel: 'Unlink test case',
              run: () => unlinkMutation.mutateAsync(tc.id),
            })
          }
        />
      ),
    },
    {
      key: 'retests',
      label: 'Retests',
      count: retests.length,
      content: (
        <RetestsTab
          defect={defect}
          retests={retests}
          loading={retestsQuery.isLoading}
          canStart={actions.startRetest}
          onStart={() => setRetestOpen(true)}
        />
      ),
    },
    {
      key: 'discussion',
      label: 'Comments & Attachments',
      count: defect.attachment_count,
      content: (
        <div className="flex flex-col gap-6">
          <CommentsCard ownerType="defect" ownerId={defect.id} />
          <AttachmentsCard ownerType="defect" ownerId={defect.id} />
        </div>
      ),
    },
    {
      key: 'history',
      label: 'History',
      content: (
        <HistoryTimeline
          entries={historyQuery.data?.map((e) => ({
            id: e.id,
            action: e.action,
            user_name: e.user_name,
            created_at: e.created_at,
            changes: e.changes && Object.keys(e.changes).length > 0 ? e.changes : changesOf(e.event_metadata),
          }))}
          labels={HISTORY_ACTION_LABEL}
        />
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={
          <Link
            to={`/defects?projectId=${defect.project_id}`}
            className="inline-flex text-xs text-[var(--muted-foreground)] hover:underline max-md:min-h-11 max-md:items-center max-md:text-sm"
          >
            ← Defects
          </Link>
        }
        title={defect.title}
        meta={
          <>
            <RecordPin type="defect" id={defect.id} title={defect.title} url={defectPath(defect.project_id, defect.id)} />
            {defect.display_id && <Badge className="font-mono">{defect.display_id}</Badge>}
            <DefectStatusBadge status={defect.status} label={defect.status_label} />
            <LevelBadge tone={severityTone(defect.severity)}>{defect.severity} severity</LevelBadge>
            <LevelBadge tone={levelTone(defect.priority)}>{defect.priority} priority</LevelBadge>
            {defect.sla_breached && <Badge tone="critical">SLA Breached · {defect.age_days}d</Badge>}
            {defect.reopened_count > 0 && <Badge tone="neutral">Reopened {defect.reopened_count}x</Badge>}
          </>
        }
        actionsClassName="max-md:grid max-md:grid-cols-2 max-md:[&>*]:w-full"
        actions={
          <>
            {perms.canDelete && (
              <MoreActionsMenu
                label="More defect actions"
                items={[
                  {
                    label: 'Delete defect',
                    destructive: true,
                    onSelect: () =>
                      ask({
                        title: `Delete ${defect.display_id ?? 'defect'} "${defect.title}"?`,
                        description:
                          'The defect disappears from the defects list, dashboards and reports. Its history, links and comments are kept in the system but it can no longer be opened from here.',
                        confirmLabel: 'Delete defect',
                        run: () => deleteMutation.mutateAsync(),
                      }),
                  },
                ]}
              />
            )}
            {perms.canAssign && canListUsers && (
              <Button variant="outline" onClick={() => setAssignOpen(true)}>
                Assign
              </Button>
            )}
            {actions.startRetest && (
              <Button variant="outline" onClick={() => setRetestOpen(true)}>
                Start retest
              </Button>
            )}
            {actions.reopen && (
              <Button variant="outline" onClick={() => setStatusDialog({ target: 'Reopened' })}>
                Reopen
              </Button>
            )}
            {actions.close && (
              <Button variant="outline" onClick={() => setStatusDialog({ target: 'Closed' })}>
                Close
              </Button>
            )}
            {actions.changeStatus && (
              <DropdownMenu
                label="Change status"
                items={menu.map((o) => ({
                  label: o.disabledReason ? `${o.status} (needs close permission)` : o.status,
                  disabled: !!o.disabledReason,
                  onSelect: () => setStatusDialog({ target: o.status }),
                }))}
                trigger={(props) => (
                  <Button variant="outline" {...props}>
                    Change status
                    <ChevronDown className="size-4" aria-hidden="true" />
                  </Button>
                )}
              />
            )}
            {perms.canEdit && !locked && (
              <Link to={defectEditPath(defect.project_id, defect.id)} className={buttonVariants({ variant: 'default' })}>
                Edit
              </Link>
            )}
          </>
        }
      />
      {confirmDialog}

      {locked && (
        <p className="rounded-md border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-sm">
          This defect is Closed, so its fields are locked. Reopen it to change them; its history and retests are kept.
        </p>
      )}

      {awaiting.length > 0 && (
        <RetestResultBanner
          defect={defect}
          awaiting={awaiting}
          canRecord={perms.canChangeStatus}
          canClose={perms.canClose}
          pending={resultMutation.isPending}
          onRecord={(result, runCaseId) => resultMutation.mutate({ result, runCaseId })}
        />
      )}
      <FormError>{resultMutation.error instanceof ApiError ? resultMutation.error.message : null}</FormError>

      {(duplicatesQuery.data ?? []).length > 0 && (
        <div className="rounded-md border border-[var(--border)] bg-[var(--muted)] p-3 text-sm">
          <p className="font-medium">Possible duplicates found</p>
          <p className="text-xs text-[var(--muted-foreground)]">This is a suggestion only — nothing is linked or merged automatically.</p>
          <ul className="mt-2 flex flex-col gap-1">
            {duplicatesQuery.data?.map((d) => (
              <li key={d.defect_id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                <Link to={defectPath(defect.project_id, d.defect_id)} className="underline-offset-2 hover:underline">
                  {d.title}
                </Link>
                <span className="text-xs text-[var(--muted-foreground)]">
                  {d.status} · {Math.round(d.similarity)}% similar
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Keyed by the URL's tab so a link to ?tab=retests (after Start retest) opens that tab on this same page. */}
      <Tabs key={searchParams.get('tab') ?? 'details'} defaultKey={searchParams.get('tab') ?? 'details'} items={tabs} />

      <StatusChangeDialog defect={statusDialog ? actionDefect : null} initialTarget={statusDialog?.target} onClose={() => setStatusDialog(null)} />
      <AssignDialog defect={assignOpen ? actionDefect : null} onClose={() => setAssignOpen(false)} />
      <RetestDialog defect={retestOpen ? actionDefect : null} onClose={() => setRetestOpen(false)} />
    </div>
  )
}

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2 lg:col-span-3' : undefined}>
      <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
      <div className="mt-0.5 min-w-0 break-words text-sm">{children}</div>
    </div>
  )
}

const dash = <span className="text-[var(--muted-foreground)]">—</span>

function DetailsCard({ defect }: { defect: Defect }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Bug ID">{defect.display_id ? <span className="font-mono">{defect.display_id}</span> : dash}</Field>
        <Field label="Project">{defect.project_name}</Field>
        <Field label="Component / Module">{defect.module_name ?? dash}</Field>
        <Field label="Task">
          {defect.task_id ? (
            <Link to={`/projects/${defect.project_id}/tasks/${defect.task_id}`} className="underline-offset-2 hover:underline">
              {defect.task_display_id ? `${defect.task_display_id} · ${defect.task_title}` : defect.task_title}
            </Link>
          ) : (
            dash
          )}
        </Field>
        <Field label="Status">
          <DefectStatusBadge status={defect.status} label={defect.status_label} />
        </Field>
        <Field label="Resolution">{defect.resolution ?? dash}</Field>
        <Field label="Severity">
          <LevelBadge tone={severityTone(defect.severity)}>{defect.severity}</LevelBadge>
        </Field>
        <Field label="Priority">
          <LevelBadge tone={levelTone(defect.priority)}>{defect.priority}</LevelBadge>
        </Field>
        <Field label="Reporter">{defect.reported_by_name ?? 'Unknown'}</Field>
        <Field label="Assignee">{defect.assigned_to_name ?? 'Unassigned'}</Field>
        <Field label="Date Reported">{formatWhen(defect.date_reported ?? defect.created_at)}</Field>
        <Field label="Closed">{defect.closed_at ? formatWhen(defect.closed_at) : dash}</Field>
        <Field label="Environment">{defect.environment ?? defect.environment_name ?? dash}</Field>
        <Field label="Build / Version Found">{defect.build_found ?? defect.found_in_build_name ?? dash}</Field>
        <Field label="Fix Version / Target Milestone">{defect.fix_version ?? defect.fixed_in_release_name ?? dash}</Field>
        <Field label="Root Cause">{defect.root_cause ? ROOT_CAUSE_LABEL[defect.root_cause] : 'Uncategorized'}</Field>
        <Field label="Labels / Tags">
          {defect.labels.length === 0 ? (
            dash
          ) : (
            <span className="flex flex-wrap gap-1">
              {defect.labels.map((l) => (
                <Badge key={l}>{l}</Badge>
              ))}
            </span>
          )}
        </Field>
        <Field label="Attachments">{defect.attachment_count === 0 ? dash : `${defect.attachment_count} file${defect.attachment_count === 1 ? '' : 's'}`}</Field>
        <Field label="Description" wide>
          <MarkdownText source={defect.description} empty="No description provided." />
        </Field>
        <Field label="Preconditions" wide>
          <MarkdownText source={defect.preconditions} />
        </Field>
        <Field label="Expected Result" wide>
          <MarkdownText source={defect.expected_result} />
        </Field>
        <Field label="Actual Result" wide>
          <MarkdownText source={defect.actual_result} />
        </Field>
        {defect.root_cause_notes && (
          <Field label="Root Cause Notes" wide>
            <MarkdownText source={defect.root_cause_notes} />
          </Field>
        )}
      </CardContent>
    </Card>
  )
}

function StepsCard({ defect }: { defect: Defect }) {
  const steps = defect.repro_steps ?? []
  return (
    <Card>
      <CardHeader>
        <CardTitle>Steps to Reproduce</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {defect.preconditions && (
          <div>
            <p className="text-xs text-[var(--muted-foreground)]">Preconditions</p>
            <MarkdownText source={defect.preconditions} />
          </div>
        )}
        {steps.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">No steps recorded.</p>
        ) : (
          <ol className="flex flex-col gap-2 text-sm">
            {steps.map((s, i) => (
              <li
                key={`${i}-${s.action}`}
                className={cn('flex flex-col gap-1 rounded-lg border p-3', s.failed ? 'border-[var(--status-serious)]' : 'border-[var(--border)]')}
              >
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  Step {s.step_no ?? i + 1}
                  {s.failed && <Badge tone="critical">Failed here</Badge>}
                </p>
                <p className="whitespace-pre-wrap break-words">{s.action}</p>
                {s.test_data && (
                  <p className="break-words text-xs text-[var(--muted-foreground)]">
                    Test data: <span className="font-mono">{s.test_data}</span>
                  </p>
                )}
                {s.expected_result && <p className="break-words text-xs text-[var(--muted-foreground)]">Expected: {s.expected_result}</p>}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

function LinkedCasesTab({
  defect,
  cases,
  loading,
  canEdit,
  busy,
  onLink,
  onUnlink,
}: {
  defect: Defect
  cases: Awaited<ReturnType<typeof listDefectTestCases>>
  loading: boolean
  canEdit: boolean
  busy: boolean
  onLink: (testCaseId: string) => void
  onUnlink: (tc: { id: string; display_id: string | null }) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Linked Test Cases</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-[var(--muted-foreground)]">
          The test cases this defect was found by or affects. The same links show on each test case's Defects tab.
        </p>
        {canEdit && (
          <div className="max-w-xl">
            <TestCasePicker
              id="defect-link-case"
              projectId={defect.project_id}
              excludeIds={cases.map((c) => c.id)}
              label="Link another test case"
              disabled={busy}
              onPick={(item) => onLink(item.id)}
            />
          </div>
        )}
        {loading ? (
          <p className="text-sm text-[var(--muted-foreground)]">Loading linked test cases…</p>
        ) : cases.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">No test case is linked to this defect yet.</p>
        ) : (
          <div className="relative overflow-x-auto rounded-lg border border-[var(--border)]">
            <table aria-label="Linked test cases" className="w-full text-sm">
              <thead className="bg-[var(--muted)] text-left text-xs text-[var(--muted-foreground)]">
                <tr>
                  {['Test Case ID', 'Title', 'Module', 'Latest execution', 'Date', 'Tester', 'Run', ''].map((h, i) => (
                    <th key={`${h}-${i}`} scope="col" className="px-3 py-2 font-medium">
                      {h || <span className="sr-only">Actions</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.id} className="border-t border-[var(--border)] align-top">
                    <td className="whitespace-nowrap px-3 py-2">
                      <Link to={testCasePath(defect.project_id, c.id)} className="font-mono text-xs underline-offset-2 hover:underline">
                        {c.display_id ?? c.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{c.title}</td>
                    <td className="px-3 py-2">{c.module_path ?? c.module_name ?? dash}</td>
                    <td className="px-3 py-2">
                      <ExecutionStatusBadge status={c.latest_execution_status} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">{formatWhen(c.latest_execution_at)}</td>
                    <td className="px-3 py-2">{c.latest_executed_by_name ?? dash}</td>
                    <td className="px-3 py-2">
                      {c.test_run_id ? (
                        <Link to={testRunPath(defect.project_id, c.test_run_id)} className="underline underline-offset-2">
                          {c.test_run_name ?? 'Run'}
                        </Link>
                      ) : (
                        dash
                      )}
                      {c.raised_from_run_case_id && <span className="block text-xs text-[var(--muted-foreground)]">Raised from this run</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {canEdit && (
                        <IconButton aria-label={`Unlink ${c.display_id ?? c.title}`} disabled={busy} onClick={() => onUnlink(c)}>
                          <Unlink aria-hidden="true" />
                        </IconButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function RetestResultBanner({
  defect,
  awaiting,
  canRecord,
  canClose,
  pending,
  onRecord,
}: {
  defect: Defect
  awaiting: Awaited<ReturnType<typeof listDefectRetests>>
  canRecord: boolean
  canClose: boolean
  pending: boolean
  onRecord: (result: 'pass' | 'fail', runCaseId: string) => void
}) {
  return (
    <section aria-label="Retest result" className="flex flex-col gap-3 rounded-xl border border-[var(--status-info)] bg-[var(--status-info-bg)] p-4">
      <div>
        <h2 className="text-sm font-semibold">A retest has been executed</h2>
        <p className="text-xs text-[var(--muted-foreground)]">
          Record what it showed to move {defect.display_id ?? 'this defect'} on. The retest run is not changed, and every earlier execution stays in
          the history.
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {awaiting.map((r) => {
          const outcome = retestOutcome(r.run_case_status)
          return (
            <li key={r.test_run_case_id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="min-w-0">
                <span className="font-mono text-xs">{r.test_case_display_id ?? ''}</span> {r.test_case_title}{' '}
                <span className="text-xs text-[var(--muted-foreground)]">
                  in {r.test_run_name}: {outcome === 'pass' ? 'Passed' : 'Failed'}
                </span>
              </span>
              {canRecord && outcome === 'pass' && (
                <Button size="sm" loading={pending} onClick={() => onRecord('pass', r.test_run_case_id)}>
                  {canClose ? 'Retest passed: Close' : 'Retest passed: Verify'}
                </Button>
              )}
              {canRecord && outcome === 'fail' && (
                <Button size="sm" variant="destructive" loading={pending} onClick={() => onRecord('fail', r.test_run_case_id)}>
                  Retest failed: Reopen
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function RetestsTab({
  defect,
  retests,
  loading,
  canStart,
  onStart,
}: {
  defect: Defect
  retests: Awaited<ReturnType<typeof listDefectRetests>>
  loading: boolean
  canStart: boolean
  onStart: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Retests</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-[var(--muted-foreground)]">
          Each retest is its own run case in a Retest run, so earlier executions are never overwritten: the original failure and every retest stay
          on record, newest last.
        </p>
        {canStart && (
          <div>
            <Button size="sm" onClick={onStart}>
              Start retest
            </Button>
          </div>
        )}
        {loading ? (
          <p className="text-sm text-[var(--muted-foreground)]">Loading retests…</p>
        ) : retests.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            {defect.status === 'Fixed' ? 'This defect is Fixed. Start a retest to verify the fix.' : 'No retest has been started for this defect.'}
          </p>
        ) : (
          <ol aria-label="Retest timeline" className="flex flex-col gap-3">
            {[...retests]
              .sort((a, b) => a.created_at.localeCompare(b.created_at))
              .map((r) => (
                <li key={r.test_run_case_id} className="flex flex-col gap-1 rounded-lg border border-[var(--border)] p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={testRunPath(defect.project_id, r.test_run_id)} className="font-medium underline-offset-2 hover:underline">
                      {r.test_run_name}
                    </Link>
                    <span className="font-mono text-xs">{r.test_case_display_id ?? ''}</span>
                    <span className="min-w-0 truncate text-xs text-[var(--muted-foreground)]">{r.test_case_title}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      Run case: <ExecutionStatusBadge status={runCaseLabel(r.run_case_status)} />
                    </span>
                    <span>Result recorded: {r.result ? (r.result === 'pass' ? 'Passed' : 'Failed') : 'Not yet'}</span>
                    <span>Tester: {r.executed_by_name ?? r.assigned_to_name ?? '—'}</span>
                    <span>Executed: {formatWhen(r.executed_at)}</span>
                    {r.result_recorded_at && <span>Recorded: {formatWhen(r.result_recorded_at)}</span>}
                    {r.run_case_status !== 'passed' && r.run_case_status !== 'failed' && (
                      <Link to={`/test-run-cases/${r.test_run_case_id}?runId=${r.test_run_id}`} className="text-[var(--link)] underline underline-offset-2">
                        Open in Execution Console
                      </Link>
                    )}
                  </div>
                </li>
              ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

/** Run case status as the execution-status words (passed -> Pass ...), reusing the execution pill. */
function runCaseLabel(status: string): string {
  const map: Record<string, string> = { passed: 'Pass', failed: 'Fail', blocked: 'Blocked', ignored: 'Skipped' }
  return map[status] ?? 'Not Run'
}

function TraceabilityCard({ defect, executionConsoleUrl }: { defect: Defect; executionConsoleUrl: string | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Traceability</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-stretch gap-2 md:flex-row md:flex-wrap md:items-center">
          <TraceNode icon={Building2} label="Project" value={defect.project_name} to={`/projects/${defect.project_id}`} />
          <TraceArrow />
          <TraceNode
            icon={FileStack}
            label="Test Case"
            value={defect.test_case_title}
            sub={defect.test_case_version_number !== null ? `v${defect.test_case_version_number}` : undefined}
            to={defect.test_case_id ? testCasePath(defect.project_id, defect.test_case_id) : null}
          />
          <TraceArrow />
          <TraceNode icon={PlayCircle} label="Test Run" value={defect.test_run_name} to={defect.test_run_id ? testRunPath(defect.project_id, defect.test_run_id) : null} />
          <TraceArrow />
          <TraceNode
            icon={ListChecks}
            label="Failed Step"
            value={defect.step_number !== null ? `Step ${defect.step_number}` : null}
            to={executionConsoleUrl}
          />
          <TraceArrow />
          <TraceNode icon={Bug} label="Defect" value={defect.title} current />
        </div>
      </CardContent>
    </Card>
  )
}

function EvidenceCard({ defect }: { defect: Defect }) {
  const e = defect.execution_evidence
  if (!e) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Execution Evidence</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-[var(--muted-foreground)]">Verdict</dt>
          <dd>{e.verdict ?? '—'}</dd>
          <dt className="text-[var(--muted-foreground)]">Opened</dt>
          <dd>{e.opened_at ? new Date(e.opened_at).toLocaleString() : '—'}</dd>
          <dt className="text-[var(--muted-foreground)]">Closed</dt>
          <dd>{e.closed_at ? new Date(e.closed_at).toLocaleString() : '—'}</dd>
          <dt className="text-[var(--muted-foreground)]">Duration</dt>
          <dd>{e.duration_ms !== null ? `${e.duration_ms}ms` : '—'}</dd>
          <dt className="text-[var(--muted-foreground)]">Executed By</dt>
          <dd>{e.executed_by_name ?? '—'}</dd>
        </dl>
      </CardContent>
    </Card>
  )
}

function RootCauseCard({
  defect,
  suggestion,
  pending,
  error,
  onSuggest,
  applying,
  onApply,
  canEdit,
}: {
  defect: Defect
  suggestion: RootCauseSuggestion | null
  pending: boolean
  error: string | null
  onSuggest: () => void
  applying: boolean
  onApply: (category: string) => void
  canEdit: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Suggestion</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-xs text-[var(--muted-foreground)]">
            Suggestion only — never applied automatically. AI-generated, verify independently. Current root cause:{' '}
            {defect.root_cause ? ROOT_CAUSE_LABEL[defect.root_cause] : 'Uncategorized'}.
          </p>
          <Button type="button" variant="outline" size="sm" className="self-start" disabled={pending} onClick={onSuggest}>
            {pending ? 'Thinking…' : 'Suggest Root Cause'}
          </Button>
          {error && <p className="text-xs text-[var(--destructive)]">{error}</p>}
          {suggestion && (
            <div className="flex flex-col gap-2 rounded-lg border border-[var(--border)] p-3">
              <p className="text-xs">
                <span className="font-medium">Suggested category:</span>{' '}
                {ROOT_CAUSE_LABEL[suggestion.category as keyof typeof ROOT_CAUSE_LABEL] ?? suggestion.category}
              </p>
              <p className="text-xs text-[var(--muted-foreground)]">{suggestion.reasoning}</p>
              <p className="text-xs">
                <span className="font-medium">Next steps:</span> {suggestion.next_steps}
              </p>
              {canEdit && (
                <Button type="button" size="sm" className="self-start" disabled={applying} onClick={() => onApply(suggestion.category)}>
                  Apply this category
                </Button>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function TraceArrow() {
  return <ChevronRight className="hidden size-4 shrink-0 self-center text-[var(--muted-foreground)] md:block" aria-hidden="true" />
}

function TraceNode({
  icon: Icon,
  label,
  value,
  sub,
  to,
  current,
}: {
  icon: typeof Bug
  label: string
  value: string | null | undefined
  sub?: string
  to?: string | null
  current?: boolean
}) {
  const content = (
    <div
      className={cn(
        'flex min-w-0 flex-1 items-center gap-2.5 rounded-md border px-3 py-2 md:flex-none md:basis-44',
        current ? 'border-[var(--brand)] bg-[var(--brand-muted)]' : 'border-[var(--border)]',
        to && 'hover:bg-[var(--muted)]',
      )}
    >
      <Icon className="size-4 shrink-0 text-[var(--muted-foreground)]" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">{label}</p>
        <p className="truncate text-sm font-medium">{value ?? '—'}</p>
        {sub && <p className="text-xs text-[var(--muted-foreground)]">{sub}</p>}
      </div>
    </div>
  )
  if (to && value) {
    return (
      <Link to={to} className="block min-w-0 md:flex-none">
        {content}
      </Link>
    )
  }
  return content
}
