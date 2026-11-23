import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { hasPermission, isManagerOrAbove } from '@/api/auth'
import { uploadAttachment } from '@/api/attachments'
import { ApiError } from '@/api/client'
import {
  createDefect,
  getDefect,
  getDefectColumns,
  linkTestCase,
  unlinkTestCase,
  updateDefect,
  updateDefectStatus,
  type Defect,
  type RootCause,
} from '@/api/defects'
import { listFieldOptions } from '@/api/fieldCustomization'
import { listModules } from '@/api/modules'
import { getProject, listProjects } from '@/api/projects'
import { listEnvironments, listReleases, listBuilds } from '@/api/testAssets'
import { listUsers } from '@/api/users'
import { AttachmentsPanel } from '@/components/AttachmentsCard'
import { FormSection } from '@/components/FormSection'
import { MarkdownEditor } from '@/components/Markdown'
import { NoAccess } from '@/components/NoAccess'
import { PendingAttachments } from '@/components/PendingAttachments'
import { PickOrType } from '@/components/PickOrType'
import { StepBuilder } from '@/components/StepBuilder'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { FormError, FormField } from '@/components/ui/form-field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/ui/PageHeader'
import { Select } from '@/components/ui/select'
import { DetailSkeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { TagInput } from '@/components/ui/tag-input'
import { useAuth } from '@/lib/auth'
import { copyText } from '@/lib/clipboard'
import {
  LABEL_MAX,
  MAX_LABELS,
  SECTION_OF,
  SECTION_TITLES,
  emptyFormValues,
  isDirty,
  linkDiff,
  mapServerFields,
  mapStepServerErrors,
  sectionsWithErrors,
  statusChange,
  toCreateRequest,
  toUpdateRequest,
  validateForm,
  valuesFromDefect,
  type DefectFormValues,
  type FormErrors,
  type FormFieldKey,
} from '@/lib/defectForm'
import { allowedNextStatuses, planTransition, resolutionExplanation, resolutionRule } from '@/lib/defectWorkflow'
import { formatWhen } from '@/lib/formatWhen'
import { STEP_FIELD_SETS, validateSteps } from '@/lib/stepBuilder'
import { useToast } from '@/lib/toast'
import { useCanListUsers } from '@/lib/useCanListUsers'
import { useUnsavedGuard } from '@/lib/useUnsavedGuard'
import { TestCaseChips, TestCasePicker } from './pickers'
import { ROOT_CAUSE_LABEL, ROOT_CAUSES } from './statusDisplay'

/** Values handed over by "Report defect" on a test case (router state). */
export interface DefectFormPrefill {
  prefill?: Partial<DefectFormValues>
  /** Display data of the prefilled linked test cases (chips). */
  caseInfo?: { id: string; display_id: string | null; title: string }[]
}

export function DefectCreatePage() {
  const { user } = useAuth()
  if (!hasPermission(user, 'defect.create')) return <NoAccess />
  return <DefectFormPage mode="create" />
}

export function DefectEditPage() {
  const { defectId } = useParams<{ defectId: string }>()
  const { user } = useAuth()
  const query = useQuery({ queryKey: ['defects', 'detail', defectId], queryFn: () => getDefect(defectId!), enabled: !!defectId })
  if (!hasPermission(user, 'defect.edit') && !hasPermission(user, 'defect.create')) return <NoAccess />
  if (query.isLoading) return <DetailSkeleton />
  if (query.isError) return <ErrorState message="Could not load this defect." error={query.error} onRetry={() => query.refetch()} />
  if (!query.data) return <EmptyState title="Defect not found" description="It may have been deleted, or you may not have access to it." />
  return <DefectFormPage mode="edit" defect={query.data} />
}

const ALL_OPEN = { 1: true, 2: true, 3: true, 4: true, 5: true, 6: true }

function DefectFormPage({ mode, defect }: { mode: 'create' | 'edit'; defect?: Defect }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const { user } = useAuth()
  const router = (location.state as DefectFormPrefill | null) ?? null

  const canAssign = hasPermission(user, 'defect.assign') || hasPermission(user, 'defect.close')
  const canChangeStatus =
    hasPermission(user, 'defect.change_status') || hasPermission(user, 'defect.create') || hasPermission(user, 'defect.close')
  const canClose = hasPermission(user, 'defect.close') || isManagerOrAbove(user)
  const canListUsers = useCanListUsers()

  // The baseline is what "unchanged" means: the saved defect (refreshed after a partly applied save) or a blank form.
  const [baseline, setBaseline] = useState<DefectFormValues | null>(() => (defect ? valuesFromDefect(defect) : null))
  const queryProject = searchParams.get('projectId') ?? ''
  const [priorityDefault, setPriorityDefault] = useState('')
  const blank = useMemo(
    () => emptyFormValues({ project_id: queryProject, priority: priorityDefault, ...(router?.prefill ?? {}) }),
    [queryProject, priorityDefault, router?.prefill],
  )
  // Entries carried over from a test case ("Report defect") are the user's own, so they count as changes
  // against a truly blank form.
  // A project chosen for the user (the only one there is) is part of the blank form, not an entry.
  const [autoProject, setAutoProject] = useState('')
  const initial = baseline ?? emptyFormValues({ project_id: queryProject || autoProject, priority: priorityDefault })
  const [values, setValues] = useState<DefectFormValues>(() => baseline ?? blank)
  const [touched, setTouched] = useState<Partial<Record<FormFieldKey, true>>>({})
  const [serverErrors, setServerErrors] = useState<FormErrors>({})
  const [stepServerErrors, setStepServerErrors] = useState<ReturnType<typeof mapStepServerErrors>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [saved, setSaved] = useState(false)
  const [verifyConfirmed, setVerifyConfirmed] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [caseInfo, setCaseInfo] = useState<Record<string, { id: string; display_id: string | null; title: string }>>(() => {
    const out: Record<string, { id: string; display_id: string | null; title: string }> = {}
    for (const t of defect?.linked_test_cases ?? []) out[t.id] = { id: t.id, display_id: t.display_id, title: t.title }
    for (const t of router?.caseInfo ?? []) out[t.id] = t
    return out
  })
  const [open, setOpen] = useState<Record<number, boolean>>({ 1: true, 2: true, 3: true, 4: true, 5: mode === 'edit', 6: true })
  const sectionRefs = useRef<Record<number, HTMLElement | null>>({})
  const needsProject = mode === 'create'
  const opts = mode === 'edit' ? { initial } : { needsProject }

  const dirty = isDirty(values, initial) || (mode === 'create' && (files.length > 0 || values.project_id !== initial.project_id))
  const guard = useUnsavedGuard(dirty && !saved)

  const projectId = values.project_id
  const projectsQuery = useQuery({
    queryKey: ['projects', 'all-for-filter'],
    queryFn: () => listProjects({ page_size: 100, sort: 'name' }),
    enabled: mode === 'create',
  })
  const projectQuery = useQuery({ queryKey: ['projects', projectId], queryFn: () => getProject(projectId), enabled: !!projectId })
  const catalogQuery = useQuery({ queryKey: ['defects', 'columns'], queryFn: getDefectColumns, staleTime: 5 * 60_000 })
  const modulesQuery = useQuery({ queryKey: ['test-modules', projectId], queryFn: () => listModules(projectId), enabled: !!projectId })
  const severitiesQuery = useQuery({ queryKey: ['field-options', 'defect_severity'], queryFn: () => listFieldOptions('defect_severity') })
  const prioritiesQuery = useQuery({ queryKey: ['field-options', 'defect_priority'], queryFn: () => listFieldOptions('defect_priority') })
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers, enabled: canListUsers && canAssign })
  const environmentsQuery = useQuery({ queryKey: ['environments'], queryFn: listEnvironments })
  const releasesQuery = useQuery({ queryKey: ['releases', projectId], queryFn: () => listReleases(projectId), enabled: !!projectId })
  const buildsQuery = useQuery({ queryKey: ['builds', projectId], queryFn: () => listBuilds(projectId), enabled: !!projectId })

  const priorityOptions = useMemo(() => prioritiesQuery.data ?? [], [prioritiesQuery.data])
  useEffect(() => {
    if (mode !== 'create' || priorityOptions.length === 0 || priorityDefault) return
    const preferred = priorityOptions.find((p) => p.code === 'Medium') ?? priorityOptions[Math.floor((priorityOptions.length - 1) / 2)]
    setPriorityDefault(preferred.code)
    setValues((v) => (v.priority ? v : { ...v, priority: preferred.code }))
  }, [mode, priorityOptions, priorityDefault])

  // A project with exactly one choice (or the one from the URL) needs no decision.
  const projectChoices = useMemo(() => projectsQuery.data?.items ?? [], [projectsQuery.data])
  useEffect(() => {
    if (mode !== 'create' || values.project_id || projectChoices.length !== 1) return
    setAutoProject(projectChoices[0].id)
    setValues((v) => ({ ...v, project_id: projectChoices[0].id }))
  }, [mode, values.project_id, projectChoices])

  const errors: FormErrors = useMemo(() => {
    const out: FormErrors = {}
    const keys = Object.keys(SECTION_OF) as FormFieldKey[]
    const all = validateForm(values, opts)
    for (const key of keys) {
      const message = serverErrors[key] ?? (submitted || touched[key] ? all[key] : undefined)
      if (message) out[key] = message
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, touched, serverErrors, submitted, initial])

  function set<K extends keyof DefectFormValues>(key: K, value: DefectFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }))
    // Editing a field clears the server's message about it.
    if (serverErrors[key]) setServerErrors((s) => omit(s, key))
  }
  function blur(key: FormFieldKey) {
    setTouched((t) => (t[key] ? t : { ...t, [key]: true }))
  }

  function revealErrors(found: FormErrors) {
    const bad = sectionsWithErrors(found)
    if (bad.length) {
      setOpen((o) => ({ ...o, ...Object.fromEntries(bad.map((n) => [n, true])) }))
      requestAnimationFrame(() => sectionRefs.current[bad[0]]?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
    }
  }

  const saveMutation = useMutation({
    mutationFn: async (): Promise<Defect> => {
      if (mode === 'create') {
        const created = await createDefect(toCreateRequest(values))
        let failed = 0
        for (const file of files) {
          try {
            await uploadAttachment('defect', created.id, file)
          } catch {
            failed += 1
          }
        }
        if (failed > 0) {
          showToast('warning', `Defect saved, but ${failed} attachment${failed === 1 ? '' : 's'} could not be uploaded. Add ${failed === 1 ? 'it' : 'them'} on the defect page.`)
        }
        return created
      }
      let current = defect!
      try {
        const patch = toUpdateRequest(values, initial)
        if (Object.keys(patch).length > 0) current = await updateDefect(defect!.id, patch)
        const { add, remove } = linkDiff(values, initial)
        for (const id of remove) await unlinkTestCase(defect!.id, id)
        for (const id of add) await linkTestCase(defect!.id, id)
        const change = statusChange(values, initial)
        if (change) current = await updateDefectStatus(defect!.id, { ...change, verification_confirmed: verifyConfirmed })
      } catch (err) {
        // Part of the save may have been applied: reload the server's copy as the new baseline so what
        // still differs (what failed) stays highlighted and nothing is applied twice.
        try {
          setBaseline(valuesFromDefect(await getDefect(defect!.id)))
          void queryClient.invalidateQueries({ queryKey: ['defects'] })
        } catch {
          // keep the old baseline
        }
        throw err
      }
      return current
    },
    onSuccess: (savedDefect) => {
      setSaved(true)
      queryClient.invalidateQueries({ queryKey: ['defects'] })
      queryClient.invalidateQueries({ queryKey: ['test-cases'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      showToast('success', mode === 'create' ? `Defect ${savedDefect.display_id ?? ''} created` : 'Defect updated')
      navigate(`/defects/${savedDefect.id}`)
    },
    onError: (err) => {
      // Data stays in the form; the API's per-field messages go onto the fields.
      if (err instanceof ApiError && err.fields) {
        const mapped = mapServerFields(err.fields)
        setServerErrors(mapped.errors)
        setStepServerErrors(mapStepServerErrors(err.fields))
        setFormError(mapped.other.length > 0 ? mapped.other.join('; ') : err.message)
        revealErrors(mapped.errors)
      } else if (err instanceof ApiError && err.status === 409) {
        // An invalid status move names the allowed next statuses.
        setServerErrors({ status: err.message })
        setFormError(err.message)
        revealErrors({ status: err.message })
      } else {
        setFormError(err instanceof ApiError ? err.message : 'Could not save the defect. Your entries are still here; try again.')
      }
    },
  })

  function save() {
    setFormError(null)
    setServerErrors({})
    setStepServerErrors({})
    setSubmitted(true)
    const found = validateForm(values, opts)
    if (mode === 'edit' && planTransition(initial.status, values.status as Defect['status']).needsVerification && values.status !== initial.status && !verifyConfirmed) {
      found.status = 'Confirm that the defect was verified before closing it'
    }
    const count = Object.keys(found).length
    if (count > 0) {
      setServerErrors((s) => ({ ...s, ...(found.status ? { status: found.status } : {}) }))
      revealErrors(found)
      setFormError(`Fix ${count} field${count === 1 ? '' : 's'} marked below, then save again.`)
      return
    }
    if (mode === 'edit' && !dirty) {
      showToast('info', 'No changes to save')
      return
    }
    saveMutation.mutate()
  }

  const backTo = mode === 'edit' ? `/defects/${defect!.id}` : projectId ? `/defects?projectId=${projectId}` : '/defects'
  const pending = saveMutation.isPending
  const errorCountBySection = useMemo(() => {
    const counts: Record<number, number> = {}
    for (const key of Object.keys(errors) as FormFieldKey[]) {
      if (errors[key]) counts[SECTION_OF[key]] = (counts[SECTION_OF[key]] ?? 0) + 1
    }
    return counts
  }, [errors])
  const stepErrorsNow = (submitted || Object.keys(stepServerErrors).length > 0) && validateSteps(values.steps, STEP_FIELD_SETS.defect).some((e) => e.action)
  if (stepErrorsNow && !errorCountBySection[2]) errorCountBySection[2] = 1

  function sectionProps(n: number) {
    return {
      idPrefix: 'df',
      number: n,
      title: SECTION_TITLES[n],
      open: !!open[n],
      errorCount: errorCountBySection[n] ?? 0,
      onToggle: () => setOpen((o) => ({ ...o, [n]: !o[n] })),
      sectionRef: (el: HTMLElement | null) => {
        sectionRefs.current[n] = el
      },
    }
  }

  // ---- classification ---------------------------------------------------------------------
  const currentStatus = mode === 'edit' ? initial.status : 'New'
  const statusChoices = useMemo(() => {
    if (mode === 'create') return ['New', ...(values.assigned_to ? ['Assigned'] : [])]
    const next = allowedNextStatuses(initial.status, catalogQuery.data)
    return [initial.status, ...next]
  }, [mode, initial.status, values.assigned_to, catalogQuery.data])
  const statusChanged = mode === 'edit' && values.status !== initial.status
  const statusRule = resolutionRule(values.status)
  const plan = statusChanged ? planTransition(initial.status, values.status as Defect['status']) : null
  const showResolution = statusRule.allowed.length > 0 && mode === 'edit' && (canChangeStatus || !statusChanged)
  const statusLocked = mode === 'edit' && !canChangeStatus

  const usersById = new Map((usersQuery.data ?? []).map((u) => [u.id, u.name]))
  const modules = modulesQuery.data ?? []
  const assigneeName = defect?.assigned_to_name ?? (values.assigned_to ? (usersById.get(values.assigned_to) ?? 'Selected user') : 'Unassigned')
  const linkedItems = values.test_case_ids.map((id) => caseInfo[id] ?? { id, display_id: null, title: 'Linked test case' })

  return (
    <div className="flex flex-col gap-4 pb-4">
      <PageHeader
        back={
          <Link
            to={backTo}
            className="inline-flex text-xs text-[var(--muted-foreground)] hover:underline max-md:min-h-11 max-md:items-center max-md:text-sm"
          >
            ← {mode === 'edit' ? (defect?.title ?? 'Defect') : (projectQuery.data?.name ?? 'Defects')}
          </Link>
        }
        title={mode === 'create' ? 'New Defect' : 'Edit Defect'}
        description={
          mode === 'create'
            ? 'Fields marked * are required. A new defect starts as New (or Assigned when you choose an assignee).'
            : 'Fields marked * are required. Status moves follow the workflow: only the allowed next statuses are offered.'
        }
        actions={
          <div className="flex items-center gap-2 text-xs">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(ALL_OPEN)}>
              Expand all
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen({})}>
              Collapse all
            </Button>
          </div>
        }
      />

      {mode === 'edit' && defect?.status === 'Closed' && (
        <p className="rounded-md border border-[var(--status-warning)]/30 bg-[var(--status-warning-bg)] px-3 py-2 text-sm">
          This defect is Closed. Its fields are locked; reopen it first to change them.
        </p>
      )}

      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        {/* 1 Bug Overview */}
        <FormSection {...sectionProps(1)}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="df-display-id">Bug ID</Label>
              <div className="flex items-center gap-1">
                <Input
                  id="df-display-id"
                  readOnly
                  value={defect?.display_id ?? ''}
                  placeholder="Assigned when you save"
                  aria-describedby="df-display-id-help"
                  className="bg-[var(--muted)]/40 font-mono"
                />
                {defect?.display_id && (
                  <IconButton
                    aria-label="Copy Bug ID"
                    variant="secondary"
                    onClick={async () => {
                      const ok = await copyText(defect.display_id!)
                      showToast(ok ? 'success' : 'error', ok ? 'Bug ID copied' : 'Could not copy the ID')
                    }}
                  >
                    <Copy aria-hidden="true" />
                  </IconButton>
                )}
              </div>
              <p id="df-display-id-help" className="text-xs text-[var(--muted-foreground)]">
                {mode === 'edit' && !defect?.display_id ? 'This older defect has no generated ID.' : 'Generated automatically and never changes.'}
              </p>
            </div>
            {mode === 'create' ? (
              <FormField id="df-project" label="Project" required error={errors.project_id}>
                {(f) => (
                  <Select
                    {...f}
                    value={values.project_id}
                    onChange={(e) => {
                      // Module, linked test cases and releases belong to one project.
                      setValues((v) => ({ ...v, project_id: e.target.value, module_id: '', test_case_ids: [] }))
                      blur('project_id')
                    }}
                  >
                    <option value="">Select a project…</option>
                    {projectChoices.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="df-project-name">Project</Label>
                <Input id="df-project-name" readOnly value={defect?.project_name ?? ''} className="bg-[var(--muted)]/40" />
              </div>
            )}
          </div>

          <FormField id="df-title" label="Title" required error={errors.title}>
            {(f) => (
              <Input {...f} maxLength={255} value={values.title} onChange={(e) => set('title', e.target.value)} onBlur={() => blur('title')} />
            )}
          </FormField>

          <MarkdownEditor
            id="df-description"
            label="Description"
            required
            value={values.description}
            onChange={(v) => set('description', v)}
            onBlur={() => blur('description')}
            error={errors.description}
            helper="What is wrong and where. Markdown is supported (lists, tables, **bold**). HTML is not stored."
            rows={4}
            maxLength={20000}
          />

          <FormField id="df-module" label="Component / Module" error={errors.module_id}>
            {(f) => (
              <Select {...f} value={values.module_id} disabled={!projectId} onChange={(e) => set('module_id', e.target.value)}>
                <option value="">{projectId ? 'Not set' : 'Choose a project first'}</option>
                {modules.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.parent_id ? `↳ ${m.name}` : m.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
        </FormSection>

        {/* 2 Reproduction Details */}
        <FormSection {...sectionProps(2)}>
          <MarkdownEditor
            id="df-preconditions"
            label="Preconditions"
            value={values.preconditions}
            onChange={(v) => set('preconditions', v)}
            onBlur={() => blur('preconditions')}
            error={errors.preconditions}
            helper="Optional: what must be true before the steps (account, data, state)."
            rows={3}
            maxLength={10000}
          />
          <StepBuilder
            steps={values.steps}
            onChange={(steps) => {
              setValues((v) => ({ ...v, steps }))
              if (serverErrors.steps) setServerErrors((s) => omit(s, 'steps'))
              if (Object.keys(stepServerErrors).length) setStepServerErrors({})
            }}
            fields="defect"
            label="Steps to Reproduce"
            idPrefix="df-step"
            showErrors={submitted}
            serverErrors={stepServerErrors}
          />
          {errors.steps && !values.steps.some((s) => s.action.trim()) && (
            <p role="alert" className="text-xs text-[var(--destructive)]">
              {errors.steps}
            </p>
          )}
          {serverErrors.steps && values.steps.some((s) => s.action.trim()) && (
            <p role="alert" className="text-xs text-[var(--destructive)]">
              {serverErrors.steps}
            </p>
          )}
          <MarkdownEditor
            id="df-expected"
            label="Expected Result"
            required
            value={values.expected_result}
            onChange={(v) => set('expected_result', v)}
            onBlur={() => blur('expected_result')}
            error={errors.expected_result}
            helper="What should have happened."
            rows={3}
            maxLength={10000}
          />
          <MarkdownEditor
            id="df-actual"
            label="Actual Result"
            required
            value={values.actual_result}
            onChange={(v) => set('actual_result', v)}
            onBlur={() => blur('actual_result')}
            error={errors.actual_result}
            helper="What happened instead. You can correct this after saving."
            rows={3}
            maxLength={10000}
          />
        </FormSection>

        {/* 3 Environment & Evidence */}
        <FormSection {...sectionProps(3)}>
          {mode === 'edit' && defect ? (
            <div className="flex flex-col gap-2">
              <Label>Attachments / Evidence</Label>
              <AttachmentsPanel ownerType="defect" ownerId={defect.id} />
            </div>
          ) : (
            <PendingAttachments files={files} onChange={setFiles} disabled={pending} />
          )}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField
              id="df-environment"
              label="Environment"
              required
              error={errors.environment}
              helper="Where it happened: QA, Staging, a browser and OS."
            >
              {(f) => (
                <PickOrType
                  field={f}
                  value={values.environment}
                  onChange={(v) => set('environment', v)}
                  onBlur={() => blur('environment')}
                  choices={(environmentsQuery.data ?? []).map((e) => e.name)}
                  typedLabel="Environment (typed)"
                  placeholder="e.g. Staging, Chrome 130, Windows 11"
                />
              )}
            </FormField>
            <FormField id="df-build" label="Build / Version Found" error={errors.build_found}>
              {(f) => (
                <PickOrType
                  field={f}
                  value={values.build_found}
                  onChange={(v) => set('build_found', v)}
                  onBlur={() => blur('build_found')}
                  choices={(buildsQuery.data ?? []).map((b) => b.name)}
                  typedLabel="Build or version (typed)"
                  placeholder="e.g. 2.4.1-rc2"
                />
              )}
            </FormField>
          </div>
        </FormSection>

        {/* 4 Classification */}
        <FormSection {...sectionProps(4)}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField id="df-severity" label="Severity" required error={errors.severity}>
              {(f) => (
                <Select
                  {...f}
                  value={values.severity}
                  onChange={(e) => {
                    set('severity', e.target.value)
                    blur('severity')
                  }}
                >
                  <option value="">Select severity…</option>
                  {values.severity && !(severitiesQuery.data ?? []).some((o) => o.code === values.severity) && (
                    <option value={values.severity}>{values.severity}</option>
                  )}
                  {(severitiesQuery.data ?? []).map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField id="df-priority" label="Priority" required error={errors.priority}>
              {(f) => (
                <Select
                  {...f}
                  value={values.priority}
                  onChange={(e) => {
                    set('priority', e.target.value)
                    blur('priority')
                  }}
                >
                  <option value="">Select priority…</option>
                  {values.priority && !priorityOptions.some((o) => o.code === values.priority) && (
                    <option value={values.priority}>{values.priority}</option>
                  )}
                  {priorityOptions.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField
              id="df-status"
              label="Status"
              error={errors.status}
              helper={
                mode === 'create'
                  ? 'A new defect is New, or Assigned once you choose an assignee.'
                  : statusLocked
                    ? 'You do not have permission to change the status.'
                    : `Only the statuses a ${currentStatus} defect may move to are listed.`
              }
            >
              {(f) => (
                <Select
                  {...f}
                  value={values.status}
                  disabled={statusLocked}
                  onChange={(e) => {
                    const next = e.target.value
                    setValues((v) => ({
                      ...v,
                      status: next,
                      resolution:
                        next === initial.status
                          ? initial.resolution
                          : (planTransition(initial.status, next as Defect['status']).defaultResolution ?? ''),
                    }))
                    if (serverErrors.status) setServerErrors((s) => omit(s, 'status'))
                    setVerifyConfirmed(false)
                  }}
                >
                  {statusChoices.map((s) => {
                    const needsClose = mode === 'edit' && s !== initial.status && planTransition(initial.status, s as Defect['status']).needsClosePermission
                    return (
                      <option key={s} value={s} disabled={needsClose && !canClose}>
                        {s === initial.status && mode === 'edit' ? `${s} (current)` : needsClose && !canClose ? `${s} (needs close permission)` : s}
                      </option>
                    )
                  })}
                </Select>
              )}
            </FormField>
            {showResolution ? (
              <FormField
                id="df-resolution"
                label="Resolution"
                required={!!plan?.needsResolution}
                error={errors.resolution}
                helper={resolutionExplanation(values.status)}
              >
                {(f) => (
                  <Select {...f} value={values.resolution} onChange={(e) => set('resolution', e.target.value)}>
                    <option value="">{statusRule.required ? 'Select a resolution…' : 'None'}</option>
                    {statusRule.allowed.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="df-resolution-note">Resolution</Label>
                <Input id="df-resolution-note" readOnly value="Not used for this status" className="bg-[var(--muted)]/40" />
                <p className="text-xs text-[var(--muted-foreground)]">{resolutionExplanation(values.status)}</p>
              </div>
            )}
          </div>
          {statusChanged && plan?.needsVerification && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={verifyConfirmed} onChange={(e) => setVerifyConfirmed(e.target.checked)} />
              I confirm this defect has been verified and should be closed.
            </label>
          )}
        </FormSection>

        {/* 5 Ownership & Tracking */}
        <FormSection {...sectionProps(5)}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField id="df-root-cause" label="Root Cause" error={errors.root_cause}>
              {(f) => (
                <Select {...f} value={values.root_cause} onChange={(e) => set('root_cause', e.target.value as RootCause | '')}>
                  <option value="">Uncategorized</option>
                  {ROOT_CAUSES.map((rc) => (
                    <option key={rc} value={rc}>
                      {ROOT_CAUSE_LABEL[rc]}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField id="df-fix-version" label="Fix Version / Target Milestone" error={errors.fix_version} helper="Pick a release or type a version.">
              {(f) => (
                <PickOrType
                  field={f}
                  value={values.fix_version}
                  onChange={(v) => set('fix_version', v)}
                  onBlur={() => blur('fix_version')}
                  choices={(releasesQuery.data ?? []).map((r) => r.name)}
                  typedLabel="Fix version (typed)"
                  placeholder="e.g. 2.5.0"
                />
              )}
            </FormField>
            <div className="md:col-span-2">
              <FormField id="df-root-cause-notes" label="Root Cause Notes" error={errors.root_cause_notes}>
                {(f) => (
                  <Textarea
                    {...f}
                    rows={3}
                    maxLength={10000}
                    value={values.root_cause_notes}
                    onChange={(e) => set('root_cause_notes', e.target.value)}
                    onBlur={() => blur('root_cause_notes')}
                  />
                )}
              </FormField>
            </div>
            <ReadOnly id="df-reporter" label="Reporter" value={mode === 'edit' ? (defect?.reported_by_name ?? 'Unknown') : (user?.name ?? 'You')} help="Set automatically." />
            <ReadOnly
              id="df-date"
              label="Date Reported"
              value={mode === 'edit' ? formatWhen(defect?.date_reported ?? defect?.created_at) : 'Set when you save'}
              help="Set automatically."
            />
            {canAssign && canListUsers ? (
              <FormField id="df-assignee" label="Assignee" error={errors.assigned_to} helper="Must be an active member of the project.">
                {(f) => (
                  <Select {...f} value={values.assigned_to} onChange={(e) => set('assigned_to', e.target.value)}>
                    <option value="">Unassigned</option>
                    {values.assigned_to && !usersById.has(values.assigned_to) && <option value={values.assigned_to}>{assigneeName}</option>}
                    {(usersQuery.data ?? []).filter((u) => u.is_active).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
            ) : (
              <ReadOnly
                id="df-assignee-ro"
                label="Assignee"
                value={mode === 'edit' ? assigneeName : 'Unassigned'}
                help={canAssign ? 'Choosing an assignee needs access to the user list.' : 'You need the Assign defects permission to change the assignee.'}
              />
            )}
          </div>
        </FormSection>

        {/* 6 Traceability */}
        <FormSection {...sectionProps(6)}>
          <div className="flex flex-col gap-2">
            <TestCasePicker
              id="df-link-case"
              projectId={projectId}
              excludeIds={values.test_case_ids}
              label="Linked Test Cases"
              onPick={(item) => {
                setCaseInfo((c) => ({ ...c, [item.id]: { id: item.id, display_id: item.primary, title: item.secondary } }))
                set('test_case_ids', [...values.test_case_ids, item.id])
              }}
            />
            <TestCaseChips items={linkedItems} onRemove={(id) => set('test_case_ids', values.test_case_ids.filter((t) => t !== id))} />
            {errors.test_case_ids && (
              <p role="alert" className="text-xs text-[var(--destructive)]">
                {errors.test_case_ids}
              </p>
            )}
          </div>
          <TagInput
            id="df-labels"
            label="Labels / Tags"
            value={values.labels}
            onChange={(labels) => set('labels', labels)}
            limits={{ max: MAX_LABELS, maxLength: LABEL_MAX }}
            error={errors.labels}
            helper="Free text, for example regression or checkout. Labels are lower-cased."
          />
        </FormSection>

        <FormError>{formError}</FormError>

        {/* Sticky action bar: stays on screen however long the form is (phones: above the home indicator). */}
        <div className="sticky bottom-0 z-20 -mx-1 rounded-t-xl border-t border-[var(--border)] bg-[var(--background)]/95 px-4 py-3 backdrop-blur max-md:bottom-[calc(4.75rem+env(safe-area-inset-bottom))]">
          <div className="flex flex-wrap items-center justify-end gap-2 max-md:[&>button]:flex-1">
            <Button type="button" variant="ghost" disabled={pending} onClick={() => guard.leave(() => navigate(backTo))}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              {mode === 'create' ? 'Create defect' : 'Save changes'}
            </Button>
          </div>
        </div>
      </form>
      {guard.dialog}
    </div>
  )
}

function omit<T extends object>(obj: T, key: keyof T): T {
  const next = { ...obj }
  delete next[key]
  return next
}

function ReadOnly({ id, label, value, help }: { id: string; label: string; value: string; help?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} readOnly value={value} aria-describedby={help ? `${id}-help` : undefined} className="bg-[var(--muted)]/40" />
      {help && (
        <p id={`${id}-help`} className="text-xs text-[var(--muted-foreground)]">
          {help}
        </p>
      )}
    </div>
  )
}
