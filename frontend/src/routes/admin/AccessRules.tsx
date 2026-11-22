import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  type AccessRule,
  type AccessRuleInput,
  type AccessRuleType,
  createAccessRule,
  deleteAccessRule,
  listAccessRules,
  updateAccessRule,
} from '@/api/accessRules'
import { ApiError } from '@/api/client'
import { listProjects } from '@/api/projects'
import { listEnvironments } from '@/api/testAssets'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { FormError, FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/PageHeader'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useConfirm } from '@/components/ui/useConfirm'
import { formatRuleInstant, fromLocalInputValue, toLocalInputValue } from '@/lib/accessRuleTime'
import { useToast } from '@/lib/toast'
import { AccessControlTabs } from './AccessControlTabs'

// RBAC Phase 4 (ADR-092): release-freeze windows and restricted environments.
// Off by default -- with no rules nothing changes for anyone. Admin is always
// exempt, so the rule can always be lifted from this screen.

/** Action groups offered in the form: each maps to a real permission-code prefix. */
const ACTION_GROUPS: ReadonlyArray<{ prefix: string; label: string }> = [
  { prefix: 'testcase', label: 'Test cases (create, edit, approve, import)' },
  { prefix: 'testrun', label: 'Test runs (create, finish, delete)' },
  { prefix: 'executionstep', label: 'Recording execution results' },
  { prefix: 'defect', label: 'Defects (log, edit, close)' },
  { prefix: 'requirement', label: 'Requirements' },
]

const TYPE_LABELS: Record<AccessRuleType, string> = {
  freeze_window: 'Freeze window',
  environment_restriction: 'Environment restriction',
}

function ruleState(rule: AccessRule, now: number): { label: string; tone: 'positive' | 'warning' | 'neutral' } {
  if (!rule.enabled) return { label: 'Disabled', tone: 'neutral' }
  const start = rule.starts_at ? new Date(rule.starts_at).getTime() : null
  const end = rule.ends_at ? new Date(rule.ends_at).getTime() : null
  const inWindow = (start === null || now >= start) && (end === null || now < end)
  if (rule.rule_type === 'freeze_window') {
    if (inWindow) return { label: 'Active now', tone: 'warning' }
    return {
      label: end !== null && now >= end ? 'Ended' : 'Scheduled',
      tone: 'neutral',
    }
  }
  return start === null && end === null
    ? { label: 'Always restricted', tone: 'warning' }
    : {
        label: inWindow ? 'Allowed now' : 'Restricted now',
        tone: inWindow ? 'positive' : 'warning',
      }
}

export function AccessRules() {
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const { ask, dialog: confirmDialog } = useConfirm()
  const [editing, setEditing] = useState<AccessRule | 'new' | null>(null)

  const rulesQuery = useQuery({
    queryKey: ['access-rules'],
    queryFn: listAccessRules,
  })
  const projectsQuery = useQuery({
    queryKey: ['projects', 'access-rules-picker'],
    queryFn: () => listProjects({ page_size: 100 }),
  })
  const projectName = (id: string | null) =>
    id === null ? 'All projects' : (projectsQuery.data?.items.find((p) => p.id === id)?.name ?? 'One project')

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['access-rules'] })
  }

  const toggleMutation = useMutation({
    mutationFn: (rule: AccessRule) => updateAccessRule(rule.id, { enabled: !rule.enabled }),
    onSuccess: (rule) => {
      refresh()
      showToast('success', rule.enabled ? 'Rule enabled' : 'Rule disabled')
    },
    onError: (error) => showToast('error', error instanceof ApiError ? error.message : 'Could not update that rule'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAccessRule(id),
    onSuccess: () => {
      refresh()
      showToast('success', 'Rule deleted')
    },
    onError: () => showToast('error', 'Could not delete that rule'),
  })

  const rules = rulesQuery.data ?? []
  const [now] = useState(() => Date.now())

  return (
    <div className="flex flex-col gap-4">
      <AccessControlTabs />
      <PageHeader
        title="Access rules"
        description="Block changes during a release freeze, or restrict who can act on an environment. Nothing is restricted until you add a rule; Admins are always exempt."
        actions={
          <Button size="sm" onClick={() => setEditing('new')}>
            New rule
          </Button>
        }
      />
      {confirmDialog}
      <p className="text-xs text-[var(--muted-foreground)]">
        Times follow the server clock in UTC. They are shown here in your local time (
        {Intl.DateTimeFormat().resolvedOptions().timeZone}) with the UTC time alongside.
      </p>

      {rulesQuery.isLoading && (
        <div role="status" aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">Loading access rules</span>
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}

      {rulesQuery.isError && (
        <Card>
          <ErrorState
            error={rulesQuery.error}
            message={rulesQuery.error instanceof ApiError ? rulesQuery.error.message : 'Could not load rules'}
            onRetry={() => rulesQuery.refetch()}
          />
        </Card>
      )}

      {rulesQuery.isSuccess && rules.length === 0 && (
        <Card>
          <EmptyState
            title="No access rules yet"
            description="Everyone can work as usual. Add a rule to block changes during a release freeze or limit who acts on an environment."
            action={
              <Button size="sm" onClick={() => setEditing('new')}>
                Add your first rule
              </Button>
            }
          />
        </Card>
      )}

      <ul className="flex flex-col gap-3">
        {rules.map((rule) => {
          const state = ruleState(rule, now)
          return (
            <li key={rule.id}>
              <Card>
                <CardContent className="flex flex-col gap-3 py-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold">{rule.name}</h2>
                    <Badge tone="info">{TYPE_LABELS[rule.rule_type]}</Badge>
                    <Badge tone={state.tone}>{state.label}</Badge>
                  </div>
                  <dl className="grid gap-x-6 gap-y-1 text-[var(--muted-foreground)] sm:grid-cols-2">
                    <div>
                      <dt className="inline font-medium text-[var(--foreground)]">Scope: </dt>
                      <dd className="inline">
                        {projectName(rule.project_id)}
                        {rule.environment ? `, environment ${rule.environment}` : ''}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline font-medium text-[var(--foreground)]">Blocks: </dt>
                      <dd className="inline">{rule.blocked_actions.join(', ')}</dd>
                    </div>
                    {(rule.starts_at || rule.ends_at) && (
                      <div className="sm:col-span-2">
                        <dt className="inline font-medium text-[var(--foreground)]">
                          {rule.rule_type === 'freeze_window' ? 'Window: ' : 'Allowed window: '}
                        </dt>
                        <dd className="inline">
                          {rule.starts_at ? formatRuleInstant(rule.starts_at) : '…'} to{' '}
                          {rule.ends_at ? formatRuleInstant(rule.ends_at) : '…'}
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt className="inline font-medium text-[var(--foreground)]">Exempt: </dt>
                      <dd className="inline">{rule.exempt_roles.join(', ')}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="inline font-medium text-[var(--foreground)]">Message shown: </dt>
                      <dd className="inline">{rule.reason}</dd>
                    </div>
                  </dl>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="max-md:min-h-11"
                      aria-pressed={rule.enabled}
                      aria-label={`${rule.enabled ? 'Disable' : 'Enable'} rule ${rule.name}`}
                      disabled={toggleMutation.isPending}
                      onClick={() => toggleMutation.mutate(rule)}
                    >
                      {rule.enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="max-md:min-h-11"
                      aria-label={`Edit rule ${rule.name}`}
                      onClick={() => setEditing(rule)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="max-md:min-h-11"
                      aria-label={`Delete rule ${rule.name}`}
                      onClick={() =>
                        ask({
                          title: `Delete rule “${rule.name}”?`,
                          description:
                            'The restriction stops applying immediately. This cannot be undone; you can disable the rule instead to keep it.',
                          confirmLabel: 'Delete rule',
                          run: () => deleteMutation.mutateAsync(rule.id),
                        })
                      }
                    >
                      Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          )
        })}
      </ul>

      {editing !== null && (
        <RuleDialog
          key={editing === 'new' ? 'new' : editing.id}
          rule={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            refresh()
            showToast('success', 'Rule saved')
          }}
          projects={projectsQuery.data?.items ?? []}
        />
      )}
    </div>
  )
}

function RuleDialog({
  rule,
  projects,
  onClose,
  onSaved,
}: {
  rule: AccessRule | null
  projects: { id: string; name: string }[]
  onClose: () => void
  onSaved: () => void
}) {
  const environmentsQuery = useQuery({
    queryKey: ['environments'],
    queryFn: listEnvironments,
  })
  const [name, setName] = useState(rule?.name ?? '')
  const [ruleType, setRuleType] = useState<AccessRuleType>(rule?.rule_type ?? 'freeze_window')
  const [projectId, setProjectId] = useState(rule?.project_id ?? '')
  const [environment, setEnvironment] = useState(rule?.environment ?? '')
  const [startsAt, setStartsAt] = useState(toLocalInputValue(rule?.starts_at ?? null))
  const [endsAt, setEndsAt] = useState(toLocalInputValue(rule?.ends_at ?? null))
  const [actions, setActions] = useState<string[]>(rule?.blocked_actions ?? ['testcase', 'testrun', 'executionstep'])
  const [exempt, setExempt] = useState<string[]>(rule?.exempt_roles ?? ['admin'])
  const [reason, setReason] = useState(rule?.reason ?? '')
  const [enabled, setEnabled] = useState(rule?.enabled ?? true)
  const [submitted, setSubmitted] = useState(false)

  const isFreeze = ruleType === 'freeze_window'
  const startIso = fromLocalInputValue(startsAt)
  const endIso = fromLocalInputValue(endsAt)

  const errors: Record<string, string> = {}
  if (!name.trim()) errors.name = 'Enter a name'
  if (!reason.trim()) errors.reason = 'Enter the message people will see'
  if (actions.length === 0) errors.actions = 'Choose at least one action to block'
  if (isFreeze) {
    if (!startIso) errors.startsAt = 'Choose a start time'
    if (!endIso) errors.endsAt = 'Choose an end time'
  } else {
    if (!environment.trim()) errors.environment = 'Choose or enter an environment'
    if (Boolean(startIso) !== Boolean(endIso)) errors.endsAt = 'Set both ends of the allowed window, or neither'
  }
  if (startIso && endIso && new Date(endIso) <= new Date(startIso)) {
    errors.endsAt = 'The end time must be after the start time'
  }
  const shown = (key: string) => (submitted ? errors[key] : undefined)

  const saveMutation = useMutation({
    mutationFn: () => {
      const body: AccessRuleInput = {
        name: name.trim(),
        enabled,
        rule_type: ruleType,
        project_id: projectId || null,
        environment: isFreeze ? null : environment.trim(),
        starts_at: startIso,
        ends_at: endIso,
        blocked_actions: actions,
        exempt_roles: exempt,
        reason: reason.trim(),
      }
      return rule ? updateAccessRule(rule.id, body) : createAccessRule(body)
    },
    onSuccess: onSaved,
  })
  const serverError = saveMutation.error instanceof ApiError ? saveMutation.error.message : null

  function toggle(list: string[], set: (v: string[]) => void, value: string) {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value])
  }

  function submit() {
    setSubmitted(true)
    if (Object.keys(errors).length === 0) saveMutation.mutate()
  }

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone

  return (
    <Dialog open onClose={onClose} title={rule ? 'Edit access rule' : 'New access rule'}>
      <form
        className="flex flex-col gap-3 text-sm"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <FormField id="rule-name" label="Name" required error={shown('name')}>
          {(field) => (
            <Input
              {...field}
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Release 5.2 freeze"
            />
          )}
        </FormField>

        <FormField id="rule-type" label="Rule type" required>
          {(field) => (
            <Select
              {...field}
              value={ruleType}
              onChange={(e) => setRuleType(e.target.value as AccessRuleType)}
              disabled={rule !== null}
            >
              <option value="freeze_window">Freeze window (block changes between two times)</option>
              <option value="environment_restriction">
                Environment restriction (limit who can log defects against an environment)
              </option>
            </Select>
          )}
        </FormField>

        <FormField id="rule-project" label="Applies to">
          {(field) => (
            <Select {...field} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        {!isFreeze && (
          <FormField id="rule-environment" label="Environment" required error={shown('environment')}>
            {(field) => (
              <>
                <Input
                  {...field}
                  list="rule-environment-options"
                  value={environment}
                  maxLength={100}
                  onChange={(e) => setEnvironment(e.target.value)}
                  placeholder="e.g. Production"
                />
                <datalist id="rule-environment-options">
                  {(environmentsQuery.data ?? []).map((env) => (
                    <option key={env.id} value={env.name} />
                  ))}
                </datalist>
              </>
            )}
          </FormField>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            id="rule-starts"
            label={isFreeze ? `Starts (${tz})` : `Allowed from (${tz}, optional)`}
            required={isFreeze}
            error={shown('startsAt')}
          >
            {(field) => (
              <Input {...field} type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            )}
          </FormField>
          <FormField
            id="rule-ends"
            label={isFreeze ? `Ends (${tz})` : `Allowed until (${tz}, optional)`}
            required={isFreeze}
            error={shown('endsAt')}
          >
            {(field) => (
              <Input {...field} type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            )}
          </FormField>
        </div>
        <p className="-mt-1 text-xs text-[var(--muted-foreground)]">
          {isFreeze
            ? 'Entered in your local time and enforced in UTC. '
            : 'Outside this window the environment is restricted; leave both empty to always restrict it. '}
          {startIso && endIso
            ? `UTC: ${startIso.slice(0, 16).replace('T', ' ')} to ${endIso.slice(0, 16).replace('T', ' ')}.`
            : ''}
        </p>

        <fieldset
          className="flex flex-col gap-1.5"
          aria-describedby={shown('actions') ? 'rule-actions-error' : undefined}
        >
          <legend className="mb-1 text-sm font-medium">Blocked actions</legend>
          {ACTION_GROUPS.map((group) => (
            <label key={group.prefix} className="flex min-h-11 items-center gap-2 md:min-h-0">
              <input
                type="checkbox"
                className="size-5 md:size-4"
                checked={actions.includes(group.prefix)}
                onChange={() => toggle(actions, setActions, group.prefix)}
              />
              <span>{group.label}</span>
            </label>
          ))}
          {shown('actions') && (
            <p id="rule-actions-error" role="alert" className="text-xs text-[var(--destructive)]">
              {shown('actions')}
            </p>
          )}
          <p className="text-xs text-[var(--muted-foreground)]">Viewing and reports are never blocked.</p>
        </fieldset>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-sm font-medium">Exempt roles</legend>
          {[
            { code: 'admin', label: 'Admin (always exempt)' },
            { code: 'manager', label: 'Manager' },
            { code: 'tester', label: 'Tester' },
          ].map((role) => (
            <label key={role.code} className="flex min-h-11 items-center gap-2 md:min-h-0">
              <input
                type="checkbox"
                className="size-5 md:size-4"
                checked={exempt.includes(role.code)}
                disabled={role.code === 'admin'}
                onChange={() => toggle(exempt, setExempt, role.code)}
              />
              <span>{role.label}</span>
            </label>
          ))}
        </fieldset>

        <FormField
          id="rule-reason"
          label="Message shown to people"
          required
          error={shown('reason')}
          helper="Shown in the banner and when someone is blocked. Do not include personal data."
        >
          {(field) => (
            <Textarea {...field} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          )}
        </FormField>

        <label className="flex min-h-11 items-center gap-2 md:min-h-0">
          <input
            type="checkbox"
            className="size-5 md:size-4"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span>Enabled</span>
        </label>

        <FormError>{serverError}</FormError>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving…' : 'Save rule'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
